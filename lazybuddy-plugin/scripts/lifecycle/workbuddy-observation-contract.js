'use strict';

const path = require('node:path');
const { LifecycleError } = require('./errors');

const SURFACES = Object.freeze([
  ['permission-mode', 'observe-only'], ['tasks', 'observe-only'], ['plans', 'observe-only'],
  ['artifacts', 'observe-only'], ['files', 'observe-only'], ['changes', 'observe-only'],
  ['previews', 'observe-only'], ['memory', 'observe-only'], ['skills', 'observe-only'],
  ['mcp', 'observe-only'], ['connectors', 'observe-only'], ['experts', 'descriptor-only'],
  ['automations', 'descriptor-only'], ['assistant', 'descriptor-only'],
]);
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = /(?:token|cookie|credential|authorization|password|secret|private[_-]?key|raw[_-]?(?:prompt|memory|message|file)|(?:prompt|memory|message|content|workspace|file|credential)[_-]?path)/i;
const FORBIDDEN_VALUE = /(?:\bbearer\s+[a-z0-9._-]{8,}|\bsk-[a-z0-9_-]{8,}|\b(?:gh[pousr]|github_pat|glpat|xox[baprs]|npm)[-_][a-z0-9_-]{20,}|\bapi[_-]?key[-_:][a-z0-9._-]{16,}|\bauthorization[:=_-](?:bearer[.:_-]?)?[a-z0-9._-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\))/i;
const CREDENTIAL_ASSIGNMENT = /^(?:session(?:[_-]?(?:id|key|token))?|cookie(?:[_-]?(?:id|key|token))?|auth(?:orization)?(?:[_-]?(?:header|key|token))?|(?:access|refresh)[_-]?token|token|secret|client[_-]?secret|password|passwd|passphrase|api[_-]?key)[:=][a-z0-9._~+/-]{16,}$/i;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function fail(code, message) {
  throw new LifecycleError(code, message);
}

