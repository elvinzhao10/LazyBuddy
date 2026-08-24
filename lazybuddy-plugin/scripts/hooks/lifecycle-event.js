#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'contracts', 'codebuddy-hook-consumers.v1.json'), 'utf8'));
const MAX_INPUT_BYTES = CONTRACT.boundary.max_payload_bytes;
const ACTIVE_STATUSES = new Set(CONTRACT.boundary.active_statuses);
const SECRET_KEY = /(?:^|_)(?:token|password|secret|credential|grant|api_?key|private_?key|remote_?key|raw_?prompt|prompt|private_?transcript|transcript|authorization|oauth)(?:$|_)/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._-]{10,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const TEXT_FIELDS = new Set(['reason', 'message', 'summary', 'result']);
const PATH_FIELDS = new Set(['path', 'file_path', 'old_cwd', 'new_cwd', 'worktree_path']);
const OMITTED_COMMON_FIELDS = new Set(['transcript_path']);
const FIELDS = Object.freeze({
  PermissionRequest: ['request_id', 'tool_name', 'reason'],
  PermissionDenied: ['request_id', 'tool_name', 'reason'],
  Notification: ['notification_type', 'message'],
  PostCompact: ['trigger', 'summary'],
  SessionEnd: ['reason'],
  InstructionsLoaded: ['source', 'path'],
  ConfigChange: ['source', 'path'],
  CwdChanged: ['old_cwd', 'new_cwd'],
  FileChanged: ['file_path', 'change_type'],
  WorktreeCreate: ['name', 'worktree_path'],
  WorktreeRemove: ['name', 'worktree_path'],
  Elicitation: ['request_id', 'server_name', 'tool_name', 'message'],
  ElicitationResult: ['request_id', 'server_name', 'tool_name', 'status', 'result'],
});

class BoundaryError extends Error {
  constructor(reason, detail) {
    super(detail);
    this.reason = reason;
  }
}

function reject(reason, detail) {
  throw new BoundaryError(reason, detail);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function inspectSecrets(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectSecrets(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && !OMITTED_COMMON_FIELDS.has(key)) reject('secret_detected', `secret field at ${location}.${key}`);
      inspectSecrets(item, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) reject('secret_detected', `secret value at ${location}`);
}

function requireText(payload, key) {
  if (typeof payload[key] !== 'string' || payload[key].length === 0) reject('missing_common_field', `${key} is required`);
  return payload[key];
}

function requireIdentifier(payload, key, limit = 128) {
  const value = requireText(payload, key);
  if (value.length > limit || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) reject('malformed_common_field', `${key} is malformed`);
  return value;
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProject(payload) {
  const supplied = path.resolve(requireText(payload, 'cwd'));
  let cwd;
  try {
    cwd = fs.realpathSync(supplied);
  } catch {
    reject('stale_cwd', 'cwd does not exist');
  }
  const configured = process.env.CODEBUDDY_PROJECT_DIR;
  let projectRoot = cwd;
  if (configured) {
    try {
      projectRoot = fs.realpathSync(configured);
    } catch {
      reject('stale_cwd', 'project root does not exist');
    }
    if (!within(projectRoot, cwd)) reject('stale_cwd', 'cwd is outside the current project');
  }
  return { cwd, projectRoot };
}

function summarized(value) {
  return { redacted: true, sha256: digest(value), bytes: Buffer.byteLength(value) };
}

function normalizedPath(value, projectRoot) {
  const resolved = path.resolve(projectRoot, value);
  return within(projectRoot, resolved) ? { project_relative: path.relative(projectRoot, resolved) || '.' } : summarized(value);
}

function normalizePayload(event, payload, projectRoot) {
  const normalized = {};
  for (const key of FIELDS[event]) {
    const value = payload[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      normalized[key] = TEXT_FIELDS.has(key) ? summarized(value) : PATH_FIELDS.has(key) ? normalizedPath(value, projectRoot) : value.slice(0, 128);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
}

function activeRun(projectRoot) {
  const runsRoot = path.join(projectRoot, '.lazybuddy', 'runs');
  let entries;
  try {
    entries = fs.readdirSync(runsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null;
  }
  for (const entry of entries) {
    const statePath = path.join(runsRoot, entry.name, 'state.json');
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (state !== null && typeof state === 'object' && ACTIVE_STATUSES.has(state.status)) return { state, statePath };
    } catch {}
  }
  return null;
}

function atomicWrite(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function updateState(active, event, eventId, occurredAt, consumer) {
  if (active === null) return;
  const lifecycle = active.state.hook_lifecycle !== null && typeof active.state.hook_lifecycle === 'object' && !Array.isArray(active.state.hook_lifecycle)
    ? { ...active.state.hook_lifecycle }
    : {};
  lifecycle.last_event = { event, event_id: eventId, occurred_at: occurredAt };
  if (event === 'PermissionRequest' || event === 'PermissionDenied') {
    lifecycle.last_permission = { event_id: eventId, outcome: event === 'PermissionRequest' ? 'requested' : 'denied', completion_authority: false };
  }
  if (consumer.invalidates.length > 0) {
    const invalidations = Array.isArray(lifecycle.invalidations) ? [...lifecycle.invalidations] : [];
    invalidations.push({ event, event_id: eventId, scopes: consumer.invalidates, occurred_at: occurredAt, completion_authority: false });
    lifecycle.invalidations = invalidations;
  }
  atomicWrite(active.statePath, { ...active.state, hook_lifecycle: lifecycle });
}

function processEvent(input, expectedEvent) {
  if (input.length > MAX_INPUT_BYTES) reject('payload_too_large', `input exceeds ${MAX_INPUT_BYTES} bytes`);
  let payload;
  try {
    payload = JSON.parse(input.toString('utf8'));
  } catch {
    reject('malformed_json', 'stdin must contain one JSON object');
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') reject('malformed_json', 'stdin must contain one JSON object');
  inspectSecrets(payload);
  const sessionId = requireIdentifier(payload, 'session_id');
  requireIdentifier(payload, 'permission_mode', 64);
  const event = requireIdentifier(payload, 'hook_event_name', 64);
  if (expectedEvent && expectedEvent !== event) reject('event_mismatch', 'argument and hook_event_name differ');
  if (!Object.hasOwn(FIELDS, event)) reject('unsupported_event', event);
  const { cwd, projectRoot } = resolveProject(payload);
  const consumer = CONTRACT.events[event];
  if (!consumer || consumer.completion_authority !== false) reject('invalid_consumer', event);
  for (const field of consumer.required_fields) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) reject('missing_event_field', `${event}.${field} is required`);
  }
  const normalizedPayload = normalizePayload(event, payload, projectRoot);
  const identity = JSON.stringify({ session_id: sessionId, event, cwd, payload: normalizedPayload, delivery_id: payload.event_id || payload.delivery_id || null });
  const eventId = `evt:${digest(identity)}`;
  const sessionKey = digest(sessionId).slice(0, 24);
  const recordDir = path.join(projectRoot, '.lazybuddy', 'hook-events', sessionKey);
  const recordPath = path.join(recordDir, `${eventId.slice(4)}.json`);
  fs.mkdirSync(recordDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(recordPath)) return { status: 'accepted', outcome: 'duplicate', event_id: eventId, raw_event: event, record_path: recordPath, active_state: activeRun(projectRoot) ? 'active' : 'inactive' };
  if (payload.occurred_at !== undefined && (typeof payload.occurred_at !== 'string' || Number.isNaN(Date.parse(payload.occurred_at)))) reject('malformed_common_field', 'occurred_at is malformed');
  const occurredAt = payload.occurred_at === undefined ? new Date().toISOString() : new Date(payload.occurred_at).toISOString();
  const active = activeRun(projectRoot);
  const record = {
    schema_version: 1,
    record_type: 'normalized-hook-event',
    event_id: eventId,
    session_id: sessionId,
    raw_event: event,
    canonical_event: event.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    occurred_at: occurredAt,
    cwd,
    consumer: { name: consumer.consumer, mode: consumer.mode, completion_authority: false, invalidates: consumer.invalidates },
    payload: normalizedPayload,
  };
  updateState(active, event, eventId, occurredAt, consumer);
  atomicWrite(recordPath, record);
  return { status: 'accepted', outcome: 'recorded', event_id: eventId, raw_event: event, consumer: record.consumer, record_path: recordPath, active_state: active ? 'active' : 'inactive' };
}

try {
  process.stdout.write(`${JSON.stringify(processEvent(fs.readFileSync(0), process.argv[2]))}\n`);
} catch (error) {
  if (error instanceof BoundaryError) {
    process.stderr.write(`${JSON.stringify({ status: 'rejected', reason: error.reason, detail: error.message })}\n`);
    process.exitCode = 65;
  } else {
    process.stderr.write(`${JSON.stringify({ status: 'error', reason: 'internal_error' })}\n`);
    process.exitCode = 70;
  }
}
