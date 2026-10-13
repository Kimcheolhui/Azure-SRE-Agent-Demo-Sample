import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, run, json, deploymentOutputs, applyPresenterTarget } from './cloud.mjs';

const mode = process.argv[2];
if (!['--preview', '--provision', '--recover'].includes(mode)) throw new Error('Usage: node scripts/presenter.mjs --preview|--provision|--recover');
const values = json('azd', ['env', 'get-values', '--output', 'json']);
const name = `sre-${values.AZURE_ENV_NAME}-presenter`;
const common = ['--subscription', values.AZURE_SUBSCRIPTION_ID, '--resource-group', values.AGENT_RESOURCE_GROUP, '--name', `${values.AZURE_ENV_NAME}-presenter`, '--template-file', 'infra/presenter.bicep', '--parameters', `agentName=${name}`, `principalId=${values.AZURE_PRINCIPAL_ID}`, `workloadResourceGroupName=${values.AZURE_RESOURCE_GROUP}`, `clusterName=${values.AZURE_AKS_CLUSTER_NAME}`, `workspaceName=law-${values.AZURE_AKS_CLUSTER_NAME}`, `insightsName=appi-${values.AZURE_AKS_CLUSTER_NAME}`];
if (mode !== '--recover') run('az', ['deployment', 'group', 'what-if', ...common], { stdio: 'inherit' });
if (mode === '--preview') process.exit(0);
const result = mode === '--recover'
  ? json('az', ['deployment', 'group', 'show', '--subscription', values.AZURE_SUBSCRIPTION_ID, '-g', values.AGENT_RESOURCE_GROUP, '-n', `${values.AZURE_ENV_NAME}-presenter`, '-o', 'json'])
  : json('az', ['deployment', 'group', 'create', ...common, '-o', 'json']);
if (result.properties.provisioningState !== 'Succeeded') throw new Error('Presenter deployment did not succeed');
const target = deploymentOutputs(result.properties.outputs);
applyPresenterTarget(values, target);
if (!/^[a-f0-9-]{36}$/i.test(target.SRE_AGENT_PRINCIPAL_ID)) throw new Error('Presenter principal output is missing or invalid');
if (values.ENABLE_INCIDENT_SCANNING === 'true') {
  run('az', ['role', 'assignment', 'create', '--subscription', values.AZURE_SUBSCRIPTION_ID, '--assignee-object-id', target.SRE_AGENT_PRINCIPAL_ID, '--assignee-principal-type', 'ServicePrincipal', '--role', '749f88d5-cbae-40b8-bcfc-e573ddc772fa', '--scope', `/subscriptions/${values.AZURE_SUBSCRIPTION_ID}`, '-o', 'none']);
}
await mkdir(path.join(root, 'artifacts'), { recursive: true });
await writeFile(path.join(root, 'artifacts/presenter-target.json'), JSON.stringify(target, null, 2));
console.log(JSON.stringify({ presenterAgent: target.SRE_AGENT_NAME, resourceId: target.SRE_AGENT_RESOURCE_ID, connectionsPreconfigured: false, hasOwnBillableAgent: true }));