import { assertCapabilityRequest, assertCreateOptions, assertObservationInput, assertProjectCommand,
  assertProjectContext, assertProjectState, fail, unique, ProjectContractError } from './contract.mjs';
import { canonicalJSON, commandDigest } from './history.mjs';
import { projectSnapshot } from './projection.mjs';
import { amendBaseline } from './baseline/amendment.mjs';
import { adoptSource, captureFor, performSourceEdit, sourceEditPreview, sourceMapResult, syncAnchors } from './source-edit/editing.mjs';
import { extractSourceAnchor, skeletonDigest } from './source-edit/markdown.mjs';

export { extractSourceAnchor };

const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => canonicalJSON(left) === canonicalJSON(right);
const compact = value => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

export function createProject(options) {
  assertCreateOptions(options);
  return { schema_version: 1, project_id: options.projectId, runtime: options.runtime,
    repository_key: options.repositoryKey, created_at: options.createdAt, revision: 0,
    baseline_revision: 0, observation_revision: 0, sources: [], items: [], plans: [], receipts: [],
    proposals: [], architecture: [], research: [], reconciliations: [], observations: [], artifacts: [],
    requests: [], source_anchors: [] };
}

function resolveSource(state, reference, context) {
  const source = state.sources.find(entry => entry.id === reference.source_id);
  if (!source) fail('UNKNOWN_SOURCE', 'The document must be registered before binding an item or plan');
  if (source.accepted_sha256 !== reference.sha256) fail('SOURCE_REVISION_MISMATCH', 'Explicitly register the requested source revision first');
  const capture = captureFor(state, source.id, context, source.path, reference.sha256);
  return { source, ...extractSourceAnchor(capture.content, reference.anchor_id, source.path) };
}

function registerSource(state, payload, context) {
  const capture = captureFor(state, payload.id, context, payload.path);
  const existing = state.sources.find(entry => entry.id === payload.id);
  if (state.sources.some(entry => entry.id !== payload.id && entry.path === payload.path)) fail('DUPLICATE_SOURCE_PATH', 'A source path already has a different identity');
  const changed = !existing || existing.path !== payload.path || existing.role !== payload.role || existing.accepted_sha256 !== capture.sha256;
  if (changed) {
    const replacement = { id: payload.id, path: payload.path, role: payload.role,
      accepted_sha256: capture.sha256, revision: (existing?.revision ?? 0) + 1,
      registered_at: context.occurredAt, skeleton_sha256: skeletonDigest(capture.content) };
    if (existing) state.sources[state.sources.indexOf(existing)] = replacement;
    else state.sources.push(replacement);
    // Registering or refreshing a source assigns stable anchors to its unambiguous
    // headings; a copy under a new source identity receives fresh anchor ids.
    const others = (state.source_anchors ?? []).filter(record => record.source_id !== payload.id);
    const seed = (state.source_anchors ?? []).filter(record => record.source_id === payload.id);
    const synced = syncAnchors(seed, state.source_anchors ?? [], payload.id, capture.content, state.revision + 1);
    state.source_anchors = [...others, ...synced.records];
  }
  return changed ? [payload.id] : [];
}

