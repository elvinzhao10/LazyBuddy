'use strict';

const fs = require('node:fs');

const HOSTS = Object.freeze(['codebuddy-cli', 'codebuddy-ide', 'workbuddy', 'trae-cli', 'trae-ide', 'trae-work']);
const NATIVE_MODES = Object.freeze(['invoke-documented', 'observe-only', 'descriptor-only', 'unavailable']);
const RAW_EVENTS = Object.freeze([
  'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop', 'TaskCompleted', 'TaskCreated', 'UserPromptSubmit', 'PermissionRequest',
  'PermissionDenied', 'Notification', 'PostCompact', 'SessionEnd', 'InstructionsLoaded', 'ConfigChange',
  'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult',
]);
const RAW_EVENT_MAPPING = Object.freeze(Object.fromEntries(RAW_EVENTS.map(value => [value, value.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()])));
const FORBIDDEN_KEY = /(?:^|_)(?:token|password|secret|credential|grant|api_?key|private_?key|remote_?key|raw_?prompt|prompt|private_?transcript|transcript|authorization|oauth)(?:$|_)/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._-]{10,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function record(value, name) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(`${name} must be an object`);
  return value;
}

function exactKeys(value, required, optional, name) {
  const keys = Object.keys(record(value, name));
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter(key => !Object.hasOwn(value, key));
  const unknown = keys.filter(key => !allowed.has(key));
  if (missing.length) fail(`${name} missing ${missing.join(', ')}`);
  if (unknown.length) fail(`${name} has unknown fields: ${unknown.join(', ')}`);
}

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) fail(`${name} is unsupported`);
}

