import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export function createTelemetry({ serviceName, instance, sourceCommit, release }) {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return { request() {}, dependency() {}, exception() {}, async shutdown() {} };
  const { TelemetryClient } = require('applicationinsights');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const client = new TelemetryClient(connectionString, { useGlobalProviders: false });
  client.config.azureMonitorOpenTelemetryOptions = {
    resource: resourceFromAttributes({ 'service.name': serviceName, 'service.instance.id': instance })
  };
  client.commonProperties = { instance, sourceCommit, release, namespace: 'payments' };
  client.initialize();
  return {
    request: item => client.trackRequest(item),
    dependency: item => client.trackDependency(item),
    exception: item => client.trackException(item),
    shutdown: () => client.shutdown()
  };
}