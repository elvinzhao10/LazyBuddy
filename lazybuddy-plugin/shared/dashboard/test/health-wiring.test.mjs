import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardConnection } from '../ui/connection.mjs';
import { createLiveProjectAdapter } from '../ui/live-project-adapter.mjs';
import { packageHealth } from '../adapters/package-health.mjs';

test('the real live adapter delivers health through the authenticated detail connection', async () => {
  const requests = [];
  const expected = packageHealth({ runtime: 'LazyKimi', packageVersion: '1.4.0', capabilities: {} });
  const connection = createDashboardConnection({ fetchImpl: async (route, options) => {
    requests.push({ route, options });
    return new Response(JSON.stringify(route === '/api/session' ? { token: 'qa-session', expires_at: 1 } : expected),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await connection.connect('a'.repeat(64));
  const adapter = createLiveProjectAdapter({ connection });
  assert.deepEqual(await adapter.health(), expected);
  assert.equal(requests[1].route, '/api/project/health');
  assert.equal(requests[1].options.headers.authorization, 'Bearer qa-session');
  assert.equal(requests[1].options.headers['x-dashboard-bootstrap'], undefined);
  await assert.rejects(connection.projectDetail('../settings'), /INVALID_PROJECT_DETAIL/);
});
