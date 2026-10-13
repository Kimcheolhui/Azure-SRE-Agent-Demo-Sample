import { performance } from 'node:perf_hooks';
export async function request(baseUrl, query) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/pay?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(20000) });
  return { status: response.status, elapsedMs: Math.round(performance.now() - started), ...(await response.json()) };
}
export async function healthyTraffic(baseUrl, count = 20) {
  const results = [];
  for (let round = 0; round < count; round++) for (const method of ['card', 'bank']) results.push({ method, ...(await request(baseUrl, { method })) });
  return results;
}
export async function cascadeTraffic(baseUrl) {
  const first = request(baseUrl, { method: 'card', signatureIterations: '40000000' });
  await new Promise(resolve => setTimeout(resolve, 2900));
  const second = request(baseUrl, { method: 'card', signatureIterations: '2000000' });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const thirdResult = await request(baseUrl, { method: 'bank' });
  return [{ label: 'A', ...firstResult }, { label: 'B', ...secondResult }, { label: 'C', ...thirdResult }];
}
export function summarize(results) {
  return [...new Set(results.map(item => item.method || item.label))].map(group => {
    const items = results.filter(item => (item.method || item.label) === group);
    const durations = items.map(item => item.elapsedMs).sort((left, right) => left - right);
    return { group, requests: items.length, failures: items.filter(item => item.status >= 400).length, p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] };
  });
}