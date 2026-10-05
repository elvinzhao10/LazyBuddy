import { commandDigest } from './history.mjs';

// Portable project records. These deliberately do not extend native run or proof contracts.
export const RUNTIMES = Object.freeze(['LazyBuddy', 'LazyTrae', 'LazyQoder', 'LazyZCode', 'LazyKimi', 'LazyDeepSeek']);
export const SOURCE_ROLES = Object.freeze(['overview', 'principles', 'requirements', 'architecture', 'decision', 'plan', 'research']);
export const ITEM_KINDS = Object.freeze(['feature', 'principle', 'requirement', 'decision']);
export const ITEM_STATES = Object.freeze(['proposed', 'accepted', 'superseded', 'retired']);
export const PLAN_LIFECYCLES = Object.freeze(['draft', 'planned', 'active', 'paused', 'completed', 'superseded', 'abandoned']);
export const OPERATIONS = Object.freeze(['register_source', 'record_baseline_items', 'register_plan', 'link_native_run']);

export class ProjectContractError extends Error {
  constructor(code, message = code) { super(message); this.name = 'ProjectContractError'; this.code = code; }
}
export function fail(code, message) { throw new ProjectContractError(code, message); }

function object(value, fields, optional = [], path = 'value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(fields, key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_VALUE', `${path}.${key} must be JSON data`);
  }
  for (const [key, validate] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) {
      if (!optional.includes(key)) fail('MISSING_FIELD', `${path}.${key} is required`);
    } else validate(value[key], `${path}.${key}`);
  }
  return value;
}
const string = (maximum = 8192) => (value, path) => {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.includes('\0')) fail('INVALID_VALUE', `${path} must be bounded nonempty text`);
};
const text = string();
const id = (value, path) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value)) fail('INVALID_ID', `${path} is not a valid identity`);
};
const integer = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_VALUE', `${path} must be a nonnegative safe integer`);
};
const positive = (value, path) => { integer(value, path); if (value === 0) fail('INVALID_VALUE', `${path} must be positive`); };
const literal = expected => (value, path) => { if (value !== expected) fail('INVALID_VALUE', `${path} has an unsupported value`); };
const choice = values => (value, path) => { if (!values.includes(value)) fail('INVALID_VALUE', `${path} has an unsupported value`); };
const nullable = validate => (value, path) => { if (value !== null) validate(value, path); };
const array = (validate, maximum = 10000) => (value, path) => {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_VALUE', `${path} must be a bounded JSON array`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_VALUE', `${path} must not contain holes or accessors`);
    validate(value[index], `${path}[${index}]`);
  }
};
const hash = (value, path) => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('INVALID_VALUE', `${path} must be a SHA-256 digest`); };
const timestamp = (value, path) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail('INVALID_VALUE', `${path} must be a UTC timestamp`);
};
export function assertRelativeSourcePath(value, path = 'source.path') {
  text(value, path);
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) fail('UNSAFE_SOURCE_PATH', `${path} must be repository-relative`);
  const parts = value.toLowerCase().split('/');
  if (parts[0] === '.git' || /^\.lazy(buddy|trae|qoder|zcode|kimi|deepseek)$/.test(parts[0]) && ['dashboard', 'project'].includes(parts[1])) fail('PROTECTED_SOURCE_PATH', `${path} is protected storage`);
}
const anchor = (value, path) => {
  text(value, path);
  if (value !== 'document' && (!value.startsWith('heading:') || !value.slice(8).trim() || /[\r\n]/.test(value))) fail('INVALID_ANCHOR', `${path} must identify the document or one heading`);
};
const sourceRef = (value, path) => object(value, { source_id: id, sha256: hash, anchor_id: anchor }, [], path);
const baselineRef = (value, path) => object(value, { item_id: id, item_revision: positive }, [], path);
const nativeRef = (value, path) => object(value, { runtime: choice(RUNTIMES), native_project_id: id, run_id: id }, [], path);
const linkedRun = (value, path) => object(value, {
  runtime: choice(RUNTIMES), native_project_id: id, run_id: id, linked_at: timestamp, linked_by: text,
}, [], path);
const itemInput = (value, path) => object(value, {
  id, kind: choice(ITEM_KINDS), source: sourceRef, state: choice(ITEM_STATES),
  strength: choice(['binding', 'advisory']), related_item_ids: array(id),
}, ['strength', 'related_item_ids'], path);
const source = (value, path) => object(value, {
  id, path: assertRelativeSourcePath, role: choice(SOURCE_ROLES), accepted_sha256: hash,
  revision: positive, registered_at: timestamp,
}, [], path);
const item = (value, path) => object(value, {
  id, kind: choice(ITEM_KINDS), title: text, text: string(1048576), source: sourceRef,
  revision: positive, state: choice(ITEM_STATES), strength: choice(['binding', 'advisory']),
  related_item_ids: array(id), recorded_by: text, recorded_at: timestamp,
}, [], path);
const plan = (value, path) => object(value, {
  id, title: text, text: string(1048576), source: sourceRef, revision: positive,
  declared_lifecycle: choice(PLAN_LIFECYCLES), baseline_refs: array(baselineRef),
  native_runs: array(linkedRun), registered_at: timestamp, updated_at: timestamp,
}, [], path);
const payloads = {
  register_source: (value, path) => object(value, { id, path: assertRelativeSourcePath, role: choice(SOURCE_ROLES) }, [], path),
  record_baseline_items: (value, path) => object(value, { items: array(itemInput, 1000) }, [], path),
  register_plan: (value, path) => object(value, {
    id, source: sourceRef, declared_lifecycle: choice(PLAN_LIFECYCLES), baseline_refs: array(baselineRef),
  }, [], path),
  link_native_run: (value, path) => object(value, { plan_id: id, native_project_id: id, run_id: id }, [], path),
};
export function assertProjectCommand(value, path = 'command') {
  object(value, { schema_version: literal(1), command_id: id, project_id: id, expected_revision: integer,
    operation: choice(OPERATIONS), payload: () => {} }, [], path);
  payloads[value.operation](value.payload, `${path}.payload`);
  return value;
}
const receipt = (value, path) => object(value, {
  schema_version: literal(1), command_id: id, project_id: id, operation: choice(OPERATIONS),
  status: choice(['saved', 'conflict']), revision: integer, baseline_revision: integer,
  actor: text, occurred_at: timestamp, reason: nullable(text), changed_ids: array(id),
}, [], path);
const receiptRecord = (value, path) => object(value, { command: assertProjectCommand, sha256: hash, receipt }, [], path);
export function unique(values, key, label) {
  const found = new Set();
  for (const value of values) {
    const identity = key(value);
    if (found.has(identity)) fail('DUPLICATE_ID', `${label} contains a duplicate identity`);
    found.add(identity);
  }
  return found;
}
export function assertProjectState(value) {
  object(value, {
    schema_version: literal(1), project_id: id, runtime: choice(RUNTIMES), repository_key: text,
    created_at: timestamp, revision: integer, baseline_revision: integer,
    sources: array(source, 512), items: array(item, 4096), plans: array(plan, 1024), receipts: array(receiptRecord),
  }, [], 'state');
  const sourceIds = unique(value.sources, entry => entry.id, 'sources');
  unique(value.sources, entry => entry.path, 'source paths');
  const itemIds = unique(value.items, entry => entry.id, 'items');
  unique(value.plans, entry => entry.id, 'plans');
  unique(value.receipts, entry => entry.command.command_id, 'receipts');
  for (const entry of [...value.items, ...value.plans]) {
    if (!sourceIds.has(entry.source.source_id)) fail('UNKNOWN_SOURCE', 'A project record references an unknown source');
  }
  for (const entry of value.items) {
    unique(entry.related_item_ids, related => related, 'related items');
    if (entry.related_item_ids.some(related => related === entry.id || !itemIds.has(related))) fail('INVALID_REFERENCE', 'An item has an invalid related-item reference');
  }
  const itemById = new Map(value.items.map(entry => [entry.id, entry]));
  for (const entry of value.plans) {
    unique(entry.baseline_refs, reference => reference.item_id, 'baseline references');
    for (const reference of entry.baseline_refs) {
      const target = itemById.get(reference.item_id);
      if (!target) fail('UNKNOWN_ITEM', 'A plan references an unknown baseline item');
      if (reference.item_revision > target.revision) fail('INVALID_REFERENCE', 'A plan references an unknown future item revision');
    }
    unique(entry.native_runs, reference => JSON.stringify([reference.runtime, reference.native_project_id, reference.run_id]), 'native run references');
    if (entry.native_runs.some(reference => reference.runtime !== value.runtime)) fail('FOREIGN_RUNTIME', 'A native run belongs to another runtime');
  }
  if (value.receipts.length !== value.revision || value.baseline_revision > value.revision) fail('INVALID_HISTORY', 'Project revisions do not match retained command history');
  let baselineRevision = 0;
  value.receipts.forEach((entry, index) => {
    const result = entry.receipt;
    if (commandDigest(entry.command) !== entry.sha256) fail('INVALID_HISTORY', 'A retained command does not match its digest');
    if (entry.command.project_id !== value.project_id || result.project_id !== value.project_id ||
        result.command_id !== entry.command.command_id || result.operation !== entry.command.operation ||
        entry.command.expected_revision !== index || result.revision !== index + 1 || result.status !== 'saved' || result.reason !== null ||
        result.baseline_revision < baselineRevision || result.baseline_revision > baselineRevision + 1) fail('INVALID_HISTORY', 'Project command history is inconsistent');
    baselineRevision = result.baseline_revision;
  });
  if (baselineRevision !== value.baseline_revision) fail('INVALID_HISTORY', 'Baseline revision does not match command history');
  return value;
}
export function assertCreateOptions(value) {
  return object(value, { projectId: id, runtime: choice(RUNTIMES), repositoryKey: text, createdAt: timestamp }, [], 'options');
}
export function assertProjectContext(value) {
  const capture = (entry, path) => object(entry, { source_id: id, path: assertRelativeSourcePath,
    sha256: hash, content: string(8388608) }, [], path);
  object(value, { actor: text, occurredAt: timestamp, capturedSources: array(capture, 512), capturedRuns: array(nativeRef, 1024) }, ['capturedRuns'], 'context');
  unique(value.capturedSources, entry => entry.source_id, 'captured sources');
  unique(value.capturedRuns ?? [], entry => JSON.stringify([entry.runtime, entry.native_project_id, entry.run_id]), 'captured runs');
  return value;
}
export function assertProjectionOptions(value) {
  const sourceObservation = (entry, path) => {
    object(entry, { source_id: id, status: choice(['available', 'missing', 'unavailable']),
      sha256: hash, path: assertRelativeSourcePath, observed_at: timestamp }, ['sha256', 'path', 'observed_at'], path);
    if (entry.status === 'available' && !Object.hasOwn(entry, 'sha256')) fail('MISSING_FIELD', `${path}.sha256 is required for an available source`);
    if (entry.status !== 'available' && Object.hasOwn(entry, 'sha256')) fail('INVALID_VALUE', `${path} cannot claim a digest for inaccessible content`);
  };
  const runObservation = (entry, path) => object(entry, {
    runtime: choice(RUNTIMES), native_project_id: id, run_id: id,
    execution: choice(['not_started', 'running', 'finished', 'failed', 'cancelled']), observed_at: timestamp,
  }, [], path);
  object(value, { sourceObservations: array(sourceObservation, 512), runObservations: array(runObservation, 1024) }, ['sourceObservations', 'runObservations'], 'observations');
  unique(value.sourceObservations ?? [], entry => entry.source_id, 'source observations');
  unique(value.runObservations ?? [], entry => JSON.stringify([entry.runtime, entry.native_project_id, entry.run_id]), 'run observations');
  return value;
}