function text(value, name, pattern = null) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`);
  if (pattern && !pattern.test(value)) fail(`${name} is malformed`);
}

function timestamp(value, name) {
  text(value, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value))) fail(`${name} is malformed`);
}

function rejectSensitive(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSensitive(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail(`forbidden secret field at ${path}.${key}`);
      rejectSensitive(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) fail(`secret value at ${path}`);
}

function validateFreshness(value, { now, allowPending = false }) {
  timestamp(now, 'now');
  exactKeys(value, ['status', 'observed_at', 'expires_at'], [], 'freshness');
  oneOf(value.status, allowPending ? ['current', 'pending'] : ['current'], 'freshness.status');
  if (value.status === 'pending') {
    if (value.observed_at !== null || value.expires_at !== null) fail('pending freshness cannot claim host evidence');
    return;
  }
  timestamp(value.observed_at, 'freshness.observed_at');
  timestamp(value.expires_at, 'freshness.expires_at');
  if (Date.parse(value.expires_at) <= Date.parse(now)) fail('stale freshness receipt');
  if (Date.parse(value.expires_at) <= Date.parse(value.observed_at)) fail('freshness expiry must follow observation');
}

function validateSurface(value, { now, allowPending = false }) {
  exactKeys(value, ['surface_id', 'native_mode', 'host_authority', 'package_owner', 'direction', 'merge_key', 'base_digest', 'freshness', 'source_receipt'], [], 'surface');
  text(value.surface_id, 'surface.surface_id', ID);
  oneOf(value.native_mode, NATIVE_MODES, 'surface.native_mode');
  if (value.host_authority !== 'host') fail('surface authority must remain host');
  oneOf(value.package_owner, ['LazyBuddy', 'LazyTrae'], 'surface.package_owner');
  oneOf(value.direction, ['host-to-package', 'package-to-host', 'bidirectional', 'none'], 'surface.direction');
  text(value.merge_key, 'surface.merge_key', ID);
  text(value.base_digest, 'surface.base_digest', SHA256);
  validateFreshness(record(value.freshness, 'freshness'), { now, allowPending });
  exactKeys(value.source_receipt, ['receipt_id', 'sha256', 'redacted'], [], 'source_receipt');
  text(value.source_receipt.receipt_id, 'source_receipt.receipt_id', ID);
  text(value.source_receipt.sha256, 'source_receipt.sha256', SHA256);
  if (value.source_receipt.redacted !== true) fail('source receipt must be redacted');
}

function validateBase(value, type, required, { now, allowPending = false }) {
  rejectSensitive(value);
  exactKeys(value, ['schema_version', 'contract_version', 'record_type', ...required], [], type);
  if (value.schema_version !== 1) fail('schema_version is unsupported');
  if (value.contract_version !== '1.0.0') fail('contract_version is unsupported');
  if (value.record_type !== type) fail(`record_type must be ${type}`);
  oneOf(value.host, HOSTS, 'host');
  validateSurface(record(value.surface, 'surface'), { now, allowPending });
  const expectedOwner = value.host.startsWith('trae-') ? 'LazyTrae' : 'LazyBuddy';
  if (value.surface.package_owner !== expectedOwner) fail(`surface package owner must be ${expectedOwner}`);
  return value;
}

function canonicalizeEvent(value, { seen = new Set(), now = new Date().toISOString() } = {}) {
  rejectSensitive(value);
  exactKeys(value, ['schema_version', 'contract_version', 'record_type', 'event_id', 'host', 'raw_event', 'occurred_at', 'surface', 'payload'], ['canonical_event'], 'canonical-event');
  if (value.schema_version !== 1) fail('schema_version is unsupported');
  if (value.contract_version !== '1.0.0') fail('contract_version is unsupported');
  if (value.record_type !== 'canonical-event') fail('record_type must be canonical-event');
  oneOf(value.host, HOSTS, 'host');
  validateSurface(record(value.surface, 'surface'), { now });
  const expectedOwner = value.host.startsWith('trae-') ? 'LazyTrae' : 'LazyBuddy';
  if (value.surface.package_owner !== expectedOwner) fail(`surface package owner must be ${expectedOwner}`);
  text(value.event_id, 'event_id', ID);
  text(value.raw_event, 'raw_event');
  timestamp(value.occurred_at, 'occurred_at');
  record(value.payload, 'payload');
  const mapped = RAW_EVENT_MAPPING[value.raw_event] || 'unsupported';
  if (value.canonical_event !== undefined && value.canonical_event !== mapped) fail(`canonical_event must map to ${mapped}`);
  const event = { ...value, canonical_event: mapped };
  if (seen.has(event.event_id)) return { outcome: 'duplicate', event };
  seen.add(event.event_id);
  return { outcome: 'accepted', event };
}

function canonicalizeEvents(values, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(values)) fail('events must be an array');
  const seen = new Set();
  return values.map(value => canonicalizeEvent(value, { seen, now }));
}

function validateHostObservation(value, { now = new Date().toISOString() } = {}) {
  validateBase(value, 'host-observation', ['observation_id', 'event_id', 'host', 'session_id', 'status', 'observed_at', 'surface', 'facts'], { now });
  text(value.observation_id, 'observation_id', ID);
  text(value.event_id, 'event_id', ID);
  text(value.session_id, 'session_id', ID);
  oneOf(value.status, ['observed', 'unsupported'], 'status');
  timestamp(value.observed_at, 'observed_at');
  if (!Array.isArray(value.facts)) fail('facts must be an array');
  value.facts.forEach((fact, index) => {
    exactKeys(fact, ['name', 'value'], [], `facts[${index}]`);
    text(fact.name, `facts[${index}].name`, ID);
    if (!['string', 'number', 'boolean'].includes(typeof fact.value)) fail(`facts[${index}].value must be scalar`);
  });
  return value;
}

function validateMirrorRecord(value, { now = new Date().toISOString() } = {}) {
  validateBase(value, 'generated-mirror', ['mirror_id', 'source_observation_id', 'host', 'status', 'canonical_owner', 'surface', 'value_digest'], { now });
  text(value.mirror_id, 'mirror_id', ID);
  text(value.source_observation_id, 'source_observation_id', ID);
  oneOf(value.status, ['mirrored', 'unsupported'], 'status');
  if (value.canonical_owner !== 'package') fail('mirror canonical owner must be package, never host authority');
  text(value.value_digest, 'value_digest', SHA256);
  return value;
}

function validateOnboardingReceipt(value, { now = new Date().toISOString() } = {}) {
  validateBase(value, 'onboarding-receipt', ['receipt_id', 'host', 'status', 'generated_at', 'surface', 'current_host_evidence'], { now, allowPending: true });
  text(value.receipt_id, 'receipt_id', ID);
  oneOf(value.status, ['pending', 'observed', 'unsupported'], 'status');
  timestamp(value.generated_at, 'generated_at');
  if (value.status === 'pending') {
    if (value.current_host_evidence !== null || value.surface.freshness.status !== 'pending') fail('pending receipt cannot claim current host evidence');
  } else {
    exactKeys(value.current_host_evidence, ['observation_id', 'sha256'], [], 'current_host_evidence');
    text(value.current_host_evidence.observation_id, 'current_host_evidence.observation_id', ID);
    text(value.current_host_evidence.sha256, 'current_host_evidence.sha256', SHA256);
  }
  return value;
}

function createPendingOnboardingReceipts({ generatedAt = new Date().toISOString() } = {}) {
  return HOSTS.map(host => validateOnboardingReceipt({
    schema_version: 1, contract_version: '1.0.0', record_type: 'onboarding-receipt', receipt_id: `pending:${host}`,
    host, status: 'pending', generated_at: generatedAt,
    surface: { surface_id: `${host}:onboarding`, native_mode: 'observe-only', host_authority: 'host', package_owner: host.startsWith('trae-') ? 'LazyTrae' : 'LazyBuddy', direction: 'host-to-package', merge_key: `${host}:onboarding`, base_digest: '0'.repeat(64), freshness: { status: 'pending', observed_at: null, expires_at: null }, source_receipt: { receipt_id: `pending:${host}`, sha256: '0'.repeat(64), redacted: true } },
    current_host_evidence: null,
  }, { now: generatedAt }));
}

function cli(argv) {
  const [kind, file, now = new Date().toISOString()] = argv;
  if (!kind || !file) fail('usage: lazyseries-host-evidence.v1.js <event|observation|mirror|receipt> <json-file> [now]');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = kind === 'event' ? canonicalizeEvent(value, { now }) : kind === 'events' ? canonicalizeEvents(value, { now }) : kind === 'observation' ? validateHostObservation(value, { now }) : kind === 'mirror' ? validateMirrorRecord(value, { now }) : kind === 'receipt' ? validateOnboardingReceipt(value, { now }) : fail('unsupported record kind');
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
}

if (require.main === module) {
  try { cli(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { HOSTS, NATIVE_MODES, RAW_EVENTS, RAW_EVENT_MAPPING, canonicalizeEvent, canonicalizeEvents, createPendingOnboardingReceipts, validateHostObservation, validateMirrorRecord, validateOnboardingReceipt };
