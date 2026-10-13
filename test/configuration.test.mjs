import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { configuration } from '../scripts/configuration.mjs';

test('response plan selects the payment alert and configured specialist', async () => {
  const plan = await configuration('agent/response-plan.json', { PAYMENT_ALERT_NAME: 'payment-api-errors-test' });
  const agent = await configuration('agent/payment-specialist.json', {});
  assert.equal(plan.properties.handlingAgent, agent.name);
  assert.equal(plan.properties.titleContains, 'payment-api-errors-test');
  assert.deepEqual(plan.properties.priorities, ['Sev2']);
  assert.equal(plan.properties.agentMode, 'Review');
  assert(!JSON.stringify(agent).includes('AbortController'));
});
test('missing configuration values fail rather than broaden incident routing', async () => {
  await assert.rejects(configuration('agent/response-plan.json', {}), /PAYMENT_ALERT_NAME/);
});
test('scheduled task is paused by default and resolves the exact workload', async () => {
  const task = await configuration('agent/scheduled-task.json', { AZURE_RESOURCE_GROUP: 'rg-test-workload', AZURE_AKS_CLUSTER_NAME: 'aks-test' });
  assert.equal(task.properties.status, 'Paused');
  assert.equal(task.properties.cronExpression, '0 0 * * *');
  assert(task.properties.agentPrompt.includes('aks-test'));
});
test('deployment manifest uses isolated namespace, bounded resources and no public service', async () => {
  const manifest = JSON.parse(await readFile(new URL('../k8s/workload.json', import.meta.url), 'utf8'));
  for (const item of manifest.items) {
    if (item.kind === 'Deployment') {
      assert.equal(item.metadata.namespace, 'payments');
      assert.equal(item.spec.template.spec.securityContext.runAsNonRoot, true);
      for (const container of item.spec.template.spec.containers) assert(container.resources.limits.memory);
    }
    if (item.kind === 'Service') assert(!item.spec.type || item.spec.type === 'ClusterIP');
  }
});