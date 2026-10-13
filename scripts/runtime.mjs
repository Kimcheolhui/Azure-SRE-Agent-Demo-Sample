export function createRuntimeClient(endpoint, token, fetchImpl = fetch) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || base.username || base.password || !/\.(azuresre\.ai|sre\.azure\.com|azuresre\.dev)$/.test(base.hostname)) throw new Error('Agent endpoint must be an ARM-discovered trusted HTTPS endpoint');
  return async (pathname, method = 'GET', body, options = {}) => {
    if (!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('Invalid relative API route');
    const url = new URL(pathname, base);
    const multipart = body instanceof FormData;
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(!multipart && body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([AbortSignal.timeout(120000), options.signal]) : AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`SRE API ${method} ${url.pathname} returned HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}
export function items(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['value', 'data', 'results', 'files', 'skills', 'agents']) if (Array.isArray(value?.[key])) return value[key].map(item => typeof item === 'string' ? JSON.parse(item) : item);
  return [];
}

export function completedReply(thread) {
  const last = thread?.lastMessage;
  if (!last?.isComplete || !last.text?.trim() || last.author?.role?.toLowerCase() === 'user' || thread.waitReason) return false;
  if (last.text.startsWith('[SCHEDULED_TASK_EXECUTION]')) return false;
  if (last.messageType && last.messageType !== 'Text' && last.messageType !== 'FinalAnswer') return false;
  return !Object.entries(last).some(([key, value]) => /Execution$|Result$|Approval$|Question$|Info$|Query$|Request$|Card$/i.test(key) && value !== null && value !== undefined);
}

export function toolData(value) {
  let result = value;
  for (let layer = 0; layer < 5; layer++) {
    if (typeof result === 'string') { result = JSON.parse(result); continue; }
    if (!result || typeof result !== 'object') throw new Error('Tool returned no structured result');
    if (result.isError || result.isSuccessful === false || (result.status && result.status >= 400)) throw new Error('Tool returned an unsuccessful result');
    const text = Array.isArray(result.content) ? result.content.find(item => item.type === 'text')?.text : undefined;
    if (text !== undefined) { result = text; continue; }
    return result;
  }
  throw new Error('Tool response exceeded supported JSON envelope depth');
}