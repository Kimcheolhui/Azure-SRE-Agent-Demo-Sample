export function createProviderClient({ providerUrl, timeoutMs = 3000, fetchImpl = fetch }) {
  const controller = new AbortController();
  return {
    async authorize(payload, observe = () => {}) {
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      observe({ event: 'authorization_started', signalAborted: controller.signal.aborted });
      try {
        const response = await fetchImpl(`${providerUrl}/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    }
  };
}