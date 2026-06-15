/** Resolve broker base URL from Wails Go binding or fall back to localhost default. */
export function getBrokerBase(): string {
  try {
    const fn = (window as any)?.go?.main?.App?.GetBrokerBaseURL;
    if (typeof fn === 'function') {
      const url = fn();
      if (url && typeof url === 'string') return url.replace(/\/$/, '');
    }
  } catch {
    /* plain browser / Playwright mocks */
  }
  return 'http://127.0.0.1:8000';
}

export function getBrokerWsBase(): string {
  const http = getBrokerBase();
  return http.replace(/^http/, 'ws');
}