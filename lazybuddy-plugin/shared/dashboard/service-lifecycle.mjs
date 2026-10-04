import { fork } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, lstat, rmdir } from 'node:fs/promises';
import { hash, canonicalDirectory, privateDirectory, privateRead, ServiceError } from './service-files.mjs';
import { secret } from './service-auth.mjs';
import { authorityFor } from './service-adapter.mjs';
import { readReceipt, writePrivate, challenge, started, sign, removeReceipt } from './service-identity.mjs';

export async function binding(options) {
  await canonicalDirectory(options.projectRoot);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.runId) || typeof options.projectId !== 'string' || !options.projectId.length || options.projectId.length > 256) throw new ServiceError('INVALID_BINDING');
  await canonicalDirectory(join(options.projectRoot, '.lazybuddy/runs', options.runId));
  if (options.assetRoot) await canonicalDirectory(options.assetRoot);
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || (options.port !== undefined && (port < 1 || port > 65535))) throw new ServiceError('INVALID_PORT');
  const parent = await privateDirectory(join(options.projectRoot, '.lazybuddy/dashboard'));
  const directory = await privateDirectory(join(parent, hash(`${options.projectId}\n${options.runId}`)));
  return { ...options, port, directory };
}
export function publicIdentity(options, identity) {
  return { status: 'running', identity, url: `http://127.0.0.1:${identity.port}`, credential_file: join(options.directory, 'credential') };
}
export async function lifecycle(action, rawOptions) {
  const options = await binding(rawOptions); const lock = join(options.directory, 'lock');
  let interrupted = false; let child;
  const abort = () => { interrupted = true; if (child?.connected) child.send({ action: 'abort' }); };
  if (action === 'start') { process.once('SIGTERM', abort); process.once('SIGINT', abort); }
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
    if (action === 'start') { process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort); }
    if (error.code === 'EEXIST') throw new ServiceError('LIFECYCLE_BUSY', 409); throw error;
  }
  const lockStat = await lstat(lock);
  try {
    const existing = await readReceipt(options);
    if (action === 'status') return existing ? publicIdentity(options, await challenge(existing)) : { status: 'stopped' };
    if (action === 'stop') {
      if (!existing) return { status: 'stopped', cleanup: 'already-absent' };
      await challenge(existing); await challenge(existing, 'stop');
      const deadline = Date.now() + 50000;
      while (Date.now() < deadline && await started(existing.identity.pid) === existing.identity.started) await new Promise(resolve => setTimeout(resolve, 50));
      if (await started(existing.identity.pid) === existing.identity.started) throw new ServiceError('OWNED_PROCESS_REMAINS', 409);
      await removeReceipt(options, existing.identity.instance);
      return { status: 'stopped', cleanup: 'verified-absent', pid: existing.identity.pid, port: existing.identity.port };
    }
    if (action !== 'start') throw new ServiceError('UNKNOWN_ACTION');
    if (existing) {
      const identity = await challenge(existing);
      if (options.port && identity.port !== options.port) throw new ServiceError('PORT_BINDING_MISMATCH', 409);
      return publicIdentity(options, identity);
    }
    await authorityFor(options).read(options);
    if (interrupted) throw new ServiceError('START_INTERRUPTED');
    let credential;
    try { credential = (await privateRead(options.directory, 'credential')).toString(); }
    catch (error) {
      try { await lstat(join(options.directory, 'credential')); } catch (missing) {
        if (missing.code !== 'ENOENT') throw missing;
        credential = secret(); await writePrivate(join(options.directory, 'credential'), credential);
      }
      if (!credential) throw error;
    }
    if (!/^[a-f0-9]{64}$/.test(credential)) throw new ServiceError('INVALID_CREDENTIAL');
    if (interrupted) throw new ServiceError('START_INTERRUPTED');
    child = fork(fileURLToPath(new URL('./service.mjs', import.meta.url)), ['serve'], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise(resolve => child.once('exit', resolve));
    let identity;
    try {
      identity = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new ServiceError('START_TIMEOUT')), 10000);
        child.once('error', () => { clearTimeout(timer); reject(new ServiceError('START_FAILED')); });
        child.once('exit', () => { clearTimeout(timer); reject(new ServiceError('START_FAILED')); });
        child.once('message', message => { clearTimeout(timer); if (message.ready) resolve(message.identity); else reject(new ServiceError('START_FAILED')); });
        child.send({ action: 'initialize', options, credential });
      });
      await challenge({ identity, credential });
      if (interrupted) throw new ServiceError('START_INTERRUPTED');
      await writePrivate(join(options.directory, 'receipt.json'), JSON.stringify({ identity, signature: sign(credential, identity) }));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new ServiceError('PROMOTION_TIMEOUT')), 2000);
        child.once('message', message => { clearTimeout(timer); message.promoted ? resolve() : reject(new ServiceError('PROMOTION_FAILED')); });
        child.send({ action: 'promote' });
      });
      child.disconnect(); child.unref();
      return publicIdentity(options, identity);
    } catch (error) {
      abort();
      if (child.connected) child.disconnect();
      await exited;
      if (identity) await removeReceipt(options, identity.instance);
      throw error;
    }
  } finally {
    if (action === 'start') { process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort); }
    const current = await lstat(lock);
    if (current.ino !== lockStat.ino || current.dev !== lockStat.dev) throw new ServiceError('LOCK_IDENTITY_CHANGED');
    await rmdir(lock);
  }
}
