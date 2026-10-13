import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProvider } from '../app/src/provider.mjs';
import { createPaymentApp } from '../app/src/app.mjs';
import { createProviderClient as affectedClient } from '../app/releases/v1.9/provider-client.mjs';
import { cascadeTraffic, healthyTraffic, summarize } from './traffic.mjs';
import { root } from './cloud.mjs';

const servers = [];
async function listen(server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
try {
  const logs = [];
  const providerUrl = await listen(createProvider({ log: event => logs.push(event) }));
  const affectedUrl = await listen(createPaymentApp({ providerUrl, release: 'v1.9', clientFactory: affectedClient, log: event => logs.push(event) }));
  const affected = await cascadeTraffic(affectedUrl);
  for (const result of affected) assert.equal(result.status, 504);
  assert.equal((await fetch(`${affectedUrl}/health`)).status, 200);
  const healthyUrl = await listen(createPaymentApp({ providerUrl, release: 'v1.8', log: event => logs.push(event) }));
  const isolated = await cascadeTraffic(healthyUrl);
  assert.equal(isolated[0].status, 504);
  assert.equal(isolated[1].status, 200);
  assert.equal(isolated[2].status, 200);
  const baseline = summarize(await healthyTraffic(healthyUrl));
  for (const result of baseline) { assert.equal(result.failures, 0); assert(result.p95Ms <= 1000); }
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/local-smoke.json'), JSON.stringify({ utc: new Date().toISOString(), affected, isolated, baseline, logs }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', actualCpuProvider: true, affected: summarize(affected), isolated: summarize(isolated), baseline }, null, 2));
} finally {
  for (const server of servers) { server.closeAllConnections(); server.close(); }
}