function exact(value, keys, label, code = 'WORKBUDDY_OBSERVATION_INVALID') {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(code, `${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code, `${label} fields are invalid`);
}

function timestamp(value, label) {
  const parts = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  const parsed = parts === null ? Number.NaN : Date.parse(value);
  const date = new Date(parsed);
  if (parts === null || Number.isNaN(parsed) || date.getUTCFullYear() !== Number(parts[1])
    || date.getUTCMonth() + 1 !== Number(parts[2]) || date.getUTCDate() !== Number(parts[3])
    || date.getUTCHours() !== Number(parts[4]) || date.getUTCMinutes() !== Number(parts[5])
    || date.getUTCSeconds() !== Number(parts[6])) fail('WORKBUDDY_OBSERVATION_INVALID', `${label} is invalid`);
}

function rejectSensitive(value, key = '') {
  if (FORBIDDEN_KEY.test(key) || (typeof value === 'string' && FORBIDDEN_VALUE.test(value))) {
    fail('WORKBUDDY_SENSITIVE_DATA_REJECTED', 'raw content, paths, credentials, and secret material are prohibited');
  }
  if (Array.isArray(value)) value.forEach(item => rejectSensitive(item));
  else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => rejectSensitive(child, childKey));
}

function identifier(value, label) {
  if (typeof value !== 'string') fail('WORKBUDDY_OBSERVATION_INVALID', `${label} is invalid`);
  if (FORBIDDEN_VALUE.test(value) || CREDENTIAL_ASSIGNMENT.test(value)) {
    fail('WORKBUDDY_SENSITIVE_DATA_REJECTED', 'raw content, paths, credentials, and secret material are prohibited');
  }
  if (!ID.test(value)) fail('WORKBUDDY_OBSERVATION_INVALID', `${label} is invalid`);
}

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('WORKBUDDY_OBSERVATION_INVALID', `${label} is invalid`);
}

function entryList(details, idKey, statuses, label, timed = false) {
  exact(details, ['entries'], label);
  if (!Array.isArray(details.entries) || details.entries.length > 1000) fail('WORKBUDDY_OBSERVATION_INVALID', `${label} entries are invalid`);
  const ids = details.entries.map((entry, index) => {
    const keys = [idKey, 'status', 'value_digest', ...(timed ? ['updated_at'] : [])];
    exact(entry, keys, `${label}[${index}]`);
    identifier(entry[idKey], `${label}[${index}].${idKey}`);
    if (!statuses.includes(entry.status)) fail('WORKBUDDY_OBSERVATION_INVALID', `${label} status is unsupported`);
    digest(entry.value_digest, `${label}[${index}].value_digest`);
    if (timed) timestamp(entry.updated_at, `${label}[${index}].updated_at`);
    return entry[idKey];
  });
  if (new Set(ids).size !== ids.length) fail('WORKBUDDY_DUPLICATE_IDENTITY', `${label} identities must be unique`);
}

function validateDetails(surface) {
  const details = surface.details;
  switch (surface.surface_id) {
    case 'permission-mode':
      exact(details, ['mode', 'selection'], 'permission mode');
      if (!['default', 'full-access'].includes(details.mode) || details.selection !== 'not-performed') fail('WORKBUDDY_PERMISSION_MUTATION_REJECTED', 'permission mode may only be observed');
      break;
    case 'tasks': entryList(details, 'item_id', ['queued', 'running', 'blocked', 'completed', 'failed', 'cancelled'], 'tasks', true); break;
    case 'plans': entryList(details, 'item_id', ['draft', 'active', 'blocked', 'completed'], 'plans', true); break;
    case 'artifacts': entryList(details, 'item_id', ['available', 'unavailable'], 'artifacts'); break;
    case 'files': entryList(details, 'item_id', ['observed', 'changed', 'unavailable'], 'files'); break;
    case 'changes': entryList(details, 'item_id', ['pending', 'applied', 'unavailable'], 'changes'); break;
    case 'previews': entryList(details, 'item_id', ['available', 'unavailable'], 'previews'); break;
    case 'memory':
      exact(details, ['revision_digest', 'status'], 'memory');
      if (!['enabled', 'disabled', 'unknown'].includes(details.status)) fail('WORKBUDDY_OBSERVATION_INVALID', 'memory status is unsupported');
      digest(details.revision_digest, 'memory.revision_digest');
      break;
    case 'skills':
      exact(details, ['entries'], 'skills');
      if (!Array.isArray(details.entries)) fail('WORKBUDDY_OBSERVATION_INVALID', 'skills entries are invalid');
      details.entries.forEach((entry, index) => {
        exact(entry, ['skill_id', 'status', 'version_digest'], `skills[${index}]`);
        identifier(entry.skill_id, `skills[${index}].skill_id`);
        if (!['enabled', 'disabled', 'unavailable'].includes(entry.status)) fail('WORKBUDDY_OBSERVATION_INVALID', 'skill status is unsupported');
        digest(entry.version_digest, `skills[${index}].version_digest`);
      });
      break;
    case 'mcp':
      exact(details, ['entries'], 'mcp');
      if (!Array.isArray(details.entries)) fail('WORKBUDDY_OBSERVATION_INVALID', 'MCP entries are invalid');
      details.entries.forEach((entry, index) => {
        exact(entry, ['oauth_status', 'server_id', 'status', 'tool_toggle_status'], `mcp[${index}]`);
        identifier(entry.server_id, `mcp[${index}].server_id`);
        if (!['connected', 'disconnected', 'error', 'unavailable'].includes(entry.status)
          || !['authorized', 'not-authorized', 'not-required', 'unavailable'].includes(entry.oauth_status)
          || !['enabled', 'disabled', 'unavailable'].includes(entry.tool_toggle_status)) fail('WORKBUDDY_OBSERVATION_INVALID', 'MCP status is unsupported');
      });
      break;
    case 'connectors':
      exact(details, ['entries'], 'connectors');
      if (!Array.isArray(details.entries)) fail('WORKBUDDY_OBSERVATION_INVALID', 'connector entries are invalid');
      const connectorIds = [];
      details.entries.forEach((entry, index) => {
        exact(entry, ['connector_id', 'name_digest', 'status', 'type_id'], `connectors[${index}]`);
        identifier(entry.connector_id, `connectors[${index}].connector_id`);
        connectorIds.push(entry.connector_id);
        identifier(entry.type_id, `connectors[${index}].type_id`);
        digest(entry.name_digest, `connectors[${index}].name_digest`);
        if (!['connected', 'disabled', 'disconnected', 'error'].includes(entry.status)) fail('WORKBUDDY_OBSERVATION_INVALID', 'connector status is unsupported');
      });
      if (new Set(connectorIds).size !== connectorIds.length) fail('WORKBUDDY_DUPLICATE_IDENTITY', 'connector identities must be unique');
      break;
    case 'experts': case 'automations': case 'assistant':
      exact(details, ['availability', 'descriptor_digest'], surface.surface_id);
      if (!['observed', 'unavailable'].includes(details.availability)) fail('WORKBUDDY_OBSERVATION_INVALID', `${surface.surface_id} availability is unsupported`);
      digest(details.descriptor_digest, `${surface.surface_id}.descriptor_digest`);
      break;
    default: fail('WORKBUDDY_UNKNOWN_SURFACE', 'surface is unsupported');
  }
}

function validateSurfaces(surfaces, context) {
  if (!Array.isArray(surfaces) || surfaces.length !== SURFACES.length) fail('WORKBUDDY_OBSERVATION_INVALID', 'every WorkBuddy surface is required');
  surfaces.forEach((surface, index) => {
    exact(surface, ['details', 'freshness', 'host_authority', 'native_mode', 'observed_at', 'package_owner', 'source_observation_id', 'source_receipt', 'status', 'surface_id', 'value_digest'], `surfaces[${index}]`);
    const expected = SURFACES[index];
    if (surface.surface_id !== expected[0] || surface.native_mode !== expected[1]) fail('WORKBUDDY_UNKNOWN_SURFACE', 'surface order or native mode changed');
    if (surface.host_authority !== 'host' || surface.package_owner !== 'LazyBuddy') fail('WORKBUDDY_AUTHORITY_REJECTED', 'surface ownership changed');
    if (!['observed', 'unavailable'].includes(surface.status)) fail('WORKBUDDY_OBSERVATION_INVALID', 'surface status is unsupported');
    if (surface.observed_at !== context.observedAt || surface.source_observation_id !== context.observationId) fail('WORKBUDDY_OBSERVATION_INVALID', 'surface observation linkage changed');
    digest(surface.value_digest, 'surface.value_digest');
    exact(surface.freshness, ['expires_at', 'observed_at', 'status'], 'surface.freshness');
    if (surface.freshness.status !== 'current' || surface.freshness.observed_at !== context.observedAt || surface.freshness.expires_at !== context.expiresAt) fail('WORKBUDDY_STALE_OBSERVATION', 'surface freshness changed');
    exact(surface.source_receipt, ['receipt_id', 'redacted', 'sha256'], 'surface.source_receipt');
    identifier(surface.source_receipt.receipt_id, 'surface.source_receipt.receipt_id');
    if (surface.source_receipt.sha256 !== context.receiptDigest || surface.source_receipt.redacted !== true) fail('WORKBUDDY_RECEIPT_MISMATCH', 'surface receipt linkage changed');
    validateDetails(surface);
  });
}

function validateItemTimes(surfaces, observedAt, expiresAt) {
  for (const surface of surfaces.filter(item => ['tasks', 'plans'].includes(item.surface_id))) {
    if (surface.details.entries.some(entry => Date.parse(entry.updated_at) < Date.parse(observedAt)
      || Date.parse(entry.updated_at) >= Date.parse(expiresAt))) fail('WORKBUDDY_STALE_OBSERVATION', `${surface.surface_id} entry is stale`);
  }
}

function validateOutputPath(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.parse(path.resolve(target)).root === path.resolve(target)) fail('WORKBUDDY_OUTPUT_INVALID', 'output must be an absolute non-root path');
}

module.exports = { SURFACES, digest, exact, fail, identifier, rejectSensitive, timestamp, validateItemTimes, validateOutputPath, validateSurfaces };
