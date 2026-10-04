export class DashboardRequestError extends Error {
  constructor(status, body) {
    super(body?.reason ?? body?.code ?? `HTTP_${status}`);
    this.name = 'DashboardRequestError';
    this.status = status;
    this.body = body;
  }
}

async function decode(response) {
  let body;
  try { body = await response.json(); } catch { body = { code: 'INVALID_RESPONSE' }; }
  if (!response.ok) throw new DashboardRequestError(response.status, body);
  return body;
}

export function createDashboardConnection({ fetchImpl = globalThis.fetch } = {}) {
  let token = null;
  let cursor = null;
  const headers = extra => ({ authorization: `Bearer ${token}`, ...extra });
  return {
    get connected() { return Boolean(token); },
    async connect(accessKey) {
      if (typeof accessKey !== 'string' || !/^[a-f0-9]{64}$/.test(accessKey)) throw new DashboardRequestError(0, { code: 'INVALID_ACCESS_KEY' });
      const response = await fetchImpl('/api/session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dashboard-bootstrap': accessKey }, body: '{}' });
      const session = await decode(response); token = session.token; cursor = null; return session;
    },
    async snapshot() {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      const response = await fetchImpl('/api/snapshot', { headers: headers() });
      const value = await decode(response); cursor = value.cursor; return value;
    },
    async updates() {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      const response = await fetchImpl('/api/updates', { headers: headers(cursor ? { 'x-dashboard-cursor': cursor } : {}) });
      const value = await decode(response); cursor = value.cursor; return value;
    },
    async command(command) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      const response = await fetchImpl('/api/commands', { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(command) });
      return decode(response);
    },
    async evidence(path) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      if (typeof path !== 'string' || !/^\/api\/evidence\/[a-f0-9]{64}$/.test(path)) throw new DashboardRequestError(0, { code: 'INVALID_EVIDENCE_PATH' });
      const response = await fetchImpl(path, { headers: headers() });
      if (!response.ok) throw new DashboardRequestError(response.status, await response.json().catch(() => ({ code: 'INVALID_RESPONSE' })));
      return response.blob();
    },
    disconnect() { token = null; cursor = null; },
  };
}