function recordItems(state, payload, context) {
  if (!payload.items.length) fail('EMPTY_CHANGE', 'At least one baseline item is required');
  unique(payload.items, entry => entry.id, 'baseline command items');
  const known = new Set([...state.items.map(entry => entry.id), ...payload.items.map(entry => entry.id)]);
  const changedIds = []; let meaningChanged = false;
  for (const input of payload.items) {
    const source = resolveSource(state, input.source, context);
    const existing = state.items.find(entry => entry.id === input.id);
    if (existing && existing.kind !== input.kind) fail('IDENTITY_KIND_MISMATCH', 'An existing item cannot change kind');
    const related = input.related_item_ids ?? [];
    unique(related, value => value, 'related items');
    if (related.some(value => value === input.id || !known.has(value))) fail('INVALID_REFERENCE', 'A related item must reference another known baseline identity');
    if (input.superseded_by != null) {
      const successor = input.superseded_by === input.id ? undefined
        : payload.items.find(entry => entry.id === input.superseded_by) ??
          state.items.find(entry => entry.id === input.superseded_by);
      if (!successor || successor.kind !== 'decision') fail('INVALID_REFERENCE', 'A supersession link must reference another decision item');
    }
    if (input.applicability?.scope === 'component') for (const subject of input.applicability.subject_ids ?? []) {
      const knownArchitecture = (state.architecture ?? []).some(entry => entry.id === subject);
      if (!known.has(subject) && !knownArchitecture) fail('INVALID_REFERENCE', 'An applicability scope references an unknown identity');
    }
    const details = clone(compact({ kind: input.kind, title: source.title, text: source.text, state: input.state,
      strength: input.strength ?? (input.kind === 'principle' ? 'binding' : 'advisory'), related_item_ids: [...related],
      applicability: input.applicability, rationale: input.rationale, authority: input.authority,
      chosen: input.chosen, rejected: input.rejected, superseded_by: input.superseded_by }));
    const priorDetails = existing && compact(Object.fromEntries(Object.keys(details).map(key => [key, existing[key]])));
    const semanticChange = !existing || !equal(details, priorDetails);
    const changed = semanticChange || !equal(input.source, existing.source);
    if (changed) {
      const replacement = { id: input.id, ...details, source: clone(input.source),
        revision: (existing?.revision ?? 0) + (semanticChange ? 1 : 0),
        recorded_by: context.actor, recorded_at: context.occurredAt };
      if (existing) state.items[state.items.indexOf(existing)] = replacement;
      else state.items.push(replacement);
      changedIds.push(input.id);
    }
    meaningChanged ||= semanticChange;
  }
  if (meaningChanged) state.baseline_revision += 1;
  return changedIds;
}

function registerPlan(state, payload, context) {
  const source = resolveSource(state, payload.source, context);
  if (source.source.role !== 'plan') fail('SOURCE_ROLE_MISMATCH', 'A plan must bind a registered plan document');
  unique(payload.baseline_refs, entry => entry.item_id, 'plan baseline references');
  for (const reference of payload.baseline_refs) {
    const item = state.items.find(entry => entry.id === reference.item_id);
    if (!item) fail('UNKNOWN_ITEM', 'A plan references an unknown baseline item');
    if (reference.item_revision > item.revision) fail('INVALID_REFERENCE', 'A plan cannot reference an unknown future baseline revision');
  }
  const existing = state.plans.find(entry => entry.id === payload.id);
  const details = { title: source.title, text: source.text, source: clone(payload.source),
    declared_lifecycle: payload.declared_lifecycle, baseline_refs: clone(payload.baseline_refs) };
  if (existing && equal(details, Object.fromEntries(Object.keys(details).map(key => [key, existing[key]])))) return [];
  const replacement = { id: payload.id, ...details, revision: (existing?.revision ?? 0) + 1,
    native_runs: existing?.native_runs ?? [], registered_at: existing?.registered_at ?? context.occurredAt,
    updated_at: context.occurredAt };
  for (const key of ['preparation', 'supersession', 'last_transition']) {
    if (existing && Object.hasOwn(existing, key)) replacement[key] = clone(existing[key]);
  }
  if (existing) state.plans[state.plans.indexOf(existing)] = replacement;
  else state.plans.push(replacement);
  return [payload.id];
}

function linkRun(state, payload, context) {
  const plan = state.plans.find(entry => entry.id === payload.plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'The plan must be registered before linking a native run');
  const capture = (context.capturedRuns ?? []).find(entry => entry.runtime === state.runtime &&
    entry.native_project_id === payload.native_project_id && entry.run_id === payload.run_id);
  if (!capture) fail('RUN_CAPTURE_REQUIRED', 'An inspected run from the selected native runtime is required');
  if (plan.native_runs.some(entry => entry.runtime === capture.runtime && entry.native_project_id === capture.native_project_id && entry.run_id === capture.run_id)) return [];
  plan.native_runs.push({ ...clone(capture), linked_at: context.occurredAt, linked_by: context.actor });
  plan.revision += 1; plan.updated_at = context.occurredAt;
  return [plan.id];
}

const contentReducers = { register_source: registerSource, record_baseline_items: recordItems,
  register_plan: registerPlan, link_native_run: linkRun };

