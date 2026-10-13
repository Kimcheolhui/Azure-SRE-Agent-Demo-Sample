import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root, run, json, environment } from './cloud.mjs';
import { configuration } from './configuration.mjs';
import { createRuntimeClient, items } from './runtime.mjs';

const action = process.argv[2];
if (!['status', 'connect', 'knowledge', 'skill', 'agent', 'incidents', 'schedule', 'repo', 'setup', 'search'].includes(action)) throw new Error('Usage: node scripts/agent.mjs status|connect|knowledge|skill|agent|incidents|schedule|repo|setup|search');
const values = environment();
const subscription = values.AZURE_SUBSCRIPTION_ID;
if (!subscription || !values.AZURE_ENV_NAME) throw new Error('Select an azd environment before configuring the Agent');
values.AZURE_RESOURCE_GROUP ||= `rg-${values.AZURE_ENV_NAME}-workload`;
values.AZURE_AKS_CLUSTER_NAME ||= `aks-${values.AZURE_ENV_NAME}`;
values.SRE_AGENT_NAME ||= `sre-${values.AZURE_ENV_NAME}`;
values.AGENT_RESOURCE_GROUP ||= `rg-${values.AZURE_ENV_NAME}-agent`;
values.SRE_AGENT_RESOURCE_ID ||= `/subscriptions/${subscription}/resourceGroups/${values.AGENT_RESOURCE_GROUP}/providers/Microsoft.App/agents/${values.SRE_AGENT_NAME}`;
values.PAYMENT_ALERT_NAME ||= `payment-api-errors-${values.AZURE_AKS_CLUSTER_NAME}`;
const agent = json('az', ['resource', 'show', '--ids', values.SRE_AGENT_RESOURCE_ID, '--api-version', '2026-01-01', '-o', 'json']);
if (agent.tags?.purpose !== 'sre-customer-demo') throw new Error('Refusing to configure a non-demo Agent');
const tenant = json('az', ['account', 'show', '--query', 'tenantId', '-o', 'json']);
const token = run('az', ['account', 'get-access-token', '--tenant', tenant, '--scope', '59f0a04a-b322-4310-adc9-39ac41e9631e/.default', '--query', 'accessToken', '-o', 'tsv'], { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const api = createRuntimeClient(agent.properties.agentEndpoint, token);
await api('/api/v2/extendedAgent/agents');
await mkdir(path.join(root, 'artifacts'), { recursive: true });

function arm(method, suffix, body) {
  const wait = () => run('az', ['resource', 'wait', '--ids', values.SRE_AGENT_RESOURCE_ID, '--api-version', '2026-01-01', '--updated', '--interval', '5', '--timeout', '600']);
  if (method !== 'get') wait();
  const args = ['rest', '--method', method, '--url', `https://management.azure.com${values.SRE_AGENT_RESOURCE_ID}${suffix}?api-version=2026-01-01`];
  if (body) args.push('--body', JSON.stringify(body));
  const output = run('az', args);
  if (method !== 'get') wait();
  return output.trim() ? JSON.parse(output) : null;
}
async function connect() {
  const groupId = `/subscriptions/${subscription}/resourceGroups/${values.AZURE_RESOURCE_GROUP}`;
  arm('patch', '', { properties: { knowledgeGraphConfiguration: { identity: agent.properties.knowledgeGraphConfiguration.identity, managedResources: [groupId] } } });
  const workspaceId = `${groupId}/providers/Microsoft.OperationalInsights/workspaces/law-${values.AZURE_AKS_CLUSTER_NAME}`;
  const insightsId = `${groupId}/providers/Microsoft.Insights/components/appi-${values.AZURE_AKS_CLUSTER_NAME}`;
  const appId = json('az', ['resource', 'show', '--ids', insightsId, '--api-version', '2020-02-02', '--query', 'properties.AppId', '-o', 'json']);
  for (const [name, type, resourceId, extras] of [['payment-logs', 'LogAnalytics', workspaceId, {}], ['payment-insights', 'AppInsights', insightsId, { appId }]]) {
    arm('put', `/connectors/${name}`, { properties: { dataConnectorType: type, dataSource: resourceId, identity: 'system', extendedProperties: { armResourceId: resourceId, resource: { name: resourceId.split('/').at(-1) }, ...extras } } });
  }
  const saved = arm('get', '/connectors');
  console.log(JSON.stringify({ stage: 'connect', connectors: saved.value?.map(item => ({ name: item.name, type: item.properties.dataConnectorType })) }));
}
async function knowledge() {
  for (const name of ['service-context.md', 'runbook.md']) {
    const form = new FormData();
    form.append('files', new Blob([await readFile(path.join(root, 'agent/knowledge', name), 'utf8')], { type: 'text/markdown' }), name);
    await api('/api/v1/AgentMemory/upload', 'POST', form);
  }
  const files = await api('/api/v1/AgentMemory/files');
  await writeFile(path.join(root, 'artifacts/knowledge-files.json'), JSON.stringify(files, null, 2));
  const listed = items(files);
  console.log(JSON.stringify({ stage: 'knowledge', filesListed: listed.length, indexingVerified: listed.length > 0 && listed.every(file => file.isIndexed === true) }));
}
async function skill() {
  const content = await readFile(path.join(root, 'agent/skills/payment-investigation/SKILL.md'), 'utf8');
  const payload = { name: 'payment-investigation', type: 'Skill', properties: { description: 'Investigate payment failures and latency with deployed-source and instance-specific evidence.', skillContent: content } };
  await api('/api/v2/extendedAgent/skills/payment-investigation', 'PUT', payload);
  const saved = await api('/api/v2/extendedAgent/skills');
  if (!JSON.stringify(saved).includes('payment-investigation')) throw new Error('Saved Skill missing from service list');
  console.log(JSON.stringify({ stage: 'skill', saved: true }));
}
async function specialist() {
  const payload = await configuration('agent/payment-specialist.json', values);
  await api(`/api/v2/extendedAgent/agents/${payload.name}`, 'PUT', payload);
  const saved = await api(`/api/v2/extendedAgent/agents/${payload.name}`);
  if (saved.name !== payload.name) throw new Error('Saved specialist name mismatch');
  console.log(JSON.stringify({ stage: 'agent', name: saved.name }));
}
async function incidents() {
  arm('patch', '', { properties: { incidentManagementConfiguration: { type: 'AzMonitor', connectionName: 'azmonitor', connectionUrl: '' } } });
  const filters = await api('/api/v2/extendedAgent/incidentFilters');
  for (const filter of items(filters).filter(item => /quickstart/i.test(item.name))) await api(`/api/v2/extendedAgent/incidentFilters/${encodeURIComponent(filter.name)}`, 'PUT', { ...filter, properties: { ...filter.properties, isEnabled: false } });
  const plan = await configuration('agent/response-plan.json', values);
  await api(`/api/v2/extendedAgent/incidentFilters/${plan.name}`, 'PUT', plan);
  const saved = await api(`/api/v2/extendedAgent/incidentFilters/${plan.name}`);
  if (saved.properties.handlingAgent !== plan.properties.handlingAgent || saved.properties.titleContains !== plan.properties.titleContains) throw new Error('Saved Response Plan routing does not match the demo');
  console.log(JSON.stringify({ stage: 'incidents', name: saved.name, agent: saved.properties.handlingAgent, titleContains: saved.properties.titleContains }));
}
async function schedule() {
  const task = await configuration('agent/scheduled-task.json', values);
  await api(`/api/v2/extendedAgent/scheduledtasks/${task.name}`, 'PUT', task);
  const matches = items(await api('/api/v1/scheduledtasks')).filter(item => item.name === task.name);
  if (matches.length !== 1 || !matches[0].id) throw new Error('Expected exactly one saved demo schedule');
  await api(`/api/v1/scheduledtasks/${matches[0].id}/pause`, 'POST', {});
  const saved = await api(`/api/v1/scheduledtasks/${matches[0].id}`);
  if (saved.status !== 'Paused') throw new Error('Task must stay paused until explicitly enabled');
  console.log(JSON.stringify({ stage: 'schedule', name: saved.name, status: saved.status }));
}
async function repo() {
  const payload = { name: 'payment-demo', type: 'CodeRepo', properties: { url: 'https://github.com/Kimcheolhui/Azure-SRE-Agent-Demo-Sample', type: 'GitHub', branch: 'main' } };
  let registered = false;
  try {
    await api('/api/v2/repos/payment-demo', 'PUT', payload);
    registered = true;
    const result = await api('/api/v2/repos/payment-demo/test', 'POST', {});
    await writeFile(path.join(root, 'artifacts/code-access-test.json'), JSON.stringify({ registered, result }, null, 2), { mode: 0o600 });
    if (result?.isSuccessful !== true) throw new Error('Repository registration succeeded but the actual Code Access connection test failed');
    console.log(JSON.stringify({ stage: 'repo', registered, connectionTestPassed: true, sourcePublicationStillRequired: true }));
  } catch (error) {
    await writeFile(path.join(root, 'artifacts/code-access-test.json'), JSON.stringify({ registered, githubCodeAccessVerified: false, error: error.message }, null, 2));
    throw error;
  }
}
async function status() {
  const agents = await api('/api/v2/extendedAgent/agents');
  const skills = await api('/api/v2/extendedAgent/skills');
  const threads = await api('/api/v1/threads');
  console.log(JSON.stringify({ endpoint: agent.properties.agentEndpoint, provisioning: agent.properties.provisioningState, agents: items(agents).map(item => item.name), skills: items(skills).map(item => item.name), threadCount: items(threads).length }, null, 2));
}
async function search() {
  const result = await api('/api/v1/AgentMemory/documents?query=Payments%20normal%20criteria%201000ms&k=5');
  const count = items(result).length;
  await writeFile(path.join(root, 'artifacts/knowledge-search.json'), JSON.stringify(result, null, 2));
  if (!count) throw new Error('Knowledge upload exists but retrieval has not been verified');
  console.log(JSON.stringify({ stage: 'search', results: count }));
}
const operations = { connect, knowledge, skill, agent: specialist, incidents, schedule, repo, status, search };
if (action === 'setup') for (const operation of [connect, skill, specialist, knowledge, incidents, schedule]) await operation();
else await operations[action]();