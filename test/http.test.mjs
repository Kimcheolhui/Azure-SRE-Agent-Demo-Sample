import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createPaymentApp } from '../app/src/app.mjs';
import { createProvider } from '../app/src/provider.mjs';
import { createProviderClient as affectedClient } from '../app/releases/v1.9/provider-client.mjs';
import { request as paymentRequest, healthyTraffic, cascadeTraffic, createTrafficLogger } from '../scripts/traffic.mjs';
import { runStreaming } from '../scripts/cloud.mjs';

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

test('healthy traffic sends twenty sequential card/bank pairs and logs every response immediately', async context => {
  const lines = [];
  const methods = [];
  let active = 0;
  let maximumActive = 0;
  const server = http.createServer((request, response) => {
    assert.equal(lines.length, methods.length);
    active++;
    maximumActive = Math.max(maximumActive, active);
    methods.push(new URL(request.url, 'http://localhost').searchParams.get('method'));
    setImmediate(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ approved: true, instance: 'test-pod', requestId: `request-${methods.length}` }));
      active--;
    });
  });
  const url = await listen(server, context);
  const results = await healthyTraffic(url, 20, createTrafficLogger('baseline', 40, line => lines.push(line)));
  assert.equal(results.length, 40);
  assert.equal(maximumActive, 1);
  assert.deepEqual(methods, Array.from({ length: 20 }, () => ['card', 'bank']).flat());
  assert.equal(lines.length, 40);
  assert.match(lines[0], /^\[baseline 1\/40\] GET \/pay\?method=card -> HTTP 200 \d+ms approved=true/);
  assert.match(lines[39], /^\[baseline 40\/40\] GET \/pay\?method=bank -> HTTP 200/);
  assert(lines.every(line => !line.includes('\n') && line.includes('instance="test-pod"')));
});

test('cascade traffic keeps A/B overlapping and logs completions before C starts', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = [];
  const lines = [];
  context.mock.method(globalThis, 'fetch', url => new Promise(resolve => pending.push({ url: new URL(url), resolve })));
  const execution = cascadeTraffic('http://localhost', createTrafficLogger('incident', 23, line => lines.push(line)));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].url.searchParams.get('signatureIterations'), '40000000');
  context.mock.timers.tick(2899);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  context.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.equal(pending[1].url.searchParams.get('signatureIterations'), '2000000');
  pending[1].resolve(new Response(JSON.stringify({ error: 'authorization_timeout' }), { status: 504 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1\/23 B\].*HTTP 504.*error="authorization_timeout"/);
  assert.equal(pending.length, 2);
  pending[0].resolve(new Response(JSON.stringify({ error: 'authorization_timeout' }), { status: 504 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lines.length, 2);
  assert.equal(pending.length, 3);
  assert.equal(pending[2].url.searchParams.get('method'), 'bank');
  pending[2].resolve(new Response(JSON.stringify({ error: 'authorization_timeout' }), { status: 504 }));
  const results = await execution;
  assert.deepEqual(results.map(result => result.label), ['A', 'B', 'C']);
  assert.equal(lines.length, 3);
  assert.match(lines[2], /3\/23 C\].*HTTP 504/);
});

test('traffic logger reports transport errors once and preserves the failure', async context => {
  const failure = new Error('connection unavailable\nretry later');
  context.mock.method(globalThis, 'fetch', async () => { throw failure; });
  const lines = [];
  await assert.rejects(paymentRequest('http://localhost', { method: 'card' }, createTrafficLogger('baseline', 40, line => lines.push(line))), error => error === failure);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /GET \/pay\?method=card -> ERROR Error \d+ms/);
  assert(!lines[0].includes('\n'));
});

test('streaming forwards per-request progress before the child can finish and preserves JSON stdout', async context => {
  let progress = '';
  let openGate;
  const gate = http.createServer((request, response) => {
    if (progress.includes('[incident 2/2]')) response.end('continue');
    else openGate = () => response.end('continue');
  });
  const gateUrl = await listen(gate, context);
  const trafficSource = await readFile(new URL('../scripts/traffic.mjs', import.meta.url), 'utf8');
  const program = `${trafficSource}\nconst nativeFetch=fetch;\nglobalThis.fetch=async()=>new Response(JSON.stringify({approved:true,instance:'test-pod'}));\nconst results=await healthyTraffic('http://test-payment',1,createTrafficLogger('incident',2,line=>console.error(line)));\nawait nativeFetch(${JSON.stringify(gateUrl)},{signal:AbortSignal.timeout(2000)});\nconsole.log(JSON.stringify({version:{release:'v1.9'},results}));`;
  const stdout = await runStreaming(process.execPath, ['--input-type=module'], {
    input: program,
    onStderr: chunk => {
      progress += chunk;
      if (progress.includes('[incident 2/2]')) openGate?.();
    }
  });
  assert.match(progress, /\[incident 1\/2\] GET \/pay\?method=card -> HTTP 200/);
  assert.match(progress, /\[incident 2\/2\] GET \/pay\?method=bank -> HTTP 200/);
  const result = JSON.parse(stdout);
  assert.equal(result.version.release, 'v1.9');
  assert.equal(result.results.length, 2);
});

test('streaming preserves progress but rejects a failed command', async () => {
  let progress = '';
  await assert.rejects(runStreaming(process.execPath, ['-e', 'console.error("request failed");process.exitCode=7;'], { onStderr: chunk => { progress += chunk; } }), /exited 7/);
  assert.match(progress, /request failed/);
});