function applyChange(state, payload, context) {
  const change = payload.change;
  return contentReducers[change.operation](state, change.payload, context);
}

function planCreate(state, payload, context) {
  if (state.plans.some(entry => entry.id === payload.id)) fail('DUPLICATE_PLAN', 'plan.create requires a new plan identity');
  if (payload.preparation && payload.declared_lifecycle !== 'draft') fail('INVALID_VALUE', 'A preparation stage applies to drafts only');
  const changed = registerPlan(state, { id: payload.id, source: payload.source,
    declared_lifecycle: payload.declared_lifecycle, baseline_refs: payload.baseline_refs }, context);
  if (payload.preparation) state.plans.find(entry => entry.id === payload.id).preparation = payload.preparation;
  return changed;
}

function planEdit(state, payload, context) {
  const existing = state.plans.find(entry => entry.id === payload.id);
  if (!existing) fail('UNKNOWN_PLAN', 'plan.edit requires an existing plan');
  if (payload.preparation && existing.declared_lifecycle !== 'draft') fail('INVALID_VALUE', 'A preparation stage applies to drafts only');
  const changed = registerPlan(state, { id: payload.id, source: payload.source,
    declared_lifecycle: existing.declared_lifecycle, baseline_refs: payload.baseline_refs }, context);
  const plan = state.plans.find(entry => entry.id === payload.id);
  const nextPreparation = Object.hasOwn(payload, 'preparation') ? payload.preparation : plan.preparation;
  if ((nextPreparation ?? null) !== (plan.preparation ?? null)) {
    if (nextPreparation === undefined) delete plan.preparation;
    else plan.preparation = nextPreparation;
    if (!changed.length) { plan.revision += 1; plan.updated_at = context.occurredAt; }
    if (!changed.includes(plan.id)) changed.push(plan.id);
  }
  return changed;
}

const PLAN_TRANSITIONS = {
  draft: ['planned', 'superseded', 'abandoned'],
  planned: ['active', 'superseded', 'abandoned'],
  active: ['paused', 'completed', 'superseded', 'abandoned'],
  paused: ['active', 'completed', 'superseded', 'abandoned'],
  completed: ['superseded'],
  superseded: [],
  abandoned: [],
};

function planTransition(state, payload, context) {
  const plan = state.plans.find(entry => entry.id === payload.plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'The plan must exist before a lifecycle transition');
  if (!PLAN_TRANSITIONS[plan.declared_lifecycle].includes(payload.to_lifecycle)) {
    fail('INVALID_TRANSITION', 'The declared lifecycle cannot move to the requested state');
  }
  if (payload.to_lifecycle === 'active' && !plan.native_runs.length) {
    fail('NATIVE_RUN_REQUIRED', 'Active requires a linked native run');
  }
  if (['superseded', 'abandoned'].includes(payload.to_lifecycle) && !payload.reason) {
    fail('MISSING_FIELD', 'Retiring a plan requires its reason');
  }
  if (payload.to_lifecycle === 'superseded' && !payload.successor_plan_id) {
    fail('MISSING_FIELD', 'Superseding a plan requires its replacement link');
  }
  if (payload.successor_plan_id != null &&
      (!state.plans.some(entry => entry.id === payload.successor_plan_id) || payload.successor_plan_id === plan.id)) {
    fail('INVALID_REFERENCE', 'A successor must be another registered plan');
  }
  const from = plan.declared_lifecycle;
  plan.declared_lifecycle = payload.to_lifecycle;
  if (Object.hasOwn(plan, 'preparation')) delete plan.preparation;
  if (['superseded', 'abandoned'].includes(payload.to_lifecycle)) {
    plan.supersession = compact({ reason: payload.reason, successor_plan_id: payload.successor_plan_id });
  }
  plan.last_transition = { from, to: payload.to_lifecycle, occurred_at: context.occurredAt,
    by: context.actor, reason: payload.reason ?? null, successor_plan_id: payload.successor_plan_id ?? null };
  plan.revision += 1; plan.updated_at = context.occurredAt;
  return [plan.id];
}

