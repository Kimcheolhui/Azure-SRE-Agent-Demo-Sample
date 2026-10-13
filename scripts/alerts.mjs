import { setTimeout as delay } from 'node:timers/promises';
import { json } from './cloud.mjs';

export function firedAlerts(env) {
  const url = new URL(`https://management.azure.com/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/providers/Microsoft.AlertsManagement/alerts`);
  url.search = new URLSearchParams({ 'api-version': '2019-03-01', monitorCondition: 'Fired', alertRule: env.PAYMENT_ALERT_NAME }).toString();
  const response = json('az', ['rest', '--url', url.href, '-o', 'json']);
  if (!Array.isArray(response.value)) throw new Error('Azure Monitor returned no structured alert list');
  return response.value.filter(alert => {
    const essentials = alert.properties?.essentials;
    return essentials?.monitorCondition === 'Fired' && (essentials.alertRule === env.PAYMENT_ALERT_NAME || essentials.alertRule?.split('/').at(-1) === env.PAYMENT_ALERT_NAME);
  });
}
export async function waitForAlertState(env, state, { after, timeoutMs = 900000, read = firedAlerts, wait = () => delay(10000) } = {}) {
  if (!['Fired', 'Resolved'].includes(state)) throw new Error('Unsupported alert state');
  const deadline = Date.now() + timeoutMs;
  do {
    const alerts = read(env);
    if (state === 'Resolved' && alerts.length === 0) return { state: 'Resolved', checkedUtc: new Date().toISOString() };
    const current = state === 'Fired' ? alerts.find(alert => Date.parse(alert.properties?.essentials?.startDateTime || alert.properties?.essentials?.firedDateTime) >= Date.parse(after)) : undefined;
    if (state === 'Fired' && current) return { state: 'Fired', id: current.id.split('/').at(-1), resourceId: current.id, checkedUtc: new Date().toISOString() };
    if (Date.now() >= deadline) break;
    await wait();
  } while (Date.now() < deadline);
  throw new Error(`Alert did not reach ${state}; do not begin or claim a new automatic investigation. Recover first and inspect the evaluation window.`);
}