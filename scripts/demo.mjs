import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  environment,
  kubeconfig,
  kubectl,
  runStreaming,
  validateRelease,
} from "./cloud.mjs";
import { healthyTraffic, createTrafficLogger, summarize } from "./traffic.mjs";
import { evidenceBinding } from './evidence.mjs';
import { waitForAlertState } from './alerts.mjs';
import { runTrafficOnly } from "./traffic-only.mjs";

const action = process.argv[2];
if (![
    "baseline",
    "incident",
    "recover",
    "check",
    "reset",
    "status",
    "traffic-normal",
    "traffic-fail",
  ].includes(action)) throw new Error("Usage: node scripts/demo.mjs baseline|incident|recover|check|reset|status|traffic-normal|traffic-fail");
const values = environment();
const filename = await kubeconfig(values);
const release = JSON.parse(await readFile(path.join(root, 'artifacts/release.json'), 'utf8'));
validateRelease(values, release);
const binding = evidenceBinding(values, release);
if (["traffic-normal", "traffic-fail"].includes(action)) {
  const traffic = await runTrafficOnly(action, filename, release);
  const evidence = {
    ...binding,
    action,
    utc: new Date().toISOString(),
    ...traffic,
  };
  await writeFile(
    path.join(root, "artifacts", `${action}.json`),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        action,
        utc: evidence.utc,
        version: evidence.version,
        clientLocation: evidence.clientLocation,
        summary: evidence.summary,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const runPath = path.join(root, 'artifacts', `demo-run-${values.SRE_AGENT_NAME}.json`);
let run;
try { run = JSON.parse(await readFile(runPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (action === 'reset') {
  console.log(JSON.stringify(await waitForAlertState(values, 'Resolved')));
  process.exit(0);
}
if (action === 'status') {
  console.log(kubectl(filename, ['-n', 'payments', 'get', 'deployments,pods', '-l', 'application=payments', '-o', 'wide']));
  process.exit(0);
}
if (action === 'incident') {
  await waitForAlertState(values, 'Resolved');
  run = { ...binding, id: randomUUID(), startedUtc: new Date().toISOString(), phase: 'Starting', alertId: null };
  await writeFile(runPath, JSON.stringify(run, null, 2));
  console.log(kubectl(filename, ['-n', 'payments', 'set', 'image', 'deployment/payment-api-canary', `payment-api=${release.images['v1.9']}`]));
  console.log(kubectl(filename, ['-n', 'payments', 'scale', 'deployment/payment-api-canary', '--replicas=1']));
  console.log(kubectl(filename, ['-n', 'payments', 'rollout', 'restart', 'deployment/payment-api-canary']));
  console.log(kubectl(filename, ['-n', 'payments', 'rollout', 'status', 'deployment/payment-api-canary', '--timeout=240s']));
} else if (action === 'recover') {
  console.log(kubectl(filename, ['-n', 'payments', 'set', 'image', 'deployment/payment-api-canary', `payment-api=${release.images['v1.8']}`]));
  console.log(kubectl(filename, ['-n', 'payments', 'scale', 'deployment/payment-api-canary', '--replicas=1']));
  console.log(kubectl(filename, ['-n', 'payments', 'rollout', 'status', 'deployment/payment-api-canary', '--timeout=240s']));
}
if (action === 'incident' || action === 'recover' || action === 'check') {
  const pods = JSON.parse(kubectl(filename, ['-n', 'payments', 'get', 'pods', '-l', 'app=payment-api,track=canary', '-o', 'json']));
  const pod = pods.items.filter(item => !item.metadata.deletionTimestamp && item.status.containerStatuses?.every(container => container.ready)).sort((left, right) => right.metadata.creationTimestamp.localeCompare(left.metadata.creationTimestamp))[0];
  if (!pod) throw new Error('No ready canary Pod available');
  const trafficSource = await readFile(path.join(root, 'scripts/traffic.mjs'), 'utf8');
  const count = action === 'incident' ? 10 : 20;
  const program = `${trafficSource}\nconst baseUrl='http://127.0.0.1:8080';\nconst version=await(await fetch(baseUrl+'/version')).json();\nconst logger=createTrafficLogger(${JSON.stringify(action)},${3 + count * 2},line=>console.error(line));\nconst results=await cascadeTraffic(baseUrl,logger);\nresults.push(...await healthyTraffic(baseUrl,${count},logger));\nconsole.log(JSON.stringify({version,results}));`;
  const { version, results } = JSON.parse(await runStreaming(
      "kubectl",
      [
        "--kubeconfig",
        filename,
        "-n",
        "payments",
        "exec",
        "-i",
        pod.metadata.name,
        "--",
        "node",
        "--input-type=module",
      ],
      { input: program, onStderr: chunk => process.stdout.write(chunk) },
    ));
  const deployments = JSON.parse(kubectl(filename, ['-n', 'payments', 'get', 'deployments', '-l', 'application=payments', '-o', 'json']));
  const deploymentImages = Object.fromEntries(deployments.items.map(item => [item.metadata.name, item.spec.template.spec.containers[0].image]));
  const evidence = { ...binding, runId: run?.id, action, utc: new Date().toISOString(), deploymentImages, clientLocation: pod.metadata.name, imageID: pod.status.containerStatuses[0].imageID, version, results, summary: summarize(results) };
  const evidenceName = action === 'check' ? 'recover' : action;
  await writeFile(path.join(root, `artifacts/${evidenceName}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ action, utc: evidence.utc, version, summary: evidence.summary }, null, 2));
  if (action === 'incident') for (const item of results.slice(0, 3)) assert.equal(item.status, 504, `Expected ${item.label} cancellation`);
  else {
    assert.equal(results[0].status, 504, 'High-work-factor A must reach its deadline');
    assert.equal(results[1].status, 200, 'B must remain isolated from A');
    assert.equal(results[2].status, 200, 'C must succeed after A');
    for (const item of summarize(results.slice(3))) { assert.equal(item.failures, 0); assert(item.p95Ms <= 1000); }
  }
  if (action === 'incident') {
    const alert = await waitForAlertState(values, 'Fired', { after: run.startedUtc });
    run = { ...run, alertId: alert.id, alertResourceId: alert.resourceId, phase: 'Fired' };
    await writeFile(runPath, JSON.stringify(run, null, 2));
    console.log(JSON.stringify({ runId: run.id, alertId: run.alertId, phase: run.phase }));
  } else if (action === 'recover') {
    const reset = await waitForAlertState(values, 'Resolved');
    if (run?.agentId === values.SRE_AGENT_RESOURCE_ID) await writeFile(runPath, JSON.stringify({ ...run, recoveredUtc: evidence.utc, resetUtc: reset.checkedUtc, phase: 'Recovered' }, null, 2));
    console.log(JSON.stringify(reset));
  }
  process.exit(0);
}
const deployment = action === 'baseline' ? 'payment-api' : 'payment-api-canary';
const forward = spawn('kubectl', ['--kubeconfig', filename, '-n', 'payments', 'port-forward', `deployment/${deployment}`, ':8080', '--address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Port-forward did not become ready')), 30000);
    forward.stdout.on('data', chunk => { const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    forward.once('exit', code => { clearTimeout(timeout); reject(new Error(`Port-forward exited ${code}`)); });
  });
  const url = `http://127.0.0.1:${port}`;
  const version = await (await fetch(`${url}/version`)).json();
  const results = await healthyTraffic(url, 20, createTrafficLogger(action, 40));
  for (const item of summarize(results)) { assert.equal(item.failures, 0); assert(item.p95Ms <= 1000); }
  const evidence = { ...binding, action, utc: new Date().toISOString(), version, results, summary: summarize(results) };
  await writeFile(path.join(root, `artifacts/${action}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ action, utc: evidence.utc, version, summary: evidence.summary }, null, 2));
} finally {
  forward.kill('SIGTERM');
}