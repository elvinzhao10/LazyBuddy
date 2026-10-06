import { commandDigest, sha256Text } from './history.mjs';

// Portable project records. These deliberately do not extend native run or proof contracts.
export const RUNTIMES = Object.freeze(['LazyBuddy', 'LazyTrae', 'LazyQoder', 'LazyZCode', 'LazyKimi', 'LazyDeepSeek']);
export const SOURCE_ROLES = Object.freeze(['overview', 'principles', 'requirements', 'architecture', 'decision', 'plan', 'research']);
export const ITEM_KINDS = Object.freeze(['feature', 'principle', 'requirement', 'decision']);
export const ITEM_STATES = Object.freeze(['proposed', 'accepted', 'superseded', 'retired']);
export const PLAN_LIFECYCLES = Object.freeze(['draft', 'planned', 'active', 'paused', 'completed', 'superseded', 'abandoned']);
export const APPLICABILITY_SCOPES = Object.freeze(['repository', 'component', 'environment', 'migration']);
export const PREPARATION_STAGES = Object.freeze(['exploring', 'researching', 'drafting', 'in_review']);
export const ARCHITECTURE_KINDS = Object.freeze(['application', 'subsystem', 'component', 'interface', 'data_store', 'boundary']);
export const ARCHITECTURE_RELATIONSHIPS = Object.freeze(['contains', 'depends_on', 'uses', 'provides', 'calls', 'extends']);
export const OBSERVATION_SUBJECT_KINDS = Object.freeze(['source', 'item', 'plan', 'architecture', 'artifact', 'run', 'git', 'worktree', 'usage']);
export const OBSERVATION_CLASSIFICATIONS = Object.freeze(['observed', 'inferred']);
export const PROVENANCE_KINDS = Object.freeze(['collector', 'native_event', 'registered_document', 'file']);
export const ARTIFACT_TYPES = Object.freeze(['verification_report', 'test_summary', 'screenshot', 'recording', 'log', 'design_note', 'research', 'release_receipt']);
export const RECONCILE_TRIGGERS = Object.freeze(['project_adoption', 'session_load', 'source_change', 'new_plan', 'baseline_amendment', 'branch_change', 'research', 'execution_checkpoint']);
export const PROPOSAL_STATES = Object.freeze(['proposed', 'accepted', 'rejected', 'superseded']);
export const REQUEST_KINDS = Object.freeze(['run', 'run_cancel']);
export const CONTENT_OPERATIONS = Object.freeze(['register_source', 'record_baseline_items', 'register_plan', 'link_native_run']);
export const SOURCE_OPERATIONS = Object.freeze(['source.map', 'source.edit.preview', 'source.edit', 'source.adopt']);
export const CAPABILITY_OPERATIONS = Object.freeze(['project.read', 'project.change.preview', 'project.change.apply',
  'project.reconcile.request', 'plan.create', 'plan.edit', 'plan.transition', 'run.request', 'run.cancel.request', 'artifact.register']);
