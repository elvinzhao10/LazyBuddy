import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ServiceError } from './service-files.mjs';

export const secret = () => randomBytes(32).toString('hex');
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function authentication(credential) {
  const sessions = new Map();
  return {
    bootstrap(request) {
      if (!equal(request.headers['x-dashboard-bootstrap'], credential)) throw new ServiceError('UNAUTHORIZED', 401);
    },
    session(request) {
      const header = request.headers.authorization;
      const session = typeof header === 'string' && /^Bearer [a-f0-9]{64}$/.test(header) ? sessions.get(header.slice(7)) : undefined;
      if (!session || session.expires_at <= Date.now()) throw new ServiceError('UNAUTHORIZED', 401);
      return session.actor;
    },
    create() {
      for (const [token, session] of sessions) if (session.expires_at <= Date.now()) sessions.delete(token);
      if (sessions.size >= 16) throw new ServiceError('SESSION_LIMIT', 429);
      const token = secret(); const session = { actor: `dashboard:${secret().slice(0, 24)}`, expires_at: Date.now() + 30 * 60 * 1000 };
      sessions.set(token, session); return { token, expires_at: session.expires_at };
    },
  };
}
export function checkRequest(request, origin) {
  if (request.url.length > 2048 || request.url.includes('?') || request.url.includes('#') || request.url.includes('%') || request.url.includes('\\')) throw new ServiceError('INVALID_ROUTE');
  if (request.headers.host !== origin.slice(7)) throw new ServiceError('INVALID_HOST', 403);
  const supplied = request.headers.origin;
  if ((supplied !== undefined && supplied !== origin) || (request.method === 'POST' && supplied !== origin)) throw new ServiceError('INVALID_ORIGIN', 403);
  const unique = ['host', 'origin', 'authorization', 'x-dashboard-bootstrap', 'x-dashboard-cursor', 'content-type'];
  for (const key of unique) if (request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === key).length > 1) throw new ServiceError('DUPLICATE_HEADER');
}
export function readBody(request) {
  if (request.headers['content-type'] !== 'application/json') throw new ServiceError('JSON_REQUIRED', 415);
  if (request.headers['content-encoding']) throw new ServiceError('ENCODING_UNSUPPORTED', 415);
  if (Number(request.headers['content-length'] ?? 0) > 65536) throw new ServiceError('BODY_LIMIT', 413);
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0;
    const timer = setTimeout(() => reject(new ServiceError('BODY_TIMEOUT', 408)), 1500);
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 65536) { clearTimeout(timer); request.pause(); reject(new ServiceError('BODY_LIMIT', 413)); }
      else chunks.push(chunk);
    });
    request.on('error', () => { clearTimeout(timer); reject(new ServiceError('BODY_ABORTED')); });
    request.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ServiceError('INVALID_JSON')); }
    });
  });
}
