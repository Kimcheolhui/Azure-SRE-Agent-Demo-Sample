import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderClient as healthyClient } from '../app/src/provider-client.mjs';
import { createProviderClient as affectedClient } from '../app/releases/v1.9/provider-client.mjs';

function pendingProvider() {
  const requests = new Map();
  return {
    requests,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      const requestId = JSON.parse(options.body).requestId;
      if (options.signal.aborted) return reject(new DOMException('Request aborted', 'AbortError'));
      options.signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
      requests.set(requestId, { signal: options.signal, complete: () => resolve({ ok: true, json: async () => ({ approved: true, requestId }) }) });
    })
  };
}

test('v1.9 shares cancellation across concurrent and subsequent requests', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = pendingProvider();
  const client = affectedClient({ providerUrl: 'http://provider', fetchImpl: provider.fetchImpl });
  const firstCheck = assert.rejects(client.authorize({ requestId: 'request-a' }), { name: 'AbortError' });
  context.mock.timers.tick(2900);
  const secondCheck = assert.rejects(client.authorize({ requestId: 'request-b' }), { name: 'AbortError' });
  context.mock.timers.tick(100);
  await Promise.all([firstCheck, secondCheck]);
  assert.equal(provider.requests.get('request-a').signal, provider.requests.get('request-b').signal);
  const observations = [];
  await assert.rejects(client.authorize({ requestId: 'request-c' }, event => observations.push(event)), { name: 'AbortError' });
  assert.equal(observations[0].signalAborted, true);
  assert.equal(provider.requests.has('request-c'), false);
});

test('healthy release isolates timeout and allows concurrent and subsequent requests', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = pendingProvider();
  const client = healthyClient({ providerUrl: 'http://provider', fetchImpl: provider.fetchImpl });
  const firstCheck = assert.rejects(client.authorize({ requestId: 'request-a' }), { name: 'AbortError' });
  context.mock.timers.tick(2900);
  const second = client.authorize({ requestId: 'request-b' });
  context.mock.timers.tick(100);
  await firstCheck;
  assert.equal(provider.requests.get('request-b').signal.aborted, false);
  provider.requests.get('request-b').complete();
  assert.equal((await second).approved, true);
  const third = client.authorize({ requestId: 'request-c' });
  provider.requests.get('request-c').complete();
  assert.equal((await third).approved, true);
});