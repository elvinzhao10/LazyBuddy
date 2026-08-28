'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PRODUCT = 'lazybuddy';
const LEASE_MS = 15 * 60_000;
const RENEWAL_WINDOW_MS = 5 * 60_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62})$/;
const PORT_MIN = 20_000;
const PORT_COUNT = 20_000;

class IsolationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IsolationError';
    this.code = code;
  }
}

function validId(value, field) {
  if (typeof value !== 'string' || value === '.' || value === '..' || !ID_PATTERN.test(value)) {
    throw new IsolationError('INVALID_IDENTIFIER', `${field} must be a lowercase task-safe identifier of 1-63 characters.`);
  }
  return value;
}

function resolveRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new IsolationError('INVALID_ROOT', 'Isolation root must be an explicit absolute path.');
  }
  const resolved = fs.realpathSync(root);
  if (!fs.statSync(resolved).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    throw new IsolationError('INVALID_ROOT', 'Isolation root must be an existing unlinked directory.');
  }
  return resolved;
}

function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    if (error && error.code === 'EPERM') return true;
    throw error;
  }
}

function defaultWorkspaceClean(workspace) {
  const result = spawnSync('git', ['-C', workspace, 'status', '--porcelain=v1', '--untracked-files=no'], {
    encoding: 'utf8',
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', PATH: '/usr/bin:/bin' },
    timeout: 5_000,
  });
  return result.status === 0 && result.stdout.trim() === '';
}

function adapters(overrides = {}) {
  return {
    now: overrides.now || Date.now,
    isPidAlive: overrides.isPidAlive || defaultPidAlive,
    isWorkspaceClean: overrides.isWorkspaceClean || defaultWorkspaceClean,
  };
}

function productPaths(root, taskId) {
  const productRoot = path.join(resolveRoot(root), PRODUCT);
  return {
    productRoot,
    tasksRoot: path.join(productRoot, 'tasks'),
    portsRoot: path.join(productRoot, 'ports'),
    recoveryRoot: path.join(productRoot, 'recovery'),
    taskRoot: path.join(productRoot, 'tasks', taskId),
  };
}

function readLease(taskRoot) {
  const leasePath = path.join(taskRoot, 'lease.json');
  let value;
  try {
    value = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
  } catch (error) {
    throw new IsolationError('LEASE_INVALID', `Existing namespace has no valid lease: ${error.message}`);
  }
  if (value.schema_version !== 1 || value.product !== PRODUCT || !value.owner
    || !Number.isInteger(value.owner.pid) || typeof value.owner.session !== 'string'
    || !value.namespace || value.namespace.root !== taskRoot || !Number.isInteger(value.namespace.port)
    || Number.isNaN(Date.parse(value.expires_at)) || typeof value.workspace !== 'string') {
    throw new IsolationError('LEASE_INVALID', 'Existing namespace lease has an invalid shape.');
  }
  return value;
}

