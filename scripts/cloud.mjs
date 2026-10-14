import { execFileSync, spawn } from "node:child_process";
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
}
export function json(command, args, options) {
  return JSON.parse(run(command, args, options));
}
export function runStreaming(command, args, { input, onStderr = chunk => process.stderr.write(chunk) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 20 * 1024 * 1024) {
        child.kill();
        reject(new Error(`${command} output exceeded the buffer limit`));
      }
    });
    child.stderr.on("data", chunk => {
      try { onStderr(chunk); } catch (error) { child.kill(); reject(error); }
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code ?? signal}`));
    });
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}
export function deploymentOutputs(outputs) {
  return Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key.toUpperCase(), value.value]));
}
export function applyPresenterTarget(values, target) {
  const name = `sre-${values.AZURE_ENV_NAME}-presenter`;
  const resourceId = `/subscriptions/${values.AZURE_SUBSCRIPTION_ID}/resourceGroups/${values.AGENT_RESOURCE_GROUP}/providers/Microsoft.App/agents/${name}`;
  if (target.SRE_AGENT_NAME !== name || target.SRE_AGENT_RESOURCE_ID !== resourceId) throw new Error('Presenter target does not match this dedicated environment');
  const allowed = ['SRE_AGENT_NAME', 'SRE_AGENT_RESOURCE_ID', 'SRE_AGENT_ENDPOINT', 'SRE_AGENT_IDENTITY_ID', 'SRE_AGENT_PRINCIPAL_ID', 'SRE_AGENT_SYSTEM_PRINCIPAL_ID'];
  return { ...values, ...Object.fromEntries(allowed.filter(key => target[key] !== undefined).map(key => [key, target[key]])) };
}
export function settings() {
  const values = json('azd', ['env', 'get-values', '--output', 'json']);
  if (!process.env.DEMO_TARGET || process.env.DEMO_TARGET === 'rehearsal') return validateTarget(values);
  if (process.env.DEMO_TARGET !== 'presenter') throw new Error('DEMO_TARGET must be rehearsal or presenter');
  const target = JSON.parse(readFileSync(path.join(root, 'artifacts/presenter-target.json'), 'utf8'));
  return validateTarget(applyPresenterTarget(values, target));
}
export function validateTarget(values) {
  if (!/^[a-f0-9-]{36}$/i.test(values.AZURE_SUBSCRIPTION_ID || '') || !/^[a-z][a-z0-9-]{2,15}$/.test(values.AZURE_ENV_NAME || '')) throw new Error('Invalid demo subscription or environment');
  const expected = { AZURE_RESOURCE_GROUP: `rg-${values.AZURE_ENV_NAME}-workload`, AGENT_RESOURCE_GROUP: `rg-${values.AZURE_ENV_NAME}-agent`, AZURE_AKS_CLUSTER_NAME: `aks-${values.AZURE_ENV_NAME}` };
  for (const [key, value] of Object.entries(expected)) if (values[key] !== value) throw new Error(`Demo target mismatch: ${key}`);
  if (![ `sre-${values.AZURE_ENV_NAME}`, `sre-${values.AZURE_ENV_NAME}-presenter` ].includes(values.SRE_AGENT_NAME)) throw new Error('Demo Agent name mismatch');
  const agentId = `/subscriptions/${values.AZURE_SUBSCRIPTION_ID}/resourceGroups/${values.AGENT_RESOURCE_GROUP}/providers/Microsoft.App/agents/${values.SRE_AGENT_NAME}`;
  if (values.SRE_AGENT_RESOURCE_ID?.toLowerCase() !== agentId.toLowerCase()) throw new Error('Demo Agent resource ID mismatch');
  if (!/^acrsredemo[a-z0-9]+$/.test(values.AZURE_CONTAINER_REGISTRY_NAME || '')) throw new Error('Demo registry name mismatch');
  return values;
}
export function validateOwnership(values, resources) {
  validateTarget(values);
  const base = `/subscriptions/${values.AZURE_SUBSCRIPTION_ID}/resourceGroups/`;
  for (const [key, groupName] of [['workloadGroup', values.AZURE_RESOURCE_GROUP], ['agentGroup', values.AGENT_RESOURCE_GROUP]]) {
    const group = resources[key];
    if (group?.id?.toLowerCase() !== `${base}${groupName}`.toLowerCase() || group.tags?.purpose !== 'sre-customer-demo' || group.tags?.['azd-env-name'] !== values.AZURE_ENV_NAME) throw new Error(`Unowned demo resource group: ${key}`);
  }
  for (const [key, identifier] of [['cluster', `${base}${values.AZURE_RESOURCE_GROUP}/providers/Microsoft.ContainerService/managedClusters/${values.AZURE_AKS_CLUSTER_NAME}`], ['registry', `${base}${values.AZURE_RESOURCE_GROUP}/providers/Microsoft.ContainerRegistry/registries/${values.AZURE_CONTAINER_REGISTRY_NAME}`], ['agent', values.SRE_AGENT_RESOURCE_ID]]) if (resources[key]?.id?.toLowerCase() !== identifier.toLowerCase()) throw new Error(`Foreign demo resource: ${key}`);
  if (resources.agent.tags?.purpose !== 'sre-customer-demo' || new URL(resources.agent.endpoint).href !== new URL(values.SRE_AGENT_ENDPOINT).href || resources.registry.loginServer !== values.AZURE_CONTAINER_REGISTRY_ENDPOINT) throw new Error('Demo endpoint or ownership mismatch');
  return values;
}
export function environment() {
  const values = settings();
  const subscription = ['--subscription', values.AZURE_SUBSCRIPTION_ID];
  const resources = {
    workloadGroup: json('az', ['group', 'show', ...subscription, '-n', values.AZURE_RESOURCE_GROUP, '--query', '{id:id,tags:tags}', '-o', 'json']),
    agentGroup: json('az', ['group', 'show', ...subscription, '-n', values.AGENT_RESOURCE_GROUP, '--query', '{id:id,tags:tags}', '-o', 'json']),
    cluster: json('az', ['aks', 'show', ...subscription, '-g', values.AZURE_RESOURCE_GROUP, '-n', values.AZURE_AKS_CLUSTER_NAME, '--query', '{id:id}', '-o', 'json']),
    registry: json('az', ['acr', 'show', ...subscription, '-n', values.AZURE_CONTAINER_REGISTRY_NAME, '--query', '{id:id,loginServer:loginServer}', '-o', 'json']),
    agent: json('az', ['resource', 'show', '--ids', values.SRE_AGENT_RESOURCE_ID, '--api-version', '2026-01-01', '--query', '{id:id,tags:tags,endpoint:properties.agentEndpoint}', '-o', 'json'])
  };
  return validateOwnership(values, resources);
}
export function validateRelease(values, release) {
  for (const [key, value] of [['subscription', values.AZURE_SUBSCRIPTION_ID], ['resourceGroup', values.AZURE_RESOURCE_GROUP], ['cluster', values.AZURE_AKS_CLUSTER_NAME]]) if (release[key] !== value) throw new Error(`Release target mismatch: ${key}`);
  for (const version of ['v1.8', 'v1.9']) if (!release.images?.[version]?.startsWith(`${values.AZURE_CONTAINER_REGISTRY_ENDPOINT}/payment-api@sha256:`) || !/@sha256:[a-f0-9]{64}$/.test(release.images[version])) throw new Error('Release image is not a digest from the selected demo registry');
  return release;
}
export async function kubeconfig(values) {
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  const filename = path.join(root, 'artifacts', 'demo.kubeconfig');
  run('az', ['aks', 'get-credentials', '--subscription', values.AZURE_SUBSCRIPTION_ID, '-g', values.AZURE_RESOURCE_GROUP, '-n', values.AZURE_AKS_CLUSTER_NAME, '--file', filename, '--overwrite-existing'], { stdio: ['ignore', 'ignore', 'pipe'] });
  run('kubelogin', ['convert-kubeconfig', '-l', 'azurecli', '--kubeconfig', filename]);
  return filename;
}
export function kubectl(filename, args, input) {
  return run('kubectl', ['--kubeconfig', filename, ...args], { input });
}