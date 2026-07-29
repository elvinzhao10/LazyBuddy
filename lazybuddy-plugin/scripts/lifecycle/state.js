'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { atomicJson, readJson, safeFile } = require('./files');
const { ownedRelativePath } = require('./ownership');

const LAUNCHER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const active = JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8'));
const releases = path.join(root, 'releases');
const release = path.resolve(releases, active.active_release);
if (path.dirname(release) !== releases) throw new Error('active release escapes durable releases');
const entry = path.resolve(release, active.entrypoint);
if (!entry.startsWith(release + path.sep)) throw new Error('entrypoint escapes active release');
const result = spawnSync(active.runtime_path, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
`;

function installLauncher(paths) {
  if (fs.existsSync(paths.launcher)) {
    const existing = safeFile(paths.launcher);
    if (!existing.bytes.equals(Buffer.from(LAUNCHER))) {
      throw new LifecycleError('OWNERSHIP_REFUSED', 'stable launcher was modified');
    }
    return;
  }
  fs.writeFileSync(paths.launcher, LAUNCHER, { mode: 0o755, flag: 'wx' });
}

function acquireLock(paths, operation) {
  const record = {
    pid: process.pid,
    host: os.hostname(),
    started_at: new Date().toISOString(),
    operation,
    nonce: crypto.randomUUID(),
  };
  let descriptor;
  try {
    descriptor = fs.openSync(paths.lock, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(record) + '\n');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error && error.code === 'EEXIST') throw new LifecycleError('LOCKED', 'lifecycle operation lock exists', error);
    throw error;
  }
  return {
    record,
    release() {
      const current = readJson(paths.lock, 'LOCK_CHANGED');
      if (current.nonce !== record.nonce) throw new LifecycleError('LOCK_CHANGED', 'lifecycle lock ownership changed');
      fs.unlinkSync(paths.lock);
    },
  };
}

function recoverStaleLock(paths, confirmation) {
  if (confirmation !== 'recover-stale-lock') {
    throw new LifecycleError('CONFIRMATION_REQUIRED', 'pass explicit recover-stale-lock confirmation');
  }
  if (!fs.existsSync(paths.lock)) throw new LifecycleError('NO_LOCK', 'no lifecycle lock exists');
  const file = safeFile(paths.lock, 'OWNERSHIP_REFUSED');
  let record;
  try {
    record = JSON.parse(file.bytes.toString('utf8'));
  } catch (error) {
    throw new LifecycleError('OWNERSHIP_REFUSED', 'lifecycle lock is malformed', error);
  }
  if (!Number.isInteger(record.pid) || record.pid <= 0 || typeof record.host !== 'string' || record.host === ''
    || typeof record.operation !== 'string' || record.operation === ''
    || typeof record.started_at !== 'string' || !Number.isFinite(Date.parse(record.started_at))
    || typeof record.nonce !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.nonce)) {
    throw new LifecycleError('OWNERSHIP_REFUSED', 'lifecycle lock is not an owned lock record');
  }
  if (record.host !== os.hostname()) {
    throw new LifecycleError('LOCK_STALENESS_UNPROVEN', 'cannot prove a lock from another host is stale');
  }
  try {
    process.kill(record.pid, 0);
    throw new LifecycleError('LOCK_LIVE', 'lifecycle lock owner is still running');
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    if (!error || error.code !== 'ESRCH') {
      throw new LifecycleError('LOCK_STALENESS_UNPROVEN', 'cannot prove lifecycle lock is stale', error);
    }
  }
  const current = fs.lstatSync(paths.lock);
  if (!current.isFile() || current.nlink !== 1 || current.dev !== file.stat.dev || current.ino !== file.stat.ino) {
    throw new LifecycleError('OWNERSHIP_REFUSED', 'lifecycle lock changed during recovery');
  }
  fs.unlinkSync(paths.lock);
}

function readActive(paths) {
  if (!fs.existsSync(paths.active)) return null;
  const active = readJson(paths.active, 'MALFORMED_ACTIVE');
  if (active.schema_version !== 1 || active.product !== paths.product
    || typeof active.active_release !== 'string' || typeof active.entrypoint !== 'string'
    || typeof active.runtime_path !== 'string' || !active.release_metadata
    || typeof active.release_metadata !== 'object'
    || !active.release_metadata[active.active_release] || !validReleaseMetadata(active.release_metadata)) {
    throw new LifecycleError('MALFORMED_ACTIVE', 'active state has an invalid shape');
  }
  return active;
}

function validReleaseMetadata(metadata) {
  try {
    for (const [id, value] of Object.entries(metadata)) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[0-9a-f]{12}$/.test(id)
        || !value || typeof value.runtime_path !== 'string') return false;
      ownedRelativePath(value.entrypoint, 'MALFORMED_ACTIVE');
    }
    return true;
  } catch (error) {
    if (error instanceof LifecycleError) return false;
    throw error;
  }
}

function writeActive(paths, active) {
  atomicJson(paths.productRoot, paths.active, active, 0o600);
}

function recoveryReport(paths) {
  const issues = [];
  let activeState = null;
  if (!fs.existsSync(paths.productRoot)) {
    issues.push({ code: 'ABSENT_ROOT', path: paths.productRoot });
    return { product: paths.product, issues };
  }
  if (fs.existsSync(paths.active)) {
    try {
      activeState = readActive(paths);
    } catch (error) {
      issues.push({ code: error.code === 'MALFORMED_ACTIVE' ? 'MALFORMED_ACTIVE' : 'UNSAFE_ACTIVE', path: paths.active });
    }
  }
  if (fs.existsSync(paths.lock)) issues.push({ code: 'LOCK_PRESENT', path: paths.lock });
  if (fs.existsSync(paths.staging) && fs.readdirSync(paths.staging).length > 0) {
    issues.push({ code: 'STAGING_PRESENT', path: paths.staging });
  }
  if (fs.existsSync(paths.releases)) {
    const referenced = new Set(activeState
      ? [activeState.active_release, activeState.previous_release].filter(Boolean)
      : []);
    for (const name of fs.readdirSync(paths.releases)) {
      if (!referenced.has(name)) issues.push({ code: 'ORPHAN_RELEASE', path: path.join(paths.releases, name) });
    }
  }
  return { product: paths.product, issues };
}

module.exports = {
  LAUNCHER,
  acquireLock,
  installLauncher,
  readActive,
  recoverStaleLock,
  recoveryReport,
  writeActive,
};
