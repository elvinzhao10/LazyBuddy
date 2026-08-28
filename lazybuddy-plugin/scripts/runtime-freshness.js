'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BINDING_FIELDS = [
  'plan_hash', 'git_head', 'package_version', 'task_namespace',
  'capability_fingerprint', 'context_digest',
];
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function sha256(bytes) {
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error('INVALID_' + label.toUpperCase());
  }
  return value;
}

function validateBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONTEXT_BINDING');
  for (const field of BINDING_FIELDS) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error('INVALID_CONTEXT_BINDING:' + field);
    }
  }
  requireSegment(value.task_namespace, 'task_namespace');
  return Object.fromEntries(BINDING_FIELDS.map((field) => [field, value[field]]));
}

function resolveOwnedFile(repoRoot, candidate, label) {
  const root = fs.realpathSync(repoRoot);
  const resolved = fs.realpathSync(path.resolve(root, candidate));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('INVALID_' + label.toUpperCase());
  if (!fs.statSync(resolved).isFile()) throw new Error('INVALID_' + label.toUpperCase());
  return resolved;
}

function createCurrentBinding(options) {
  const root = fs.realpathSync(options.repo_root);
  const planPath = fs.realpathSync(path.resolve(root, options.plan_path));
  if (!fs.statSync(planPath).isFile()) throw new Error('INVALID_PLAN_PATH');
  const packagePath = resolveOwnedFile(root, options.package_path, 'package_path');
  const capability = options.capability_fingerprint;
  if (typeof capability !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(capability)) {
    throw new Error('INVALID_CAPABILITY_FINGERPRINT');
  }
  const gitHead = childProcess.execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (options.require_clean !== false) {
    const dirty = childProcess.execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (dirty) throw new Error('DIRTY_REPOSITORY');
  }
  const packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  return validateBinding({
    plan_hash: sha256(fs.readFileSync(planPath)),
    git_head: gitHead,
    package_version: packageVersion,
    task_namespace: options.task_namespace,
    capability_fingerprint: capability,
    context_digest: sha256(Buffer.from(JSON.stringify(options.context))),
  });
}

function snapshotDigest(binding, contextState, summary) {
  return sha256(Buffer.from(JSON.stringify({ binding, context_state: contextState, summary })));
}

function createHandoffSnapshot(binding, summary) {
  const normalized = validateBinding(binding);
  if (!summary || typeof summary.next_action !== 'string' || summary.next_action.length === 0) {
    throw new Error('INVALID_HANDOFF_SUMMARY');
  }
  const copiedSummary = JSON.parse(JSON.stringify(summary));
  return {
    schema_version: 'lazyseries.handoff-snapshot.v1',
    binding: normalized,
    context_state: 'fresh-handoff',
    summary: copiedSummary,
    snapshot_sha256: snapshotDigest(normalized, 'fresh-handoff', copiedSummary),
  };
}

function capacityBlock(capacity) {
  if (!capacity || capacity.available !== true) return capacity?.reason || 'capacity-unavailable';
  const required = capacity.required_bytes;
  const remaining = capacity.remaining_bytes;
  if (required !== undefined || remaining !== undefined) {
    if (!Number.isSafeInteger(required) || required < 0
      || !Number.isSafeInteger(remaining) || remaining < required) return 'quota-insufficient';
  }
  return null;
}

function resumeContinuation({ current, handoff, capacity }) {
  const blocked = capacityBlock(capacity);
  if (blocked) return { status: 'blocked', completion: 'blocked', reason: blocked, preflight: 'denied' };
  const normalized = validateBinding(current);
  if (!handoff || handoff.schema_version !== 'lazyseries.handoff-snapshot.v1') {
    return { status: 'stale', completion: 'blocked', reason: 'handoff-snapshot-missing', requires_handoff_snapshot: true };
  }
  if (handoff.context_state !== 'fresh-handoff') {
    return { status: 'stale', completion: 'blocked', reason: 'stale-context:' + handoff.context_state, requires_handoff_snapshot: true };
  }
  for (const field of BINDING_FIELDS) {
    if (handoff.binding?.[field] !== normalized[field]) {
      return { status: 'stale', completion: 'blocked', reason: 'binding-mismatch:' + field, requires_handoff_snapshot: true };
    }
  }
  if (handoff.snapshot_sha256 !== snapshotDigest(handoff.binding, handoff.context_state, handoff.summary)) {
    return { status: 'stale', completion: 'blocked', reason: 'handoff-snapshot-tampered', requires_handoff_snapshot: true };
  }
  return {
    status: 'resumed', completion: 'eligible', replay_required: false,
    context_source: 'handoff-snapshot', next_action: handoff.summary.next_action,
  };
}

function evidencePath(root, input) {
  const parts = [input.task_namespace, input.criterion_id, input.worker_id, input.name];
  const labels = ['task_namespace', 'criterion_id', 'worker_id', 'evidence_name'];
  return path.join(path.resolve(root), ...parts.map((part, index) => requireSegment(part, labels[index])));
}

function recordCriterionEvidence(root, input) {
  const target = evidencePath(root, input);
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(String(input.bytes));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('EVIDENCE_NAME_COLLISION:' + target);
    throw error;
  }
  return { path: target, sha256: sha256(bytes), bytes: bytes.length };
}

function writeJSONAtomic(target, value) {
  const temporary = target + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function recordFlakeFailure(root, input) {
  const task = requireSegment(input.task_namespace, 'task_namespace');
  const criterion = requireSegment(input.criterion_id, 'criterion_id');
  if (typeof input.assertion !== 'string' || input.assertion.length === 0) throw new Error('INVALID_ASSERTION');
  const fingerprint = crypto.createHash('sha256').update(input.assertion).digest('hex');
  const directory = path.join(path.resolve(root), task, criterion, 'flakes', fingerprint);
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.lock');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('FLAKE_RECORD_BUSY');
    throw error;
  }
  try {
    const statePath = path.join(directory, 'state.json');
    const state = fs.existsSync(statePath)
      ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
      : { assertion_sha256: 'sha256:' + fingerprint, artifacts: [] };
    const occurrence = state.artifacts.length + 1;
    const artifact = recordCriterionEvidence(root, {
      task_namespace: task, criterion_id: criterion, worker_id: 'flake-' + fingerprint.slice(0, 12),
      name: 'occurrence-' + occurrence + '.log', bytes: input.bytes,
    });
    state.artifacts.push(artifact);
    writeJSONAtomic(statePath, state);
    if (occurrence === 1) {
      const retryNamespace = path.join(directory, 'retry-1-clean');
      fs.mkdirSync(retryNamespace, { recursive: false });
      return { status: 'retryable', retry: 1, clean_namespace: true, retry_namespace: retryNamespace, artifacts: [...state.artifacts] };
    }
    return { status: 'blocked', completion: 'blocked', route: 'comprehensive', reason: 'identical-flake-repeated', artifacts: [...state.artifacts] };
  } finally {
    fs.rmdirSync(lock);
  }
}

module.exports = {
  BINDING_FIELDS, createCurrentBinding, createHandoffSnapshot, recordCriterionEvidence,
  recordFlakeFailure, resumeContinuation, validateBinding,
};
