import { assertCreateOptions, assertProjectCommand, assertProjectContext, assertProjectState,
  fail, unique } from './contract.mjs';
import { canonicalJSON, commandDigest, sha256Text } from './history.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => canonicalJSON(left) === canonicalJSON(right);

export function createProject(options) {
  assertCreateOptions(options);
  return { schema_version: 1, project_id: options.projectId, runtime: options.runtime,
    repository_key: options.repositoryKey, created_at: options.createdAt, revision: 0,
    baseline_revision: 0, sources: [], items: [], plans: [], receipts: [] };
}

// This is an import anchor reader, not a Markdown rewriter. Ambiguous anchors fail closed.
function headings(content) {
  const result = []; let offset = 0; let fence = null;
  for (const line of content.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line.length) continue;
    const bare = line.replace(/\r?\n$/, '');
    const marker = bare.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length };
    } else {
      const heading = bare.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
      if (heading) {
        const title = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
        if (title) result.push({ title, level: heading[1].length, start: offset });
      }
    }
    offset += line.length;
  }
  return result;
}

function captureFor(state, sourceId, context, expectedPath, expectedHash) {
  const capture = context.capturedSources.find(entry => entry.source_id === sourceId);
  if (!capture) fail('SOURCE_CAPTURE_REQUIRED', 'A trusted source capture is required');
  if (capture.path !== expectedPath) fail('SOURCE_PATH_MISMATCH', 'The capture does not match its registered source path');
  if (sha256Text(capture.content) !== capture.sha256) fail('SOURCE_HASH_MISMATCH', 'Captured content does not match its digest');
  if (expectedHash && capture.sha256 !== expectedHash) fail('SOURCE_CHANGED', 'The source changed from the requested revision');
  return capture;
}

export function extractSourceAnchor(content, anchorId, sourcePath = 'document.md') {
  if (typeof content !== 'string' || typeof anchorId !== 'string') fail('INVALID_ANCHOR', 'Source content and anchor must be text');
  const entries = headings(content);
  if (anchorId === 'document') {
    if (!content.trim()) fail('EMPTY_SOURCE', 'An empty source cannot establish project intent');
    return { title: entries[0]?.title ?? sourcePath.split('/').pop(), text: content };
  }
  if (!anchorId.startsWith('heading:') || !anchorId.slice(8).trim()) fail('INVALID_ANCHOR', 'Unsupported source anchor');
  const matches = entries.filter(entry => entry.title === anchorId.slice(8));
  if (!matches.length) fail('ANCHOR_NOT_FOUND', 'The requested heading was not found');
  if (matches.length !== 1) fail('AMBIGUOUS_ANCHOR', 'The requested heading is not unique');
  const selected = matches[0];
  const next = entries.find(entry => entry.start > selected.start && entry.level <= selected.level);
  return { title: selected.title, text: content.slice(selected.start, next?.start ?? content.length) };
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
      registered_at: context.occurredAt };
    if (existing) state.sources[state.sources.indexOf(existing)] = replacement;
    else state.sources.push(replacement);
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
    const details = { kind: input.kind, title: source.title, text: source.text, state: input.state,
      strength: input.strength ?? (input.kind === 'principle' ? 'binding' : 'advisory'), related_item_ids: [...related] };
    const priorDetails = existing && Object.fromEntries(Object.keys(details).map(key => [key, existing[key]]));
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

export function applyProjectCommand(state, command, context) {
  assertProjectState(state); assertProjectCommand(command); assertProjectContext(context);
  if (command.project_id !== state.project_id) fail('FOREIGN_PROJECT', 'The command targets another project');
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
  const operations = { register_source: registerSource, record_baseline_items: recordItems,
    register_plan: registerPlan, link_native_run: linkRun };
  result.changed_ids = operations[command.operation](next, command.payload, context);
  next.revision += 1;
  result.revision = next.revision; result.baseline_revision = next.baseline_revision;
  next.receipts.push({ command: clone(command), sha256: commandHash, receipt: clone(result) });
  assertProjectState(next);
  return { state: next, receipt: result };
}
