import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createProviderClient } from './provider-client.mjs';

const noTelemetry = { request() {}, dependency() {}, exception() {} };

export function createPaymentApp({ providerUrl, timeoutMs = 3000, release = 'v1.8', sourceCommit = 'local', instance = 'local', telemetry = noTelemetry, clientFactory = createProviderClient, log = event => console.log(JSON.stringify(event)) }) {
  const client = clientFactory({ providerUrl, timeoutMs });
  return http.createServer(async (request, response) => {
    const started = performance.now();
    const url = new URL(request.url, 'http://payment-api');
    const traceId = randomBytes(16).toString('hex');
    const requestId = randomUUID();
    const dimensions = { traceId, requestId, instance, release, sourceCommit, path: url.pathname };
    let result;
    let status = 200;
    try {
      if (request.method !== 'GET') {
        status = 405;
        result = { error: 'method_not_allowed' };
      } else if (url.pathname === '/version' || url.pathname === '/health') {
        result = { service: 'payment-api', release, sourceCommit, instance };
      } else if (url.pathname === '/pay') {
        const method = url.searchParams.get('method') || 'card';
        const amount = Number(url.searchParams.get('amount') || 100);
        const signatureIterations = Number(url.searchParams.get('signatureIterations') || 60000);
        if (!['card', 'bank'].includes(method) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(signatureIterations) || signatureIterations < 1000 || signatureIterations > 40000000) {
          status = 400;
          result = { error: 'invalid_payment_request' };
        } else {
          dimensions.paymentMethod = method;
          const dependencyStarted = performance.now();
          let succeeded = false;
          try {
            result = await client.authorize({ requestId, method, amount, signatureIterations }, observation => log({ ...dimensions, ...observation }));
            succeeded = true;
          } finally {
            telemetry.dependency({ id: traceId, name: 'POST /authorize', data: `${providerUrl}/authorize`, target: new URL(providerUrl).host, dependencyTypeName: 'HTTP', duration: performance.now() - dependencyStarted, success: succeeded, resultCode: succeeded ? '200' : 'cancelled_or_failed', properties: { ...dimensions, 'http.method': 'POST' } });
          }
        }
      } else {
        status = 404;
        result = { error: 'not_found' };
      }
    } catch (error) {
      status = error.name === 'AbortError' ? 504 : 502;
      log({ ...dimensions, event: 'payment_failed', errorType: error.name, message: error.message, elapsedMs: Math.round(performance.now() - started) });
      telemetry.exception({ exception: error, properties: dimensions, tagOverrides: { 'ai.operation.id': traceId } });
      result = { error: status === 504 ? 'authorization_timeout' : 'authorization_failed' };
    }
    const durationMs = performance.now() - started;
    log({ ...dimensions, event: 'request_completed', status, durationMs: Math.round(durationMs) });
    telemetry.request({ id: traceId, name: `${request.method} ${url.pathname}`, url: url.href, duration: durationMs, resultCode: String(status), success: status < 400, properties: { ...dimensions, 'http.method': request.method } });
    response.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId, 'x-instance': instance });
    response.end(JSON.stringify({ ...result, requestId, traceId, instance, release }));
  });
}