function reconcileRequest(state, payload, context) {
  if ((state.reconciliations ?? []).some(entry => entry.id === payload.id)) {
    fail('DUPLICATE_ID', 'A reconciliation identity cannot be re-recorded');
  }
  const changed = payload.changed ?? { source_ids: [], item_ids: [], plan_ids: [], architecture_ids: [] };
  (state.reconciliations ??= []).push({ id: payload.id, trigger: payload.trigger, changed: clone(changed),
    checks: [], automatic_change_ids: [], unresolved_proposal_ids: [], native_adoption: 'unobserved',
    recorded_by: context.actor, recorded_at: context.occurredAt });
  return [payload.id];
}

function runRequest(state, payload, context) {
  const plan = state.plans.find(entry => entry.id === payload.plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'A run request needs an existing plan');
  if (!['planned', 'active', 'paused'].includes(plan.declared_lifecycle)) {
    fail('INVALID_VALUE', 'A run request needs plan work that can still run');
  }
  if ((state.requests ?? []).some(entry => entry.id === payload.id)) fail('DUPLICATE_ID', 'A request identity cannot be re-recorded');
  (state.requests ??= []).push({ id: payload.id, kind: 'run', plan_id: payload.plan_id, run_id: null,
    note: payload.note ?? null, state: 'recorded', delivery: 'unobserved',
    requested_by: context.actor, requested_at: context.occurredAt });
  return [payload.id];
}

function runCancelRequest(state, payload, context) {
  const plan = state.plans.find(entry => entry.id === payload.plan_id);
  if (!plan) fail('UNKNOWN_PLAN', 'A cancel request needs an existing plan');
  if (!plan.native_runs.some(entry => entry.run_id === payload.run_id)) {
    fail('INVALID_REFERENCE', 'A cancel request must target a linked native run');
  }
  if ((state.requests ?? []).some(entry => entry.id === payload.id)) fail('DUPLICATE_ID', 'A request identity cannot be re-recorded');
  (state.requests ??= []).push({ id: payload.id, kind: 'run_cancel', plan_id: payload.plan_id, run_id: payload.run_id,
    note: payload.note ?? null, state: 'recorded', delivery: 'unobserved',
    requested_by: context.actor, requested_at: context.occurredAt });
  return [payload.id];
}

function artifactRegister(state, payload, context) {
  if ((state.artifacts ?? []).some(entry => entry.id === payload.id || entry.path === payload.path)) {
    fail('DUPLICATE_ID', 'An artifact identity or path is already registered');
  }
  (state.artifacts ??= []).push({ id: payload.id, type: payload.type, producer: payload.producer,
    path: payload.path, sha256: payload.sha256 ?? null,
    registered_by: context.actor, registered_at: context.occurredAt });
  return [payload.id];
}

function recordProposal(state, payload, context) {
  if ((state.proposals ?? []).some(entry => entry.id === payload.id)) {
    fail('DUPLICATE_ID', 'A proposal identity cannot be re-recorded');
  }
  (state.proposals ??= []).push({ id: payload.id, state: 'proposed', summary: payload.summary,
    patches: clone(payload.patches), options: clone(payload.options), impact: clone(payload.impact),
    evidence_observation_ids: clone(payload.evidence_observation_ids),
    unresolved: payload.unresolved ?? null, authority: payload.authority ?? null,
    proposed_by: context.actor, proposed_at: context.occurredAt, revision: 1 });
  return [payload.id];
}

function recordArchitecture(state, payload, context) {
  if (!payload.elements.length) fail('EMPTY_CHANGE', 'At least one architecture element is required');
  unique(payload.elements, element => element.id, 'architecture command elements');
  const known = new Set([...(state.architecture ?? []).map(element => element.id), ...payload.elements.map(element => element.id)]);
  for (const element of payload.elements) {
    if ((state.architecture ?? []).some(entry => entry.id === element.id)) fail('DUPLICATE_ID', 'An architecture identity cannot be re-recorded');
    if (element.parent_id != null && (!known.has(element.parent_id) || element.parent_id === element.id)) {
      fail('INVALID_REFERENCE', 'A containment link must reference another element');
    }
    for (const relationship of element.relationships) {
      if (!known.has(relationship.target_id) || relationship.target_id === element.id) {
        fail('INVALID_REFERENCE', 'A relationship must reference another element');
      }
    }
  }
  state.architecture ??= [];
  state.architecture.push(...payload.elements.map(element => ({ ...clone(element),
    recorded_by: context.actor, recorded_at: context.occurredAt, revision: 1 })));
  return payload.elements.map(element => element.id);
}

