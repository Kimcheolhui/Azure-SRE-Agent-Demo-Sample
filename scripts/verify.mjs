import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root, run, json, environment, kubeconfig, kubectl, validateRelease } from './cloud.mjs';
import { createRuntimeClient, items, completedReply } from './runtime.mjs';
import { validateRecovery, matchingIncident, sameBinding } from './evidence.mjs';

const checks = [];
function record(name, detail) { checks.push({ name, passed: true, detail }); }
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.azure', 'artifacts', '.git'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(filename));
    else files.push(filename);
  }
  return files;
}
for (const filename of await walk(root)) {
  if (/\.(mjs|js|html|md|json|bicep|yaml|svg)$/.test(filename)) {
    const text = await readFile(filename, 'utf8');
    if (!filename.endsWith('platform-api.md')) assert(!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(text), `Unexpected language in ${path.relative(root, filename)}`);
    assert(!/gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text), `Possible credential in ${path.relative(root, filename)}`);
    if (filename.endsWith('.json')) JSON.parse(text);
    if (filename.endsWith('.mjs')) run('node', ['--check', filename], { stdio: ['ignore', 'pipe', 'pipe'] });
  }
}
record('source syntax, language and credential scan', 'Source files only; runtime credentials/artifacts excluded.');
const guide = await readFile(path.join(root, 'docs/demo-guide.html'), 'utf8');
for (const match of guide.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  await stat(path.resolve(root, 'docs', target));
}
record('guide links and assets', 'All relative links resolve.');
for (const command of [...guide.matchAll(/node scripts\/([a-z-]+\.mjs)/g), ...(await readFile(path.join(root, 'README.md'), 'utf8')).matchAll(/node scripts\/([a-z-]+\.mjs)/g)]) await stat(path.join(root, 'scripts', command[1]));
record('documented executable paths', 'All referenced scripts exist.');
run('npm', ['test'], { stdio: ['ignore', 'pipe', 'pipe'] });
record('unit and HTTP tests', 'Passed.');
const cloud = process.argv.includes('--cloud');
const mode = process.argv.includes('--initial') ? 'initial' : process.argv.includes('--configured') ? 'configured' : 'full';
if (process.argv.includes('--initial') && process.argv.includes('--configured')) throw new Error('Select only one verification mode');
const remaining = ['GitHub source publication and deployed SHA correlation', 'Authenticated native portal visual verification'];
if (cloud) {
  const env = environment();
  const agent = json('az', ['resource', 'show', '--ids', env.SRE_AGENT_RESOURCE_ID, '--api-version', '2026-01-01', '--query', '{state:properties.provisioningState,managedResources:properties.knowledgeGraphConfiguration.managedResources}', '-o', 'json']);
  assert.equal(agent.state, 'Succeeded');
  record('real SRE Agent', env.SRE_AGENT_NAME);
  const token = run('az', ['account', 'get-access-token', '--scope', '59f0a04a-b322-4310-adc9-39ac41e9631e/.default', '--query', 'accessToken', '-o', 'tsv'], { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const api = createRuntimeClient(env.SRE_AGENT_ENDPOINT, token);
  const specialists = await api('/api/v2/extendedAgent/agents');
  const skills = await api('/api/v2/extendedAgent/skills');
  if (mode === 'initial') {
    assert.equal(items(specialists).length, 0);
    assert.equal(items(skills).length, 0);
    assert.equal(items(await api('/api/v1/threads')).length, 0);
    record('selected Agent initial state', env.SRE_AGENT_NAME);
  } else {
    assert(items(specialists).some(item => item.name === 'payment-specialist'));
    assert(items(skills).some(item => item.name === 'payment-investigation'));
    const files = items(await api('/api/v1/AgentMemory/files'));
    assert(files.some(file => file.name === 'service-context.md' && file.isIndexed));
    const plan = await api('/api/v2/extendedAgent/incidentFilters/payment-alert-response');
    assert.equal(plan.properties.handlingAgent, 'payment-specialist');
    assert.equal(plan.properties.titleContains, env.PAYMENT_ALERT_NAME);
    assert.equal(plan.properties.isEnabled, true);
    record('selected Agent configured state', env.SRE_AGENT_NAME);
    if (mode === 'full') {
      const release = JSON.parse(await readFile(path.join(root, 'artifacts/release.json'), 'utf8'));
      validateRelease(env, release);
      const execution = JSON.parse(await readFile(path.join(root, 'artifacts', `demo-run-${env.SRE_AGENT_NAME}.json`), 'utf8'));
      sameBinding(execution, env, release);
      const age = Date.now() - Date.parse(execution.startedUtc);
      assert(age >= 0 && age <= 3600000 && execution.alertId, 'Run a fresh incident for this Agent and release before full verification');
      const threads = items(await api('/api/v1/threads'));
      let incident;
      for (const candidate of threads.filter(thread => thread.source === 'Incident')) {
        const current = await api(`/api/v1/threads/${candidate.id}`);
        if (matchingIncident(current, env, execution)) { incident = current; break; }
      }
      assert(incident, 'No completed automatic investigation matches the current alert, plan and run');
      record('current automatic incident investigation', incident.id);
      const task = items(await api('/api/v1/scheduledtasks')).find(item => item.name === 'payment-daily-health');
      assert.equal(task?.status, 'Paused');
      const history = items(await api(`/api/v1/scheduledtasks/${task.id}/executions`));
      const successful = history.find(item => item.completed && item.success && Date.parse(item.executionTime) >= Date.parse(execution.startedUtc));
      assert(successful && completedReply(await api(`/api/v1/threads/${successful.threadId}`)), 'No completed automation result belongs to the current run');
      record('current completed automation and paused recurrence', successful.threadId);
      run('node', ['scripts/features.mjs', 'report-verify'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const nativeReport = JSON.parse(await readFile(path.join(root, 'artifacts/native-report.json'), 'utf8'));
      assert.equal(nativeReport.agentId, env.SRE_AGENT_RESOURCE_ID);
      assert.equal(nativeReport.actualReportQueriesVerified, true);
      record('actual stored Live Report queries', nativeReport.report.id);
      run('node', ['scripts/demo.mjs', 'check'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const filename = await kubeconfig(env);
      const deployments = JSON.parse(kubectl(filename, ['-n', 'payments', 'get', 'deployments', '-l', 'application=payments', '-o', 'json']));
      const images = Object.fromEntries(deployments.items.map(item => [item.metadata.name, item.spec.template.spec.containers[0].image]));
      const recovery = JSON.parse(await readFile(path.join(root, 'artifacts/recover.json'), 'utf8'));
      validateRecovery(recovery, env, release, images);
      record('fresh current-deployment recovery, latency and isolation', recovery.utc);
      run('node', ['scripts/agent.mjs', 'repo'], { stdio: ['ignore', 'pipe', 'pipe'] });
      record('current Code Access connection test', 'Source publication and deployed commit are separate gates.');
    }
  }
}
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const report = { utc: new Date().toISOString(), cloudVerified: cloud, mode, checks, customerDemoFullyReady: false, remaining, securityCaveat: 'Container base diagnostics retain 11 High warnings; no critical issues reported on final base. No public API ingress.' };
await writeFile(path.join(root, 'artifacts/verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));