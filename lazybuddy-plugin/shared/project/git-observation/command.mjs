// Bounded command execution shared by the Git/CI observation collectors.
// Every collector subprocess gets a hard timeout and an output cap; failures
// surface as typed reasons, never as half-parsed facts.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// Typed unavailability. `reason` is a stable SCREAMING_SNAKE code; `detail` is
// bounded human-readable context that never carries file content.
export class CollectorUnavailable extends Error {
  constructor(reason, detail = '') {
    super(detail || reason);
    this.name = 'CollectorUnavailable';
    this.reason = reason;
    this.detail = detail.slice(0, 512);
  }
}

export function spawnExec(file, args, options) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(file, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (error) {
      resolve({ spawnError: error }); return;
    }
    const stdout = []; const stderr = [];
    let bytes = 0; let overflow = false; let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      // Resolve on exit, not close: a killed collector child can leave
      // orphaned grandchildren holding the stdio pipes long after it died.
      child.once('exit', () => finish({
        code: null, signal: 'SIGKILL', overflow, timeout: true,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
      }));
      child.kill('SIGKILL');
    }, options.timeout);
    child.on('error', error => finish({ spawnError: error }));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > options.maxBytes) { overflow = true; child.kill('SIGKILL'); }
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr.push(chunk.length <= 4096 ? chunk : chunk.slice(0, 4096)); });
    child.on('close', (code, signal) => finish({
      code, signal, overflow,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }));
  });
}

// Runs one collector subprocess and normalizes every failure mode to a typed
// reason. Returns { code, stdout, stderr }; throws CollectorUnavailable on
// missing binary, timeout kill, or output overflow. Nonzero exit codes are the
// caller's decision to interpret.
export async function runBounded(exec, file, args, options = {}) {
  const result = await exec(file, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  });
  if (result.spawnError) throw new CollectorUnavailable(options.missingReason ?? 'COMMAND_UNAVAILABLE',
    `${file}: ${result.spawnError.code ?? result.spawnError.message}`);
  if (result.overflow) throw new CollectorUnavailable('OUTPUT_TOO_LARGE', `${file} exceeded the output cap`);
  if (result.signal) throw new CollectorUnavailable('COMMAND_TIMEOUT', `${file} terminated by ${result.signal}`);
  return result;
}

// Requires exit code zero; otherwise throws with the caller's reason.
export async function runRequired(exec, file, args, options = {}) {
  const result = await runBounded(exec, file, args, options);
  if (result.code !== 0) {
    throw new CollectorUnavailable(options.failReason ?? 'COMMAND_FAILED',
      `${file} ${args[0] ?? ''} exited ${result.code}: ${result.stderr.toString('utf8').trim()}`);
  }
  return result;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Deterministic JSON: recursively key-sorted, no whitespace. Used for digests
// that must be stable across collections of identical facts.
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

export function digestOf(value) {
  return sha256Hex(canonicalJSON(value));
}

export function nowIso() {
  return new Date().toISOString();
}
