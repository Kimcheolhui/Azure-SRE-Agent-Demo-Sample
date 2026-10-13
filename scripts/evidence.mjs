import { summarize } from './traffic.mjs';
import { completedReply } from './runtime.mjs';
import { validateRelease } from './cloud.mjs';

export function evidenceBinding(env, release) {
  validateRelease(env, release);
  return { subscription: env.AZURE_SUBSCRIPTION_ID, resourceGroup: env.AZURE_RESOURCE_GROUP, cluster: env.AZURE_AKS_CLUSTER_NAME, agentId: env.SRE_AGENT_RESOURCE_ID, images: release.images, sourceCommit: release.sourceCommit };
}
export function sameBinding(value, env, release) {
  const expected = evidenceBinding(env, release);
  for (const key of ['subscription', 'resourceGroup', 'cluster', 'agentId', 'sourceCommit']) if (value?.[key] !== expected[key]) throw new Error(`Evidence target mismatch: ${key}`);
  if (JSON.stringify(value.images) !== JSON.stringify(expected.images)) throw new Error('Evidence references different deployed images');
}
export function validateRecovery(value, env, release, currentImages, { now = Date.now(), maxAgeMs = 600000 } = {}) {
  sameBinding(value, env, release);
  const age = now - Date.parse(value.utc);
  if (!Number.isFinite(age) || age < -30000 || age > maxAgeMs) throw new Error('Recovery evidence is stale or has an invalid timestamp');
  for (const name of ['payment-api', 'payment-api-canary', 'payment-provider']) if (currentImages[name] !== release.images['v1.8'] || value.deploymentImages?.[name] !== currentImages[name]) throw new Error(`Current deployment is not the verified healthy image: ${name}`);
  if (value.version?.release !== 'v1.8' || value.version.sourceCommit !== release.sourceCommit) throw new Error('Measured API version does not match the verified release');
  const normal = value.results?.filter(item => item.method) || [];
  for (const method of ['card', 'bank']) {
    const rows = normal.filter(item => item.method === method);
    if (rows.length !== 20 || rows.some(item => item.status !== 200)) throw new Error('Fresh recovery requests did not meet the twenty-per-method success criterion');
  }
  if (summarize(normal).some(item => item.p95Ms > 1000)) throw new Error('Recovery p95 exceeds the normal criterion');
  if (JSON.stringify(value.results.slice(0,3).map(item => item.status)) !== '[504,200,200]') throw new Error('Recovery did not verify cancellation isolation');
  return value;
}
export function matchingIncident(thread, env, run) {
  const ruleId = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.AZURE_RESOURCE_GROUP}/providers/Microsoft.Insights/scheduledQueryRules/${env.PAYMENT_ALERT_NAME}`;
  return thread?.source === 'Incident' && thread.threadOrigin === 'Trigger' && thread.incidentSource?.incidentId?.toLowerCase() === ruleId.toLowerCase() && thread.incidentDetails?.filterId === 'payment-alert-response' && thread.status?.incidentStatus?.incidentId === run.alertId && Date.parse(thread.incidentDetails.incidentCreatedTime) >= Date.parse(run.startedUtc) && Date.parse(thread.lastMessage?.timeStamp) >= Date.parse(run.startedUtc) && completedReply(thread);
}