function recordResearch(state, payload, context) {
  if (!payload.findings.length) fail('EMPTY_CHANGE', 'At least one research finding is required');
  unique(payload.findings, finding => finding.id, 'research command findings');
  for (const finding of payload.findings) {
    if ((state.research ?? []).some(entry => entry.id === finding.id)) fail('DUPLICATE_ID', 'A research identity cannot be re-recorded');
    if (finding.promotion_proposal_id != null &&
        !(state.proposals ?? []).some(entry => entry.id === finding.promotion_proposal_id)) {
      fail('INVALID_REFERENCE', 'A research promotion link references an unknown proposal');
    }
  }
  state.research ??= [];
  state.research.push(...payload.findings.map(finding => ({ ...clone(finding),
    recorded_by: context.actor, recorded_at: context.occurredAt, revision: 1 })));
  return payload.findings.map(finding => finding.id);
}

// Observations are source-backed records, not accepted commands: they advance only
// the observation revision and never append command receipts or grant authority.
export function recordObservations(state, records) {
  assertProjectState(state);
  if (!Array.isArray(records) || !records.length || records.length > 1000) {
    fail('INVALID_VALUE', 'observations must be a nonempty bounded array');
  }
  const inputs = records.map(record => assertObservationInput(clone(record)));
  unique(inputs, input => input.id, 'recorded observations');
  const next = clone(state);
  next.observations ??= [];
  for (const input of inputs) {
    next.observation_revision = (next.observation_revision ?? 0) + 1;
    next.observations.push(clone({ ...input, version: next.observation_revision }));
  }
  assertProjectState(next);
  return { state: next, recorded: inputs.map(input => input.id) };
}

const capabilityNotInitialized = request => ({ schema_version: 1, status: 'not_initialized',
  operation: request.operation, hint: 'PROJECT_NOT_INITIALIZED', initialized: false });

export function projectCapability(state, request, context = {}) {
  assertCapabilityRequest(request);
  if (state === null || state === undefined) return capabilityNotInitialized(request);
  assertProjectState(state);
  if (request.project_id && request.project_id !== state.project_id) {
    return { schema_version: 1, status: 'rejected', operation: request.operation, reason: 'FOREIGN_PROJECT', initialized: true };
  }
  if (request.operation === 'project.read') {
    const projection = context && typeof context === 'object' && context.projectionOptions ? context.projectionOptions : {};
    return { schema_version: 1, status: 'ok', operation: 'project.read', initialized: true,
      project_id: state.project_id, revision: state.revision, baseline_revision: state.baseline_revision,
      observation_revision: state.observation_revision ?? 0, snapshot: projectSnapshot(state, projection) };
  }
  if (request.operation === 'project.change.preview') {
    if (!Object.hasOwn(request, 'expected_revision')) fail('MISSING_FIELD', 'A preview requires the revision it was composed against');
    if (request.expected_revision !== state.revision) {
      return { schema_version: 1, status: 'conflict', operation: 'project.change.preview',
        reason: 'REVISION_CONFLICT', initialized: true };
    }
    const next = clone(state);
    const previewContext = context && typeof context === 'object' && Array.isArray(context.capturedSources)
      ? context : { ...context, capturedSources: [] };
    try {
      const change = request.payload.change;
      const changedIds = contentReducers[change.operation](next, change.payload, previewContext);
      assertProjectState(next);
      return { schema_version: 1, status: 'valid', operation: 'project.change.preview', initialized: true,
        project_id: state.project_id, revision: state.revision, next_revision: state.revision + 1,
        next_baseline_revision: next.baseline_revision, next_observation_revision: next.observation_revision ?? 0,
        changed_ids: changedIds };
    } catch (error) {
      if (!(error instanceof ProjectContractError)) throw error;
      return { schema_version: 1, status: 'invalid', operation: 'project.change.preview',
        reason: error.code, initialized: true };
    }
  }
  if (!request.command_id) fail('MISSING_FIELD', 'This capability operation requires a command identity');
  const command = { schema_version: 1, command_id: request.command_id,
    project_id: request.project_id ?? state.project_id,
    expected_revision: Object.hasOwn(request, 'expected_revision') ? request.expected_revision : state.revision,
    operation: request.operation, payload: Object.hasOwn(request, 'payload') ? request.payload : {} };
  return applyProjectCommand(state, command, context);
}

