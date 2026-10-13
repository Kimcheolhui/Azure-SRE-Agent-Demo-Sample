import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, run, json, environment, kubeconfig, kubectl } from './cloud.mjs';
import { buildFingerprint, publishedRevision } from './release.mjs';

const values = environment();
const filename = await kubeconfig(values);
const fingerprint = await buildFingerprint();
const sourceCommit = await publishedRevision();
const images = {};
for (const [release, clientSource] of [['v1.8', 'app/src/provider-client.mjs'], ['v1.9', 'app/releases/v1.9/provider-client.mjs']]) {
  const tag = `payment-api:${release}-${fingerprint}`;
  console.log(`Building ${release} in ACR`);
  run('az', ['acr', 'build', '--subscription', values.AZURE_SUBSCRIPTION_ID, '-r', values.AZURE_CONTAINER_REGISTRY_NAME, '--platform', 'linux/amd64', '-t', tag, '-f', 'app/Dockerfile', '--build-arg', `CLIENT_SOURCE=${clientSource}`, '--build-arg', `RELEASE=${release}`, '--build-arg', `SOURCE_COMMIT=${sourceCommit}`, '.'], { stdio: 'inherit' });
  const digest = json('az', ['acr', 'repository', 'show', '-n', values.AZURE_CONTAINER_REGISTRY_NAME, '--image', tag, '--query', 'digest', '-o', 'json']);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('ACR did not return an immutable digest');
  images[release] = `${values.AZURE_CONTAINER_REGISTRY_ENDPOINT}/payment-api@${digest}`;
}
kubectl(filename, ['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'payments', labels: { purpose: 'sre-customer-demo' } } }));
const connectionString = json('az', ['resource', 'show', '--ids', values.APPINSIGHTS_RESOURCE_ID, '--api-version', '2020-02-02', '--query', 'properties.ConnectionString', '-o', 'json']);
kubectl(filename, ['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'payment-telemetry', namespace: 'payments' }, type: 'Opaque', data: { 'connection-string': Buffer.from(connectionString).toString('base64') } }));
const manifest = JSON.parse(await readFile(path.join(root, 'k8s/workload.json'), 'utf8'));
for (const item of manifest.items.filter(item => item.kind === 'Deployment')) for (const container of item.spec.template.spec.containers) container.image = container.image === '__AFFECTED_IMAGE__' ? images['v1.9'] : images['v1.8'];
console.log(kubectl(filename, ['apply', '-f', '-'], JSON.stringify(manifest)));
for (const deployment of ['payment-api', 'payment-provider']) console.log(kubectl(filename, ['-n', 'payments', 'rollout', 'status', `deployment/${deployment}`, '--timeout=300s']));
await writeFile(path.join(root, 'artifacts/release.json'), JSON.stringify({ subscription: values.AZURE_SUBSCRIPTION_ID, resourceGroup: values.AZURE_RESOURCE_GROUP, cluster: values.AZURE_AKS_CLUSTER_NAME, sourceCommit, sourceFingerprint: fingerprint, images }, null, 2));
console.log('Workload ready. Use node scripts/demo.mjs baseline before connecting the Agent.');