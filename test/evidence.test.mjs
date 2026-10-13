import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceBinding, validateRecovery, matchingIncident } from '../scripts/evidence.mjs';

function fixture() {
  const env = { AZURE_SUBSCRIPTION_ID: 'sub', AZURE_RESOURCE_GROUP: 'rg-demo-workload', AZURE_AKS_CLUSTER_NAME: 'aks-demo', SRE_AGENT_RESOURCE_ID: 'agent', AZURE_CONTAINER_REGISTRY_ENDPOINT: 'registry.azurecr.io', PAYMENT_ALERT_NAME: 'payment-alert' };
  const image = `registry.azurecr.io/payment-api@sha256:${'a'.repeat(64)}`;
  const release = { subscription: 'sub', resourceGroup: 'rg-demo-workload', cluster: 'aks-demo', sourceCommit: 'commit', images: { 'v1.8': image, 'v1.9': image.replace(/a{64}/, 'b'.repeat(64)) } };
  const currentImages = { 'payment-api': image, 'payment-api-canary': image, 'payment-provider': image };
  const results = [{ status: 504 }, { status: 200 }, { status: 200 }];
  for (const method of ['card', 'bank']) for (let round = 0; round < 20; round++) results.push({ method, status: 200, elapsedMs: 20 });
  const value = { ...evidenceBinding(env, release), utc: new Date().toISOString(), deploymentImages: currentImages, version: { release: 'v1.8', sourceCommit: 'commit' }, results };
  return { env, release, currentImages, value };
}
test('only fresh evidence bound to actual images and targets establishes recovery', () => {
  const { env, release, currentImages, value } = fixture();
  assert.equal(validateRecovery(value, env, release, currentImages), value);
  assert.throws(() => validateRecovery({ ...value, utc: '2000-01-01T00:00:00Z' }, env, release, currentImages), /stale/);
  assert.throws(() => validateRecovery({ ...value, subscription: 'foreign' }, env, release, currentImages), /target mismatch/);
  assert.throws(() => validateRecovery(value, env, release, { ...currentImages, 'payment-api-canary': release.images['v1.9'] }), /healthy image/);
  const slow = value.results.map(item => item.method === 'card' ? { ...item, elapsedMs: 1500 } : item);
  assert.throws(() => validateRecovery({ ...value, results: slow }, env, release, currentImages), /p95/);
});
test('an old or unrelated incident cannot count as the current automatic investigation', () => {
  const { env } = fixture();
  const now = new Date().toISOString();
  const run = { alertId: 'new-alert', startedUtc: now };
  const thread = { source: 'Incident', threadOrigin: 'Trigger', incidentSource: { incidentId: '/subscriptions/sub/resourceGroups/rg-demo-workload/providers/Microsoft.Insights/scheduledQueryRules/payment-alert' }, incidentDetails: { filterId: 'payment-alert-response', incidentCreatedTime: now }, status: { incidentStatus: { incidentId: 'new-alert' } }, lastMessage: { author: { role: 'SREAgent' }, isComplete: true, text: 'Current findings', timeStamp: now } };
  assert.equal(matchingIncident(thread, env, run), true);
  assert.equal(matchingIncident({ ...thread, lastMessage: { ...thread.lastMessage, timeStamp: '2000-01-01T00:00:00Z' } }, env, run), false);
  assert.equal(matchingIncident(thread, env, { ...run, alertId: 'different-alert' }), false);
  assert.equal(matchingIncident({ ...thread, incidentDetails: { ...thread.incidentDetails, filterId: 'different-plan' } }, env, run), false);
});