export const OPERATIONS = Object.freeze([...CONTENT_OPERATIONS, ...CAPABILITY_OPERATIONS, ...SOURCE_OPERATIONS,
  'amend_baseline', 'record_baseline_proposal', 'record_architecture_elements', 'record_research_findings']);

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
const boolean = (value, path) => { if (typeof value !== 'boolean') fail('INVALID_VALUE', `${path} must be a boolean`); };
const repositoryKey = (value, path) => {
  text(value, path);
  if (!/^repo:[a-f0-9]{64}$/.test(value)) fail('INVALID_VALUE', `${path} must be a repository key of the form repo:<64 hex>`);
};
const commitId = (value, path) => {
  text(value, path);
  if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) fail('INVALID_VALUE', `${path} must be a commit object id`);
};
const timestamp = (value, path) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail('INVALID_VALUE', `${path} must be a UTC timestamp`);
};
export function assertRelativeSourcePath(value, path = 'source.path') {
  text(value, path);
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) fail('UNSAFE_SOURCE_PATH', `${path} must be repository-relative`);
  const parts = value.toLowerCase().split('/');
  if (parts[0] === '.git' || /^\.lazy(buddy|trae|qoder|zcode|kimi|deepseek)$/.test(parts[0]) && ['dashboard', 'project'].includes(parts[1])) fail('PROTECTED_SOURCE_PATH', `${path} is protected storage`);
  // The neutral registry namespace is service-owned identity, never registrable
  // content: the contract itself refuses it so no route can accept it.
  if (parts[0] === '.lazyseries') fail('PROTECTED_REGISTRY_PATH', `${path} is the protected registry namespace`);
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
const applicability = (value, path) => {
  object(value, { scope: choice(APPLICABILITY_SCOPES), subject_ids: array(id, 256), period: text }, ['subject_ids', 'period'], path);
  if (value.scope === 'repository') {
    if (value.subject_ids?.length) fail('INVALID_VALUE', `${path}.subject_ids must be empty for repository-wide applicability`);
  } else if (!value.subject_ids?.length) fail('MISSING_FIELD', `${path}.subject_ids is required for scoped applicability`);
  if (value.scope === 'migration' && !Object.hasOwn(value, 'period')) fail('MISSING_FIELD', `${path}.period is required for an explicit migration period`);
  if (value.scope !== 'migration' && Object.hasOwn(value, 'period')) fail('INVALID_VALUE', `${path}.period is only valid for a migration period`);
  unique(value.subject_ids ?? [], subject => subject, `${path}.subject_ids`);
};
const metricCoverage = (value, path) => object(value, { reported: nullable(integer), total: nullable(integer) }, [], path);
const observationFilters = (value, path) => object(value, {
  plan_id: nullable(id), run_id: nullable(id), task_id: nullable(id), worktree: nullable(text),
}, [], path);
const metricWindow = (value, path) => object(value, { from: nullable(timestamp), to: nullable(timestamp) }, [], path);
const metric = (value, path) => {
  object(value, {
    definition: text, unit: choice(['count', 'request', 'token', 'millisecond', 'minute', 'currency', 'path', 'session', 'agent', 'percent']),
    basis: text, support: text, scope: choice(['repository', 'worktree', 'plan', 'run', 'task']),
    filters: observationFilters, window: metricWindow, source_record_ids: array(id, 4096),
    coverage: metricCoverage, as_of: timestamp, projection_revision: integer,
  }, ['filters'], path);
  const filters = value.filters ?? {};
  for (const [scope, field] of [['worktree', 'worktree'], ['plan', 'plan_id'], ['run', 'run_id'], ['task', 'task_id']]) {
    if (value.scope === scope && !filters[field]) fail('MISSING_FIELD', `${path}.filters.${field} is required for ${scope} scope`);
  }
  if (value.scope === 'repository' && ['plan_id', 'run_id', 'task_id', 'worktree'].some(field => filters[field])) {
    fail('INVALID_VALUE', `${path}.filters must stay empty for repository scope`);
  }
  unique(value.source_record_ids, record => record, `${path}.source_record_ids`);
};
const SUBJECT_RECORD_KINDS = ['source', 'item', 'plan', 'architecture', 'artifact', 'run'];
const observationSubject = (value, path) => {
  object(value, { kind: choice(OBSERVATION_SUBJECT_KINDS), id: nullable(id), worktree: nullable(text) }, ['id', 'worktree'], path);
  if (SUBJECT_RECORD_KINDS.includes(value.kind) && !value.id) fail('MISSING_FIELD', `${path}.id is required for this subject kind`);
  if (!SUBJECT_RECORD_KINDS.includes(value.kind) && value.id != null) fail('INVALID_VALUE', `${path}.id is reserved for record-backed subjects`);
  if (value.kind === 'worktree' && !value.worktree) fail('MISSING_FIELD', `${path}.worktree is required for a worktree subject`);
};
const observationFields = {
  id, subject: observationSubject, classification: choice(OBSERVATION_CLASSIFICATIONS),
  observed_by: text, observed_at: timestamp,
  provenance: (value, path) => object(value, { kind: choice(PROVENANCE_KINDS), reference: text }, [], path),
  content_revision: nullable(text), text: string(1048576),
  coverage: metricCoverage, artifact_ids: array(id, 512), metric,
};
const observationOptional = ['content_revision', 'coverage', 'artifact_ids', 'metric'];
export function assertObservationInput(value, path = 'observation') {
  object(value, observationFields, observationOptional, path);
  unique(value.artifact_ids ?? [], artifact => artifact, `${path}.artifact_ids`);
  return value;
}
const observationRecord = (value, path) => {
  object(value, { ...observationFields, version: positive }, observationOptional, path);
  unique(value.artifact_ids ?? [], artifact => artifact, `${path}.artifact_ids`);
  return value;
};
const proposalPatch = (value, path) => object(value, {
  source_id: id, anchor_id: anchor, current_sha256: hash, proposed_text: string(1048576),
}, [], path);
const proposalOption = (value, path) => object(value, { id, title: text, summary: text }, ['summary'], path);
const proposalImpact = (value, path) => object(value, {
  item_ids: array(id, 256), plan_ids: array(id, 256), architecture_ids: array(id, 256),
}, [], path);
const proposal = (value, path) => {
  object(value, { id, state: choice(PROPOSAL_STATES), summary: text,
    patches: array(proposalPatch, 64), options: array(proposalOption, 16), impact: proposalImpact,
    evidence_observation_ids: array(id, 512), unresolved: nullable(text), authority: nullable(text),
    proposed_by: text, proposed_at: timestamp, revision: positive }, [], path);
  unique(value.options, option => option.id, `${path}.options`);
  unique(value.evidence_observation_ids, record => record, `${path}.evidence_observation_ids`);
  return value;
};
const architectureRelationship = (value, path) => object(value, {
  target_id: id, kind: choice(ARCHITECTURE_RELATIONSHIPS), note: text,
}, ['note'], path);
// Accepted-amendment receipts carry the exact relationships a behavioral change
// invalidated, so reconciliation (T08) only ever visits affected work.
const invalidationAffected = (value, path) => object(value, {
  plan_id: id, considered_revision: positive, carried_forward: boolean,
}, [], path);
const invalidationFact = (value, path) => {
  object(value, { item_id: id, from_revision: positive, to_revision: positive,
    reason: literal('BEHAVIORAL_REQUIREMENT_CHANGE'), affected: array(invalidationAffected, 256) }, [], path);
  if (value.to_revision <= value.from_revision) fail('INVALID_VALUE', `${path}.to_revision must exceed from_revision`);
  unique(value.affected, entry => entry.plan_id, `${path}.affected`);
  return value;
};
const planReferenceUpdate = (value, path) => object(value, {
  plan_id: id, baseline_refs: array(baselineRef, 4096),
}, [], path);
const architectureRelationships = (value, path) => {
  array(architectureRelationship, 128)(value, path);
  unique(value, relationship => `${relationship.kind}:${relationship.target_id}`, `${path}`);
  return value;
};
const architectureElement = (value, path) => {
  object(value, { id, kind: choice(ARCHITECTURE_KINDS), title: text, role: text, source: sourceRef,
    parent_id: nullable(id), relationships: architectureRelationships,
    recorded_by: text, recorded_at: timestamp, revision: positive }, ['parent_id'], path);
  return value;
};
const researchFinding = (value, path) => {
  object(value, { id, question: text, sources: array(text, 64), captured_at: timestamp,
    findings: string(1048576), uncertainty: nullable(text), recommendation: nullable(text),
    promotion_proposal_id: nullable(id), recorded_by: text, recorded_at: timestamp, revision: positive },
    ['uncertainty', 'recommendation', 'promotion_proposal_id'], path);
  unique(value.sources, source => source, `${path}.sources`);
  return value;
};
const reconciliationChanged = (value, path) => object(value, {
  source_ids: array(id, 512), item_ids: array(id, 512), plan_ids: array(id, 256), architecture_ids: array(id, 256),
}, [], path);
const reconciliationCheck = (value, path) => object(value, {
  check: text, outcome: choice(['passed', 'failed', 'unassessed']), detail: nullable(text),
}, ['detail'], path);
const reconciliation = (value, path) => {
  object(value, { id, trigger: choice(RECONCILE_TRIGGERS), changed: reconciliationChanged,
    checks: array(reconciliationCheck, 256), automatic_change_ids: array(id, 512),
    unresolved_proposal_ids: array(id, 256), native_adoption: choice(['unobserved', 'requested', 'observed']),
    recorded_by: text, recorded_at: timestamp }, [], path);
  unique(value.checks, check => check.check, `${path}.checks`);
  unique(value.changed.source_ids, identity => identity, `${path}.changed.source_ids`);
  unique(value.changed.item_ids, identity => identity, `${path}.changed.item_ids`);
  unique(value.changed.plan_ids, identity => identity, `${path}.changed.plan_ids`);
  unique(value.changed.architecture_ids, identity => identity, `${path}.changed.architecture_ids`);
  unique(value.automatic_change_ids, identity => identity, `${path}.automatic_change_ids`);
  unique(value.unresolved_proposal_ids, identity => identity, `${path}.unresolved_proposal_ids`);
  return value;
};
const artifactRecord = (value, path) => object(value, {
  id, type: choice(ARTIFACT_TYPES), producer: text, path: assertRelativeSourcePath,
  sha256: nullable(hash), registered_by: text, registered_at: timestamp,
}, ['sha256'], path);
const requestRecord = (value, path) => object(value, {
  id, kind: choice(REQUEST_KINDS), plan_id: id, run_id: nullable(id), note: nullable(text),
  state: literal('recorded'), delivery: literal('unobserved'), requested_by: text, requested_at: timestamp,
}, ['run_id', 'note'], path);
const decisionInputFields = (value, path) => {
  if (value.kind !== 'decision' && ['chosen', 'rejected', 'superseded_by'].some(field => Object.hasOwn(value, field))) {
    fail('INVALID_VALUE', `${path} decision fields apply to decision items only`);
  }
};
const itemInput = (value, path) => {
  object(value, {
    id, kind: choice(ITEM_KINDS), source: sourceRef, state: choice(ITEM_STATES),
    strength: choice(['binding', 'advisory']), related_item_ids: array(id),
    applicability, rationale: text, authority: text,
    chosen: text, rejected: array(text, 16), superseded_by: nullable(id),
  }, ['strength', 'related_item_ids', 'applicability', 'rationale', 'authority', 'chosen', 'rejected', 'superseded_by'], path);
  decisionInputFields(value, path);
};
const source = (value, path) => object(value, {
  id, path: assertRelativeSourcePath, role: choice(SOURCE_ROLES), accepted_sha256: hash,
  revision: positive, registered_at: timestamp, skeleton_sha256: hash,
}, ['skeleton_sha256'], path);
// Stable document anchors: identities survive moves and renames, so they bind to
// the normalized heading title fingerprint, never to a position.
const sourceAnchor = (value, path) => {
  object(value, { anchor_id: id, source_id: id, kind: literal('heading'), fingerprint: hash,
    title: text, level: integer, assigned_revision: positive }, [], path);
  if (value.level < 1 || value.level > 6) fail('INVALID_VALUE', `${path}.level must be a Markdown heading level`);
  if (value.fingerprint !== sha256Text(value.title.replace(/\s+/g, ' ').trim())) {
    fail('INVALID_VALUE', `${path}.fingerprint must match its normalized heading title`);
  }
  return value;
};
const item = (value, path) => {
  object(value, {
    id, kind: choice(ITEM_KINDS), title: text, text: string(1048576), source: sourceRef,
    revision: positive, state: choice(ITEM_STATES), strength: choice(['binding', 'advisory']),
    related_item_ids: array(id), applicability, rationale: text, authority: text,
    chosen: text, rejected: array(text, 16), superseded_by: nullable(id),
    recorded_by: text, recorded_at: timestamp,
  }, ['applicability', 'rationale', 'authority', 'chosen', 'rejected', 'superseded_by'], path);
  decisionInputFields(value, path);
};
const planSupersession = (value, path) => object(value, {
  reason: text, successor_plan_id: id,
}, ['successor_plan_id'], path);
const planTransition = (value, path) => object(value, {
  from: choice(PLAN_LIFECYCLES), to: choice(PLAN_LIFECYCLES), occurred_at: timestamp, by: text,
  reason: nullable(text), successor_plan_id: nullable(id),
}, [], path);
const plan = (value, path) => {
  object(value, {
    id, title: text, text: string(1048576), source: sourceRef, revision: positive,
    declared_lifecycle: choice(PLAN_LIFECYCLES), baseline_refs: array(baselineRef),
    native_runs: array(linkedRun), registered_at: timestamp, updated_at: timestamp,
    preparation: choice(PREPARATION_STAGES), supersession: planSupersession, last_transition: planTransition,
  }, ['preparation', 'supersession', 'last_transition'], path);
  if (Object.hasOwn(value, 'preparation') && value.declared_lifecycle !== 'draft') {
    fail('INVALID_VALUE', `${path}.preparation applies to draft plans only`);
  }
  return value;
};
const innerChange = (value, path) => {
  object(value, { operation: choice(CONTENT_OPERATIONS), payload: () => {} }, [], path);
  payloads[value.operation](value.payload, `${path}.payload`);
  return value;
};
// AST-level edit units. Each names its target through a stable anchor plus a
// checklist position; no edit may address bytes inside a fenced example.
const sourceEditOperation = (value, path) => {
  object(value, { kind: choice(['set_task_state', 'set_task_text', 'rename_heading', 'move_section']),
    anchor_id: id, item: integer, state: choice(['checked', 'unchecked']), text: string(65536),
    title: string(1024), before_anchor_id: nullable(id) },
  ['item', 'state', 'text', 'title', 'before_anchor_id'], path);
  const present = key => Object.hasOwn(value, key);
  if (value.kind === 'set_task_state') {
    if (!present('item') || !present('state') || present('text') || present('title') || present('before_anchor_id')) {
      fail('INVALID_VALUE', `${path} set_task_state needs item and state only`);
    }
  } else if (value.kind === 'set_task_text') {
    if (!present('item') || !present('text') || present('state') || present('title') || present('before_anchor_id')) {
      fail('INVALID_VALUE', `${path} set_task_text needs item and text only`);
    }
    if (/[\r\n]/.test(value.text)) fail('INVALID_VALUE', `${path}.text must stay on one line`);
  } else if (value.kind === 'rename_heading') {
    if (!present('title') || present('item') || present('state') || present('text') || present('before_anchor_id')) {
      fail('INVALID_VALUE', `${path} rename_heading needs title only`);
    }
    if (/[\r\n]/.test(value.title) || !value.title.trim()) fail('INVALID_VALUE', `${path}.title must be one nonempty line`);
  } else if (present('item') || present('state') || present('text') || present('title')) {
    fail('INVALID_VALUE', `${path} move_section takes only before_anchor_id`);
  }
  return value;
};
const sourceEditPayload = (value, path) => object(value, {
  authority: text, source_id: id, expected_sha256: hash, expected_source_revision: positive,
  edits: array(sourceEditOperation, 256),
}, [], path);
const payloads = {
  register_source: (value, path) => object(value, { id, path: assertRelativeSourcePath, role: choice(SOURCE_ROLES) }, [], path),
  record_baseline_items: (value, path) => object(value, { items: array(itemInput, 1000) }, [], path),
  register_plan: (value, path) => object(value, {
    id, source: sourceRef, declared_lifecycle: choice(PLAN_LIFECYCLES), baseline_refs: array(baselineRef),
  }, [], path),
  link_native_run: (value, path) => object(value, { plan_id: id, native_project_id: id, run_id: id }, [], path),
  'project.read': (value, path) => object(value, {}, [], path),
  'project.change.preview': (value, path) => object(value, { change: innerChange }, [], path),
  'project.change.apply': (value, path) => object(value, { change: innerChange }, [], path),
  'project.reconcile.request': (value, path) => object(value, {
    id, trigger: choice(RECONCILE_TRIGGERS), changed: reconciliationChanged, note: text,
  }, ['changed', 'note'], path),
  'plan.create': (value, path) => object(value, {
    id, source: sourceRef, declared_lifecycle: choice(['draft', 'planned']),
    preparation: choice(PREPARATION_STAGES), baseline_refs: array(baselineRef),
  }, ['preparation'], path),
  'plan.edit': (value, path) => object(value, {
    id, source: sourceRef, preparation: choice(PREPARATION_STAGES), baseline_refs: array(baselineRef),
  }, ['preparation'], path),
  'plan.transition': (value, path) => object(value, {
    plan_id: id, to_lifecycle: choice(PLAN_LIFECYCLES), reason: text, successor_plan_id: id,
  }, ['reason', 'successor_plan_id'], path),
  'run.request': (value, path) => object(value, { id, plan_id: id, note: text }, ['note'], path),
  'run.cancel.request': (value, path) => object(value, { id, plan_id: id, run_id: id, note: text }, ['note'], path),
  'artifact.register': (value, path) => object(value, {
    id, type: choice(ARTIFACT_TYPES), producer: text, path: assertRelativeSourcePath, sha256: hash,
  }, ['sha256'], path),
  // One authorized acceptance: a journaled transaction that applies the source
  // edit, re-records the affected baseline records against the amended content,
  // and carries linked non-historical plan references forward coherently. The
  // authority reference is mandatory — a proposal without it can never mutate
  // the accepted baseline through this route.
  amend_baseline: (value, path) => object(value, {
    authority: text,
    source: (value, path) => object(value, {
      source_id: id, expected_sha256: hash, expected_source_revision: positive,
    }, [], path),
    edits: array(sourceEditOperation, 256),
    items: array(itemInput, 1000),
    plan_updates: array(planReferenceUpdate, 256),
    proposal_id: nullable(id),
  }, ['proposal_id'], path),
  record_baseline_proposal: (value, path) => object(value, {
    id, summary: text, patches: array(proposalPatch, 64), options: array(proposalOption, 16),
    impact: proposalImpact, evidence_observation_ids: array(id, 512),
    unresolved: nullable(text), authority: nullable(text),
  }, ['unresolved', 'authority'], path),
  record_architecture_elements: (value, path) => object(value, { elements: array((value, path) => {
    object(value, { id, kind: choice(ARCHITECTURE_KINDS), title: text, role: text, source: sourceRef,
      parent_id: nullable(id), relationships: architectureRelationships }, ['parent_id'], path);
  }, 256) }, [], path),
  record_research_findings: (value, path) => object(value, { findings: array((value, path) => {
    object(value, { id, question: text, sources: array(text, 64), captured_at: timestamp,
      findings: string(1048576), uncertainty: nullable(text), recommendation: nullable(text),
      promotion_proposal_id: nullable(id) }, ['uncertainty', 'recommendation', 'promotion_proposal_id'], path);
  }, 256) }, [], path),
  'source.map': (value, path) => object(value, { source_id: id }, [], path),
  'source.edit.preview': sourceEditPayload,
  'source.edit': sourceEditPayload,
  'source.adopt': (value, path) => object(value, {
    authority: text, source_id: id, expected_source_revision: positive,
  }, ['expected_source_revision'], path),
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
  invalidations: array(invalidationFact, 256),
}, ['invalidations'], path);
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
    proposals: array(proposal, 256), architecture: array(architectureElement, 1024),
    research: array(researchFinding, 1024), reconciliations: array(reconciliation, 1024),
    observations: array(observationRecord, 8192), artifacts: array(artifactRecord, 4096),
    requests: array(requestRecord, 4096), observation_revision: integer,
    source_anchors: array(sourceAnchor, 131072),
  }, ['proposals', 'architecture', 'research', 'reconciliations', 'observations', 'artifacts', 'requests',
    'observation_revision', 'source_anchors'], 'state');
  const sourceIds = unique(value.sources, entry => entry.id, 'sources');
  unique(value.sources, entry => entry.path, 'source paths');
  unique(value.source_anchors ?? [], entry => entry.anchor_id, 'source anchors');
  unique(value.source_anchors ?? [], entry => `${entry.source_id}\u0000${entry.fingerprint}`, 'source anchor fingerprints');
  for (const entry of value.source_anchors ?? []) {
    if (!sourceIds.has(entry.source_id)) fail('UNKNOWN_SOURCE', 'A source anchor references an unknown source');
  }
  const itemIds = unique(value.items, entry => entry.id, 'items');
  const planIds = unique(value.plans, entry => entry.id, 'plans');
  unique(value.receipts, entry => entry.command.command_id, 'receipts');
  const proposalIds = unique(value.proposals ?? [], entry => entry.id, 'proposals');
  const architectureIds = unique(value.architecture ?? [], entry => entry.id, 'architecture');
  unique(value.research ?? [], entry => entry.id, 'research');
  unique(value.reconciliations ?? [], entry => entry.id, 'reconciliations');
  const observationIds = unique(value.observations ?? [], entry => entry.id, 'observations');
  const artifactIds = unique(value.artifacts ?? [], entry => entry.id, 'artifacts');
  unique(value.artifacts ?? [], entry => entry.path, 'artifact paths');
  unique(value.requests ?? [], entry => entry.id, 'requests');
  const collections = [['sources', sourceIds], ['items', itemIds], ['plans', planIds], ['proposals', proposalIds],
    ['architecture', architectureIds], ['research', unique(value.research ?? [], entry => entry.id, 'research')],
    ['reconciliations', unique(value.reconciliations ?? [], entry => entry.id, 'reconciliations')],
    ['observations', observationIds], ['artifacts', artifactIds],
    ['requests', unique(value.requests ?? [], entry => entry.id, 'requests')]];
  const globalIds = new Map();
  for (const [label, identities] of collections) {
    for (const identity of identities) {
      if (globalIds.has(identity)) fail('AMBIGUOUS_ID', `The identity is claimed by both ${globalIds.get(identity)} and ${label}`);
      globalIds.set(identity, label);
    }
  }
  const runIds = new Set();
  for (const entry of value.plans) for (const reference of entry.native_runs) runIds.add(reference.run_id);
  const applicabilityIds = new Set([...itemIds, ...architectureIds]);
  const subjectIds = { source: sourceIds, item: itemIds, plan: planIds, architecture: architectureIds, artifact: artifactIds, run: runIds };
  for (const entry of value.items) {
    if (entry.applicability?.scope === 'component') for (const subject of entry.applicability.subject_ids ?? []) {
      if (!applicabilityIds.has(subject)) fail('INVALID_REFERENCE', 'An applicability scope references an unknown identity');
    }
    if (entry.superseded_by != null) {
      const target = value.items.find(candidate => candidate.id === entry.superseded_by);
      if (!target || target.kind !== 'decision' || target.id === entry.id) fail('INVALID_REFERENCE', 'A supersession link must reference another decision item');
    }
  }
  for (const entry of value.plans) {
    if (entry.supersession?.successor_plan_id != null &&
        (!planIds.has(entry.supersession.successor_plan_id) || entry.supersession.successor_plan_id === entry.id)) {
      fail('INVALID_REFERENCE', 'A plan supersession link must reference another plan');
    }
  }
  for (const entry of value.proposals ?? []) {
    for (const patch of entry.patches) if (!sourceIds.has(patch.source_id)) fail('UNKNOWN_SOURCE', 'A proposal patch references an unknown source');
    for (const identity of entry.impact.item_ids) if (!itemIds.has(identity)) fail('INVALID_REFERENCE', 'A proposal impacts an unknown item');
    for (const identity of entry.impact.plan_ids) if (!planIds.has(identity)) fail('INVALID_REFERENCE', 'A proposal impacts an unknown plan');
    for (const identity of entry.impact.architecture_ids) if (!architectureIds.has(identity)) fail('INVALID_REFERENCE', 'A proposal impacts an unknown architecture element');
    for (const identity of entry.evidence_observation_ids) if (!observationIds.has(identity)) fail('UNKNOWN_OBSERVATION', 'A proposal cites an unknown observation');
  }
  for (const entry of value.architecture ?? []) {
    if (entry.parent_id != null && (!architectureIds.has(entry.parent_id) || entry.parent_id === entry.id)) {
      fail('INVALID_REFERENCE', 'An architecture containment link must reference another element');
    }
    for (const relationship of entry.relationships) {
      if (!architectureIds.has(relationship.target_id) || relationship.target_id === entry.id) {
        fail('INVALID_REFERENCE', 'An architecture relationship must reference another element');
      }
    }
  }
  for (const entry of value.research ?? []) {
    if (entry.promotion_proposal_id != null && !proposalIds.has(entry.promotion_proposal_id)) {
      fail('INVALID_REFERENCE', 'A research promotion link references an unknown proposal');
    }
  }
  const automaticIds = new Set([...itemIds, ...planIds]);
  for (const entry of value.reconciliations ?? []) {
    for (const identity of entry.changed.source_ids) if (!sourceIds.has(identity)) fail('UNKNOWN_SOURCE', 'A reconciliation names an unknown source');
    for (const identity of entry.changed.item_ids) if (!itemIds.has(identity)) fail('INVALID_REFERENCE', 'A reconciliation names an unknown item');
    for (const identity of entry.changed.plan_ids) if (!planIds.has(identity)) fail('UNKNOWN_PLAN', 'A reconciliation names an unknown plan');
    for (const identity of entry.changed.architecture_ids) if (!architectureIds.has(identity)) fail('INVALID_REFERENCE', 'A reconciliation names an unknown architecture element');
    for (const identity of entry.automatic_change_ids) if (!automaticIds.has(identity)) fail('INVALID_REFERENCE', 'An automatic change names an unknown record');
    for (const identity of entry.unresolved_proposal_ids) if (!proposalIds.has(identity)) fail('INVALID_REFERENCE', 'A reconciliation names an unknown proposal');
  }
  for (const entry of value.observations ?? []) {
    const scope = subjectIds[entry.subject.kind];
    if (scope && !scope.has(entry.subject.id)) fail('UNKNOWN_SUBJECT', 'An observation references an unknown subject');
    for (const identity of entry.artifact_ids ?? []) if (!artifactIds.has(identity)) fail('INVALID_REFERENCE', 'An observation references an unknown artifact');
    if (entry.metric) for (const identity of entry.metric.source_record_ids) {
      if (!observationIds.has(identity)) fail('UNKNOWN_OBSERVATION', 'A metric cites an unknown source record');
    }
  }
  for (const entry of value.requests ?? []) {
    if (!planIds.has(entry.plan_id)) fail('UNKNOWN_PLAN', 'A request references an unknown plan');
    if (entry.kind === 'run_cancel' && (entry.run_id == null || !runIds.has(entry.run_id))) {
      fail('INVALID_REFERENCE', 'A cancel request must target a linked native run');
    }
  }
  const versions = unique(value.observations ?? [], entry => entry.version, 'observation versions');
  if (versions.size && (value.observation_revision ?? 0) < Math.max(...versions)) {
    fail('INVALID_HISTORY', 'Observation versions exceed the retained observation revision');
  }
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
  const identityObservation = (entry, path) => {
    object(entry, { repository_key: repositoryKey, basis: choice(['registry', 'canonical-path']),
      legacy_repository_key: nullable(repositoryKey) }, ['legacy_repository_key'], path);
    if (entry.basis === 'canonical-path' && Object.hasOwn(entry, 'legacy_repository_key')) {
      fail('INVALID_VALUE', `${path}.legacy_repository_key applies to a registry identity only`);
    }
    return entry;
  };
  const worktreeObservation = (entry, path) => {
    object(entry, { root: text, kind: choice(['main', 'linked']), branch: nullable(text), head: nullable(commitId),
      detached: boolean, bare: boolean, current: boolean }, [], path);
    if ((entry.detached || entry.bare) && entry.branch !== null) {
      fail('INVALID_VALUE', `${path}.branch must be null for a detached or bare worktree`);
    }
    if (!entry.detached && !entry.bare && entry.branch === null) {
      fail('MISSING_FIELD', `${path}.branch is required for an attached worktree`);
    }
    return entry;
  };
  object(value, { sourceObservations: array(sourceObservation, 512), runObservations: array(runObservation, 1024),
    identity: identityObservation, worktreeObservations: array(worktreeObservation, 64) },
    ['sourceObservations', 'runObservations', 'identity', 'worktreeObservations'], 'observations');
  unique(value.sourceObservations ?? [], entry => entry.source_id, 'source observations');
  unique(value.runObservations ?? [], entry => JSON.stringify([entry.runtime, entry.native_project_id, entry.run_id]), 'run observations');
  unique(value.worktreeObservations ?? [], entry => entry.root, 'worktree observations');
  if (value.worktreeObservations && value.worktreeObservations.filter(entry => entry.current).length !== 1) {
    fail('INVALID_VALUE', 'observations.worktreeObservations must mark exactly one current worktree');
  }
  return value;
}

// The runtime-neutral repository registry (`.lazyseries/project.json`): stable identity
// and a source pointer list. It carries no document bodies and no execution authority.
export function assertProjectRegistry(value) {
  const registrySource = (entry, path) => object(entry, { id, role: choice(SOURCE_ROLES), path: assertRelativeSourcePath }, [], path);
  object(value, { schema_version: literal(1), project_id: id, repository_key: repositoryKey,
    runtime: choice(RUNTIMES), created_at: timestamp, sources: array(registrySource, 512) }, [], 'registry');
  unique(value.sources, entry => entry.id, 'registry sources');
  unique(value.sources, entry => entry.path, 'registry source paths');
  return value;
}
export function assertCapabilityRequest(value, path = 'request') {
  object(value, { schema_version: literal(1), operation: choice(CAPABILITY_OPERATIONS),
    command_id: id, project_id: id, expected_revision: integer, payload: () => {} },
    ['command_id', 'project_id', 'expected_revision', 'payload'], path);
  if (Object.hasOwn(value, 'payload')) payloads[value.operation](value.payload, `${path}.payload`);
  return value;
}