export function applyProjectCommand(state, command, context) {
  assertProjectState(state); assertProjectCommand(command); assertProjectContext(context);
  if (command.project_id !== state.project_id) fail('FOREIGN_PROJECT', 'The command targets another project');
  if (command.operation === 'project.read' || command.operation === 'project.change.preview') {
    return projectCapability(state, { schema_version: 1, operation: command.operation,
      project_id: command.project_id, command_id: command.command_id,
      expected_revision: command.expected_revision, payload: command.payload }, context);
  }
  // Source queries are revision-checked reads through the same command route:
  // they never append a receipt and never mutate the accepted state.
  if (command.operation === 'source.edit.preview' || command.operation === 'source.map') {
    if (command.expected_revision !== state.revision) {
      return { schema_version: 1, status: 'conflict', operation: command.operation,
        reason: 'REVISION_CONFLICT', initialized: true };
    }
    const queryContext = context && typeof context === 'object' && Array.isArray(context.capturedSources)
      ? context : { ...context, capturedSources: [] };
    try {
      if (command.operation === 'source.edit.preview') return sourceEditPreview(state, command.payload, queryContext);
      return sourceMapResult(state, command.payload, queryContext);
    } catch (error) {
      if (!(error instanceof ProjectContractError)) throw error;
      return { schema_version: 1, status: 'invalid', operation: command.operation,
        reason: error.code, initialized: true };
    }
  }
  const commandHash = commandDigest(command);
  const previous = state.receipts.find(entry => entry.command.command_id === command.command_id);
  if (previous) {
    if (previous.sha256 !== commandHash) fail('IDEMPOTENCY_CONFLICT', 'A command identity cannot be reused for different content');
    return { state: clone(state), receipt: clone(previous.receipt) };
  }
  const result = { schema_version: 1, command_id: command.command_id, project_id: state.project_id,
    operation: command.operation, status: 'saved', revision: state.revision,
    baseline_revision: state.baseline_revision, actor: context.actor, occurred_at: context.occurredAt,
    reason: null, changed_ids: [] };
  if (command.expected_revision !== state.revision) {
    return { state: clone(state), receipt: { ...result, status: 'conflict', reason: 'REVISION_CONFLICT' } };
  }
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_LIMIT', 'The project revision limit was reached');
  const next = clone(state);
  const operations = { ...contentReducers,
    'project.change.apply': applyChange,
    'project.reconcile.request': reconcileRequest,
    'plan.create': planCreate,
    'plan.edit': planEdit,
    'plan.transition': planTransition,
    'run.request': runRequest,
    'run.cancel.request': runCancelRequest,
    'artifact.register': artifactRegister,
    'source.edit': performSourceEdit,
    'source.adopt': adoptSource,
    amend_baseline: amendBaseline,
    record_baseline_proposal: recordProposal,
    record_architecture_elements: recordArchitecture,
    record_research_findings: recordResearch };
  const outcome = operations[command.operation](next, command.payload, context);
  result.changed_ids = Array.isArray(outcome) ? outcome : outcome.changed_ids;
  // Accepted amendments retain the exact relationships a behavioral change
  // invalidated so reconciliation only ever visits affected work.
  if (!Array.isArray(outcome) && outcome.invalidations?.length) result.invalidations = clone(outcome.invalidations);
  next.revision += 1;
  result.revision = next.revision; result.baseline_revision = next.baseline_revision;
  next.receipts.push({ command: clone(command), sha256: commandHash, receipt: clone(result) });
  assertProjectState(next);
  // Source edits additionally return the exact file writes the native bridge
  // must land inside its journaled transaction before publishing the state.
  if (!Array.isArray(outcome) && outcome.writes && outcome.writes.length) {
    return { state: next, receipt: result, writes: outcome.writes };
  }
  return { state: next, receipt: result };
}
