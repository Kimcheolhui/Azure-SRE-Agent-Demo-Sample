import { createPaymentApp } from './app.mjs';
import { createTelemetry } from './telemetry.mjs';
const release = process.env.RELEASE || 'v1.8';
const sourceCommit = process.env.SOURCE_COMMIT || 'local';
const instance = process.env.HOSTNAME || 'local';
const telemetry = createTelemetry({ serviceName: 'payment-api', instance, sourceCommit, release });
const server = createPaymentApp({ providerUrl: process.env.PAYMENT_PROVIDER_URL || 'http://127.0.0.1:8081', timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 3000), release, sourceCommit, instance, telemetry });
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', release, sourceCommit, instance })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await telemetry.shutdown(); process.exit(0); }));