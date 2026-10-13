import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPresenterTarget, deploymentOutputs, validateTarget, validateOwnership, validateRelease } from '../scripts/cloud.mjs';

test('presenter selection keeps the same workload and rejects foreign Agent targets', () => {
  const values = { AZURE_ENV_NAME: 'demo', AZURE_SUBSCRIPTION_ID: 'subscription', AGENT_RESOURCE_GROUP: 'rg-demo-agent', AZURE_RESOURCE_GROUP: 'rg-demo-workload' };
  const target = { SRE_AGENT_NAME: 'sre-demo-presenter', SRE_AGENT_RESOURCE_ID: '/subscriptions/subscription/resourceGroups/rg-demo-agent/providers/Microsoft.App/agents/sre-demo-presenter', SRE_AGENT_ENDPOINT: 'https://presenter.azuresre.ai' };
  assert.equal(applyPresenterTarget(values, target).AZURE_RESOURCE_GROUP, 'rg-demo-workload');
  assert.equal(applyPresenterTarget(values, { ...target, AZURE_RESOURCE_GROUP: 'foreign-workload' }).AZURE_RESOURCE_GROUP, 'rg-demo-workload');
  assert.throws(() => applyPresenterTarget(values, { ...target, SRE_AGENT_NAME: 'unrelated-agent' }), /dedicated environment/);
  assert.throws(() => applyPresenterTarget(values, { ...target, SRE_AGENT_RESOURCE_ID: '/subscriptions/other/agents/example' }), /dedicated environment/);
});

test('Azure CLI camel-cased deployment output names map to azd conventions', () => {
  assert.deepEqual(deploymentOutputs({ srE_AGENT_NAME: { value: 'sre-demo-presenter' }, srE_AGENT_PRINCIPAL_ID: { value: 'principal' } }), { SRE_AGENT_NAME: 'sre-demo-presenter', SRE_AGENT_PRINCIPAL_ID: 'principal' });
});

function ownedFixture() {
  const subscription = '00000000-0000-0000-0000-000000000001';
  const base = `/subscriptions/${subscription}/resourceGroups/`;
  const values = { AZURE_SUBSCRIPTION_ID: subscription, AZURE_ENV_NAME: 'demo', AZURE_RESOURCE_GROUP: 'rg-demo-workload', AGENT_RESOURCE_GROUP: 'rg-demo-agent', AZURE_AKS_CLUSTER_NAME: 'aks-demo', SRE_AGENT_NAME: 'sre-demo', SRE_AGENT_RESOURCE_ID: `${base}rg-demo-agent/providers/Microsoft.App/agents/sre-demo`, SRE_AGENT_ENDPOINT: 'https://demo.azuresre.ai', AZURE_CONTAINER_REGISTRY_NAME: 'acrsredemoexample', AZURE_CONTAINER_REGISTRY_ENDPOINT: 'acrsredemoexample.azurecr.io' };
  const tags = { purpose: 'sre-customer-demo', 'azd-env-name': 'demo' };
  const resources = { workloadGroup: { id: `${base}rg-demo-workload`, tags }, agentGroup: { id: `${base}rg-demo-agent`, tags }, cluster: { id: `${base}rg-demo-workload/providers/Microsoft.ContainerService/managedClusters/aks-demo` }, registry: { id: `${base}rg-demo-workload/providers/Microsoft.ContainerRegistry/registries/acrsredemoexample`, loginServer: values.AZURE_CONTAINER_REGISTRY_ENDPOINT }, agent: { id: values.SRE_AGENT_RESOURCE_ID, tags, endpoint: values.SRE_AGENT_ENDPOINT } };
  return { values, resources };
}
test('production-like names and foreign ARM IDs cannot pass demo target validation', () => {
  const { values } = ownedFixture();
  assert.equal(validateTarget(values), values);
  assert.throws(() => validateTarget({ ...values, AZURE_RESOURCE_GROUP: 'rg-production-payments' }), /mismatch/);
  assert.throws(() => validateTarget({ ...values, AZURE_AKS_CLUSTER_NAME: 'aks-production-payments' }), /mismatch/);
  assert.throws(() => validateTarget({ ...values, SRE_AGENT_RESOURCE_ID: values.SRE_AGENT_RESOURCE_ID.replace('000000000001', '000000000002') }), /mismatch/);
});
test('ownership and actual endpoint are verified before workload mutations', () => {
  const { values, resources } = ownedFixture();
  assert.equal(validateOwnership(values, resources), values);
  assert.throws(() => validateOwnership(values, { ...resources, workloadGroup: { ...resources.workloadGroup, tags: {} } }), /Unowned/);
  assert.throws(() => validateOwnership(values, { ...resources, cluster: { id: '/subscriptions/other/cluster' } }), /Foreign/);
  assert.throws(() => validateOwnership(values, { ...resources, agent: { ...resources.agent, endpoint: 'https://other.azuresre.ai' } }), /mismatch/);
});
test('release evidence is bound to subscription, workload and registry digest', () => {
  const { values } = ownedFixture();
  const image = `${values.AZURE_CONTAINER_REGISTRY_ENDPOINT}/payment-api@sha256:${'a'.repeat(64)}`;
  const release = { subscription: values.AZURE_SUBSCRIPTION_ID, resourceGroup: values.AZURE_RESOURCE_GROUP, cluster: values.AZURE_AKS_CLUSTER_NAME, images: { 'v1.8': image, 'v1.9': image } };
  assert.equal(validateRelease(values, release), release);
  assert.throws(() => validateRelease(values, { ...release, subscription: 'other' }), /subscription/);
  assert.throws(() => validateRelease(values, { ...release, images: { ...release.images, 'v1.9': 'foreign.azurecr.io/image@sha256:' + 'a'.repeat(64) } }), /selected demo registry/);
});