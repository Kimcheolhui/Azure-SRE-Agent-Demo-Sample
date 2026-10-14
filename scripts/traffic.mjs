import { performance } from 'node:perf_hooks';
export async function request(baseUrl, query, onResponse, label) {
  const started = performance.now();
  let result;
  try {
    const response = await fetch(`${baseUrl}/pay?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(20000) });
    result = { status: response.status, elapsedMs: Math.round(performance.now() - started), ...(await response.json()) };
  } catch (error) {
    onResponse?.({ query, label, error, elapsedMs: Math.round(performance.now() - started) });
    throw error;
  }
  onResponse?.({ query, label, result });
  return result;
}
export function createTrafficLogger(action, total, writeLine = line => console.log(line)) {
  let completed = 0;
  return ({ query, label, result, error, elapsedMs }) => {
    const response = result ? [
      `HTTP ${result.status}`,
      `${result.elapsedMs}ms`,
      ...['approved', 'error', 'instance', 'release', 'requestId'].filter(key => result[key] !== undefined).map(key => `${key}=${JSON.stringify(result[key])}`)
    ].join(' ') : `ERROR ${error.name} ${elapsedMs}ms message=${JSON.stringify(error.message)}`;
    writeLine(`[${action} ${++completed}/${total}${label ? ` ${label}` : ''}] GET /pay?${new URLSearchParams(query)} -> ${response}`);
  };
}
export async function healthyTraffic(baseUrl, count = 20, onResponse) {
  const results = [];
  for (let round = 0; round < count; round++) for (const method of ['card', 'bank']) results.push({ method, ...(await request(baseUrl, { method }, onResponse)) });
  return results;
}
export async function cascadeTraffic(baseUrl, onResponse) {
  const first = request(baseUrl, { method: 'card', signatureIterations: '40000000' }, onResponse, 'A');
  await new Promise(resolve => setTimeout(resolve, 2900));
  const second = request(baseUrl, { method: 'card', signatureIterations: '2000000' }, onResponse, 'B');
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const thirdResult = await request(baseUrl, { method: 'bank' }, onResponse, 'C');
  return [{ label: 'A', ...firstResult }, { label: 'B', ...secondResult }, { label: 'C', ...thirdResult }];
}
export function summarize(results) {
  return [...new Set(results.map(item => item.method || item.label))].map(group => {
    const items = results.filter(item => (item.method || item.label) === group);
    const durations = items.map(item => item.elapsedMs).sort((left, right) => left - right);
    return { group, requests: items.length, failures: items.filter(item => item.status >= 400).length, p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] };
  });
}