import { createServer } from 'node:http';
import { authorityFor } from './service-adapter.mjs';
import { parseContract } from './contracts/parse.mjs';
import { authentication, checkRequest, readBody } from './service-auth.mjs';
import { capture, decodeCursor, evidence } from './service-snapshot.mjs';
import { safeRead, ServiceError } from './service-files.mjs';

const assets = new Map([['/', ['index.html', 'text/html']], ['/index.mjs', ['index.mjs', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']]]);
const security = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'", connection: 'close' };
function send(response, value, status = 200) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  if (bytes.length > 8 * 1024 * 1024) throw new ServiceError('RESPONSE_LIMIT', 503);
  response.writeHead(status, { ...security, 'content-type': 'application/json', 'content-length': bytes.length });
  response.end(bytes);
}
export async function listen(options, control) {
  const auth = authentication(control.credential); const sockets = new Set(); let active = 0; let closing = false;
  let origin;
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    const deadline = setTimeout(() => response.destroy(), 48000);
    response.on('close', () => clearTimeout(deadline));
    response.setTimeout(5000, () => response.destroy());
    try {
      checkRequest(request, origin);
      if (closing || active >= 8) throw new ServiceError('SERVICE_BUSY', 503);
      active += 1;
      try {
        if (request.method === 'GET' && assets.has(request.url)) {
          if (!options.assetRoot) throw new ServiceError('UI_UNAVAILABLE', 503);
          const [name, type] = assets.get(request.url); const bytes = await safeRead(options.assetRoot, name, 1024 * 1024);
          response.writeHead(200, { ...security, 'content-type': type, 'content-length': bytes.length }); response.end(bytes); return;
        }
        if (request.method === 'POST' && request.url === '/api/session') {
          auth.bootstrap(request); const body = await readBody(request);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new ServiceError('EMPTY_OBJECT_REQUIRED');
          send(response, auth.create()); return;
        }
        if (request.method === 'POST' && ['/internal/challenge', '/internal/stop'].includes(request.url)) {
          auth.bootstrap(request); const body = await readBody(request);
          if (body.instance !== control.identity.instance || typeof body.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(body.challenge) || Object.keys(body).sort().join(',') !== 'challenge,instance') throw new ServiceError('IDENTITY_MISMATCH', 409);
          send(response, { identity: control.identity, challenge: body.challenge });
          if (request.url === '/internal/stop') { closing = true; setImmediate(() => close()); }
          return;
        }
        const actor = auth.session(request);
        if (request.method === 'GET' && ['/api/snapshot', '/api/updates'].includes(request.url)) {
          send(response, await capture(options, decodeCursor(request.headers['x-dashboard-cursor']))); return;
        }
        if (request.method === 'GET' && /^\/api\/evidence\/[a-f0-9]{64}$/.test(request.url)) {
          const bytes = await evidence(options, request.url.slice('/api/evidence/'.length));
          response.writeHead(200, { ...security, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="evidence.txt"', 'content-length': bytes.length }); response.end(bytes); return;
        }
        if (request.method === 'POST' && request.url === '/api/commands') {
          const command = parseContract('command', await readBody(request));
          const queued = command.operation.endsWith('_queued_plan');
          const runId = queued ? null : options.runId;
          if (command.target.project_id !== options.projectId || command.target.run_id !== runId) throw new ServiceError('COMMAND_BINDING_MISMATCH', 409);
          try {
            const result = await authorityFor(options).execute({ ...options, runId, actor, command });
            send(response, result, result.status === 'conflict' ? 409 : 200);
          } catch (error) {
            const current = await authorityFor(options).read(options);
            const reason = !queued && current.editability?.supported === false ? current.editability.reason :
              /^(?:(?:dashboard|queue): )?([A-Z_]+)(?: at \$.*)?$/.exec(error.code ?? '')?.[1] ?? 'AUTHORITY_REJECTED';
            send(response, { status: 'rejected', reason, revision: queued ? current.queue_revision : current.revision,
              plan_revision: queued ? 0 : current.plan_revision }, 422);
          }
          return;
        }
        throw new ServiceError('UNKNOWN_ROUTE', 404);
      } finally { active -= 1; }
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : (typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'AUTHORITY_REJECTED');
      if (!response.headersSent && !response.destroyed) send(response, { status: 'rejected', code }, error instanceof ServiceError ? error.status : 422);
    }
  });
  server.maxConnections = 32; server.headersTimeout = 3000; server.requestTimeout = 3000; server.keepAliveTimeout = 1;
  server.on('connection', socket => { sockets.add(socket); socket.setTimeout(5000, () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  control.identity.port = server.address().port;
  async function close() {
    closing = true;
    const forced = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 2000);
    await new Promise(resolve => server.close(resolve)); clearTimeout(forced);
    while (active) await new Promise(resolve => setTimeout(resolve, 50));
    control.closed?.();
  }
  return { origin, close };
}
