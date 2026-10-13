import http from 'node:http';
import { pbkdf2, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const deriveKey = promisify(pbkdf2);

export function createProvider({ log = event => console.log(JSON.stringify(event)) } = {}) {
  return http.createServer(async (request, response) => {
    const started = performance.now();
    let status = 200;
    let result;
    let requestId;
    try {
      if (request.method === 'GET' && request.url === '/health') result = { service: 'payment-provider', ready: true };
      else if (request.method === 'POST' && request.url === '/authorize') {
        let input = '';
        for await (const chunk of request) {
          input += chunk;
          if (Buffer.byteLength(input) > 4096) throw new Error('Authorization request too large');
        }
        const payload = JSON.parse(input);
        requestId = payload.requestId;
        if (typeof requestId !== 'string' || !['card', 'bank'].includes(payload.method) || !Number.isFinite(payload.amount) || payload.amount <= 0 || !Number.isSafeInteger(payload.signatureIterations) || payload.signatureIterations < 1000 || payload.signatureIterations > 40000000) throw new Error('Invalid authorization request');
        const signature = payload.method === 'card'
          ? (await deriveKey(`${requestId}:${payload.amount}`, 'merchant-card', payload.signatureIterations, 32, 'sha256')).toString('hex')
          : createHash('sha256').update(`${requestId}:${payload.amount}`).digest('hex');
        result = { approved: true, authorizationId: randomUUID(), signature };
      } else {
        status = 404;
        result = { error: 'not_found' };
      }
    } catch (error) {
      status = 400;
      result = { error: 'invalid_authorization_request' };
      log({ event: 'authorization_failed', requestId, message: error.message });
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
    log({ event: 'authorization_completed', requestId, status, durationMs: Math.round(performance.now() - started) });
  });
}