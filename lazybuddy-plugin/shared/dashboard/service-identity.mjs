import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFile, realpath, open, unlink, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { request } from 'node:http';
import { hash, privateRead, ServiceError } from './service-files.mjs';
import { equal, secret } from './service-auth.mjs';
import { stableJSON } from './contracts/parse.mjs';

export async function started(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new ServiceError('INVALID_PID');
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000, maxBuffer: 4096 }, (error, stdout) => {
      if (error && error.code !== 1) reject(new ServiceError('IDENTITY_INSPECTION_FAILED', 409));
      else resolve(stdout.trim() || null);
    });
  });
}
export async function executableIdentity() {
  const executable = await realpath(process.execPath);
  const names = ['service.mjs', 'service-lifecycle.mjs', 'service-identity.mjs', 'service-http.mjs', 'service-auth.mjs', 'service-files.mjs', 'service-read.py', 'service-snapshot.mjs', 'service-adapter.mjs'];
  const contents = await Promise.all(names.map(name => readFile(fileURLToPath(new URL(name, import.meta.url)))));
  return { executable, executable_sha256: hash(await readFile(executable)), service_sha256: hash(Buffer.concat(contents)) };
}
export const sign = (credential, identity) => createHmac('sha256', credential).update(stableJSON(identity)).digest('hex');
export async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
export async function readReceipt(options) {
  let raw;
  try { raw = await privateRead(options.directory, 'receipt.json'); }
  catch (error) {
    // Missing receipt is checked independently; unsafe existing files never become stopped state.
    try { await lstat(join(options.directory, 'receipt.json')); } catch (missing) { if (missing.code === 'ENOENT') return null; }
    throw error;
  }
  let receipt;
  try { receipt = JSON.parse(raw); } catch { throw new ServiceError('INVALID_RECEIPT', 409); }
  const credential = (await privateRead(options.directory, 'credential')).toString();
  if (!receipt || !equal(receipt.signature, sign(credential, receipt.identity))) throw new ServiceError('FORGED_RECEIPT', 409);
  const identity = receipt.identity; const expected = await executableIdentity();
  if (identity.projectRoot !== options.projectRoot || identity.projectId !== options.projectId || identity.runId !== options.runId ||
    !Number.isSafeInteger(identity.port) || identity.port < 1 || identity.port > 65535 || !/^[a-f0-9]{64}$/.test(identity.instance) ||
    Object.entries(expected).some(([key, value]) => identity[key] !== value) || await started(identity.pid) !== identity.started) throw new ServiceError('IDENTITY_MISMATCH', 409);
  return { identity, credential };
}
export async function challenge(receipt, action = 'challenge') {
  const { identity, credential } = receipt; const nonce = secret(); const origin = `http://127.0.0.1:${identity.port}`;
  const body = JSON.stringify({ instance: identity.instance, challenge: nonce });
  const value = await new Promise((resolve, reject) => {
    const req = request(`${origin}/internal/${action}`, { method: 'POST', headers: { origin, 'x-dashboard-bootstrap': credential,
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 2000 }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; if (text.length > 8192) req.destroy(new ServiceError('CHALLENGE_LIMIT')); });
      response.on('end', () => { try { if (response.statusCode !== 200) throw new ServiceError('CHALLENGE_REJECTED', 409); resolve(JSON.parse(text)); } catch { reject(new ServiceError('CHALLENGE_REJECTED', 409)); } });
    });
    req.on('timeout', () => req.destroy(new ServiceError('CHALLENGE_TIMEOUT', 409)));
    req.on('error', () => reject(new ServiceError('CHALLENGE_UNAVAILABLE', 409))); req.end(body);
  });
  if (value.challenge !== nonce || stableJSON(value.identity) !== stableJSON(identity)) throw new ServiceError('CHALLENGE_IDENTITY_MISMATCH', 409);
  return identity;
}
export async function removeReceipt(options, instance) {
  const path = join(options.directory, 'receipt.json');
  try {
    const value = JSON.parse(await privateRead(options.directory, 'receipt.json'));
    if (value.identity?.instance !== instance) throw new ServiceError('RECEIPT_CHANGED', 409);
    await unlink(path);
  } catch (error) {
    try { await lstat(path); } catch (missing) { if (missing.code === 'ENOENT') return; }
    throw error;
  }
}
