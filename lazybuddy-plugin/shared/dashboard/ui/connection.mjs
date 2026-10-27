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
    async project() {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      return decode(await fetchImpl('/api/project', { headers: headers() }));
    },
    async projectDetail(kind) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      if (!['architecture', 'git', 'evidence', 'health', 'telemetry'].includes(kind)) throw new DashboardRequestError(0, { code: 'INVALID_PROJECT_DETAIL' });
      return decode(await fetchImpl(`/api/project/${kind}`, { headers: headers() }));
    },
    async projectSource(sourceId) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      if (typeof sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(sourceId)) {
        throw new DashboardRequestError(0, { code: 'INVALID_SOURCE_ID' });
      }
      return decode(await fetchImpl(`/api/project/sources/${encodeURIComponent(sourceId)}`, { headers: headers() }));
    },
    async projectCommand(command) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      return decode(await fetchImpl('/api/project/commands', { method: 'POST',
        headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(command) }));
    },
    async assessProjectTransition(request) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      return decode(await fetchImpl('/api/project/plan-transition-assessment', { method: 'POST',
        headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(request) }));
    },
    async projectEvidencePreview(artifactId) {
      if (!token) throw new DashboardRequestError(0, { code: 'NOT_CONNECTED' });
      if (typeof artifactId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(artifactId)) {
        throw new DashboardRequestError(0, { code: 'INVALID_ARTIFACT_ID' });
      }
      return decode(await fetchImpl('/api/project/evidence/preview', { method: 'POST',
        headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ artifact_id: artifactId }) }));
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