function writeJsonExclusive(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeJsonExclusive(temporary, value);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function claimPort(paths, taskId, session) {
  const start = crypto.createHash('sha256').update(`${PRODUCT}:${taskId}`).digest().readUInt32BE(0) % PORT_COUNT;
  for (let offset = 0; offset < PORT_COUNT; offset++) {
    const port = PORT_MIN + ((start + offset) % PORT_COUNT);
    try {
      writeJsonExclusive(path.join(paths.portsRoot, `${port}.json`), { product: PRODUCT, task_id: taskId, session });
      return port;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
  }
  throw new IsolationError('PORTS_EXHAUSTED', 'No task-owned port namespace is available.');
}

function removePort(paths, lease) {
  const portPath = path.join(paths.portsRoot, `${lease.namespace.port}.json`);
  try {
    const record = JSON.parse(fs.readFileSync(portPath, 'utf8'));
    if (record.task_id === lease.task_id && record.session === lease.owner.session) fs.rmSync(portPath, { force: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw new IsolationError('LEASE_INVALID', 'Task port receipt is malformed.');
  }
}

function recover(paths, lease) {
  const tombstone = path.join(paths.recoveryRoot, `${lease.task_id}.${crypto.randomUUID()}`);
  fs.renameSync(paths.taskRoot, tombstone);
  removePort(paths, lease);
  fs.rmSync(tombstone, { recursive: true, force: true });
}

function acquire(root, request, overrideAdapters = {}) {
  const taskId = validId(request.taskId, 'taskId');
  const session = validId(request.session, 'session');
  if (!Number.isInteger(request.ownerPid) || request.ownerPid <= 0) throw new IsolationError('INVALID_OWNER', 'ownerPid must be a positive integer.');
  if (typeof request.workspace !== 'string' || !path.isAbsolute(request.workspace)) throw new IsolationError('INVALID_WORKSPACE', 'workspace must be absolute.');
  const clock = adapters(overrideAdapters);
  if (request.mutationRequiresWorktree === true && !clock.isWorkspaceClean(request.workspace)) {
    throw new IsolationError('WORKSPACE_DIRTY', 'A mutation worktree cannot inherit a dirty caller workspace.');
  }
  const paths = productPaths(root, taskId);
  fs.mkdirSync(paths.tasksRoot, { recursive: true });
  fs.mkdirSync(paths.portsRoot, { recursive: true });
  fs.mkdirSync(paths.recoveryRoot, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(paths.taskRoot);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const existing = readLease(paths.taskRoot);
      const now = clock.now();
      if (now < Date.parse(existing.expires_at)) throw new IsolationError('LEASE_COLLISION', 'Task namespace is held by an unexpired lease.');
      if (clock.isPidAlive(existing.owner.pid)) throw new IsolationError('LEASE_EXPIRED_OWNER_LIVE', 'Expired task namespace still has a live owner.');
      if (!clock.isWorkspaceClean(existing.workspace)) throw new IsolationError('LEASE_EXPIRED_WORKSPACE_DIRTY', 'Expired task namespace has a dirty workspace.');
      recover(paths, existing);
      continue;
    }

    let port;
    try {
      const now = clock.now();
      const namespacePaths = {
        evidence: path.join(paths.taskRoot, 'evidence'),
        build: path.join(paths.taskRoot, 'build'),
        cache: path.join(paths.taskRoot, 'cache'),
        state: path.join(paths.taskRoot, 'state'),
        worktree: path.join(paths.taskRoot, 'worktree'),
      };
      for (const key of ['evidence', 'build', 'cache', 'state']) fs.mkdirSync(namespacePaths[key]);
      const worktreeProvisioned = request.mutationRequiresWorktree === true;
      if (worktreeProvisioned) fs.mkdirSync(namespacePaths.worktree);
      port = claimPort(paths, taskId, session);
      const lease = {
        schema_version: 1,
        product: PRODUCT,
        task_id: taskId,
        owner: { pid: request.ownerPid, session },
        acquired_at: new Date(now).toISOString(),
        renewed_at: new Date(now).toISOString(),
        renewal_due_at: new Date(now + LEASE_MS - RENEWAL_WINDOW_MS).toISOString(),
        expires_at: new Date(now + LEASE_MS).toISOString(),
        workspace: path.resolve(request.workspace),
        execution: { mode: request.direct === false ? 'orchestrated' : 'direct', actors: request.direct === false ? 2 : 1, worktree_provisioned: worktreeProvisioned },
        namespace: { root: paths.taskRoot, paths: namespacePaths, port },
      };
      writeJsonExclusive(path.join(paths.taskRoot, 'lease.json'), lease);
      return lease;
    } catch (error) {
      if (port !== undefined) fs.rmSync(path.join(paths.portsRoot, `${port}.json`), { force: true });
      fs.rmSync(paths.taskRoot, { recursive: true, force: true });
      throw error;
    }
  }
  throw new IsolationError('LEASE_RACE', 'Task namespace changed repeatedly during recovery.');
}

function assertOwner(lease, owner) {
  validId(owner.session, 'session');
  if (lease.owner.pid !== owner.ownerPid || lease.owner.session !== owner.session) {
    throw new IsolationError('LEASE_OWNER_MISMATCH', 'Only the recorded PID and session may mutate this lease.');
  }
}

function renew(root, taskIdValue, owner, overrideAdapters = {}) {
  const taskId = validId(taskIdValue, 'taskId');
  const clock = adapters(overrideAdapters);
  const paths = productPaths(root, taskId);
  const lease = readLease(paths.taskRoot);
  assertOwner(lease, owner);
  const now = clock.now();
  if (!clock.isPidAlive(lease.owner.pid)) throw new IsolationError('LEASE_OWNER_DEAD', 'A dead owner cannot renew a lease.');
  if (now >= Date.parse(lease.expires_at)) throw new IsolationError('LEASE_EXPIRED', 'An expired lease cannot be renewed.');
  if (now < Date.parse(lease.renewal_due_at)) throw new IsolationError('LEASE_RENEWAL_NOT_DUE', 'Lease renewal is accepted only inside the final five minutes.');
  const renewed = {
    ...lease,
    renewed_at: new Date(now).toISOString(),
    renewal_due_at: new Date(now + LEASE_MS - RENEWAL_WINDOW_MS).toISOString(),
    expires_at: new Date(now + LEASE_MS).toISOString(),
  };
  writeJsonAtomic(path.join(paths.taskRoot, 'lease.json'), renewed);
  return renewed;
}

function release(root, taskIdValue, owner) {
  const taskId = validId(taskIdValue, 'taskId');
  const paths = productPaths(root, taskId);
  const lease = readLease(paths.taskRoot);
  assertOwner(lease, owner);
  const tombstone = path.join(paths.recoveryRoot, `${taskId}.release.${crypto.randomUUID()}`);
  fs.renameSync(paths.taskRoot, tombstone);
  removePort(paths, lease);
  fs.rmSync(tombstone, { recursive: true, force: true });
}

module.exports = { IsolationError, acquire, release, renew };
