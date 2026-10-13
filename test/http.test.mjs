import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPaymentApp } from '../app/src/app.mjs';
import { createProvider } from '../app/src/provider.mjs';
import { createProviderClient as affectedClient } from '../app/releases/v1.9/provider-client.mjs';

async function listen(server, context) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real API and provider authorize card/bank and reject invalid inputs', async context => {
  const providerUrl = await listen(createProvider({ log() {} }), context);
  const requests = [];
  const dependencies = [];
  const telemetry = { request: item => requests.push(item), dependency: item => dependencies.push(item), exception() {} };
  const url = await listen(createPaymentApp({ providerUrl, telemetry, log() {} }), context);
  for (const method of ['card', 'bank']) {
    const response = await fetch(`${url}/pay?method=${method}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).approved, true);
  }
  assert.equal(requests[0].properties['http.method'], 'GET');
  assert.equal(dependencies[0].properties['http.method'], 'POST');
  assert.equal(requests[0].id, dependencies[0].id);
  assert.equal(requests[0].resultCode, '200');
  assert.equal((await fetch(`${url}/pay?amount=-1`)).status, 400);
  assert.equal((await fetch(`${url}/pay?signatureIterations=40000001`)).status, 400);
  assert.equal((await fetch(`${url}/pay`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
});

test('HTTP requests expose v1.9 failure cascade while health remains available', async context => {
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const reply = () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ approved: true })); };
    if (payload.amount === 999) setTimeout(reply, 400);
    else setTimeout(reply, 30);
  });
  const providerUrl = await listen(provider, context);
  const events = [];
  const url = await listen(createPaymentApp({ providerUrl, timeoutMs: 200, clientFactory: affectedClient, log: event => events.push(event) }), context);
  const first = fetch(`${url}/pay?amount=999`);
  await new Promise(resolve => setTimeout(resolve, 185));
  const second = fetch(`${url}/pay?amount=1`);
  assert.equal((await first).status, 504);
  assert.equal((await second).status, 504);
  assert.equal((await fetch(`${url}/pay?method=bank`)).status, 504);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert(events.some(event => event.signalAborted === true));
  assert(events.some(event => event.errorType === 'AbortError'));
});