import { fail } from '../contract.mjs';
import { sha256Text } from '../history.mjs';
import { buildPatch, extractSourceAnchor, headingFingerprint, normalizeHeadingTitle, parseDocument,
  renderDocument, repairLineEndings, sectionsOf, skeletonDigest } from './markdown.mjs';

// Transactional editing of registered original Markdown. Edits splice only the
// targeted lines; anchors are stable identities that survive moves and renames
// while copies allocate fresh identities.
const clone = value => JSON.parse(JSON.stringify(value));
const ANCHOR_ID = /^sa:(\d{1,10})$/;

export function captureFor(state, sourceId, context, expectedPath, expectedHash) {
  const capture = context.capturedSources.find(entry => entry.source_id === sourceId);
  if (!capture) fail('SOURCE_CAPTURE_REQUIRED', 'A trusted source capture is required');
  if (capture.path !== expectedPath) fail('SOURCE_PATH_MISMATCH', 'The capture does not match its registered source path');
  if (sha256Text(capture.content) !== capture.sha256) fail('SOURCE_HASH_MISMATCH', 'Captured content does not match its digest');
  if (expectedHash && capture.sha256 !== expectedHash) fail('SOURCE_CHANGED', 'The source changed from the requested revision');
  return capture;
}

// Stable heading anchors: one record per unambiguous normalized heading title.
// Duplicate titles stay unassigned, so a copy or duplicate cannot inherit proof.
export function syncAnchors(seedRecords, allRecords, sourceId, content, assignedRevision) {
  const document = parseDocument(content);
  const counts = new Map();
  for (const heading of document.headings) {
    const fingerprint = headingFingerprint(heading.title);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  const records = seedRecords.map(clone);
  const byFingerprint = new Map(records.map(record => [record.fingerprint, record]));
  let highest = 0;
  for (const record of allRecords) {
    const match = ANCHOR_ID.exec(record.anchor_id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  for (const heading of document.headings) {
    const fingerprint = headingFingerprint(heading.title);
    if (counts.get(fingerprint) !== 1) continue;
    const existing = byFingerprint.get(fingerprint);
    if (existing) { existing.title = heading.title; existing.level = heading.level; continue; }
    highest += 1;
    const record = { anchor_id: `sa:${String(highest).padStart(6, '0')}`, source_id: sourceId,
      kind: 'heading', fingerprint, title: heading.title, level: heading.level,
      assigned_revision: assignedRevision };
    records.push(record); byFingerprint.set(fingerprint, record);
  }
  const live = document.headings.map(heading => {
    const fingerprint = headingFingerprint(heading.title);
    const record = counts.get(fingerprint) === 1 ? byFingerprint.get(fingerprint) : undefined;
    return { anchor_id: record ? record.anchor_id : null, ambiguous: counts.get(fingerprint) !== 1,
      title: heading.title, level: heading.level, line: heading.lineIndex, fingerprint };
  });
  const unresolved = records.filter(record => counts.get(record.fingerprint) !== 1)
    .map(record => record.anchor_id);
  return { records, live, unresolved };
}

function sourceRecordFor(state, sourceId) {
  const source = state.sources.find(entry => entry.id === sourceId);
  if (!source) fail('UNKNOWN_SOURCE', 'The operation targets an unregistered source');
  return source;
}

function anchorRecordsFor(state, sourceId) {
  return (state.source_anchors ?? []).filter(record => record.source_id === sourceId);
}

function resolveAnchor(view, registry, anchorId, allowDocument) {
  if (anchorId === 'document') {
    if (!allowDocument) fail('INVALID_ANCHOR', 'This edit requires a heading anchor');
    return { startLine: 0, endLine: view.lines.length };
  }
  const record = registry.find(entry => entry.anchor_id === anchorId);
  if (!record) fail('ANCHOR_NOT_FOUND', 'The edit targets an unknown document anchor');
  const matches = view.headings.filter(heading => headingFingerprint(heading.title) === record.fingerprint);
  if (!matches.length) fail('ANCHOR_NOT_FOUND', 'The anchored heading is no longer present');
  if (matches.length > 1) fail('AMBIGUOUS_ANCHOR', 'The anchored heading is no longer unique');
  const sections = sectionsOf(view);
  return sections[view.headings.indexOf(matches[0])];
}

// Applies the edit list to the captured content. Returns the patched content,
// the per-line origin map for patch rendering, and heading renames.
function applyEdits(content, edits, registry) {
  const work = parseDocument(content);
  const origin = work.lines.map((_, index) => index);
  const renames = [];
  for (const edit of edits) {
    const view = parseDocument(renderDocument(work));
    if (edit.kind === 'set_task_state' || edit.kind === 'set_task_text') {
      const section = resolveAnchor(view, registry, edit.anchor_id, true);
      const items = view.tasks.filter(task => task.lineIndex >= section.startLine && task.lineIndex < section.endLine);
      const task = items[edit.item];
      if (!task) fail('TASK_NOT_FOUND', 'The checklist item was not found in the targeted section');
      const box = edit.kind === 'set_task_state' ? (edit.state === 'checked' ? 'x' : ' ') : task.box;
      const text = edit.kind === 'set_task_text' ? edit.text : task.text;
      const rebuilt = `${task.indent}${task.marker}${task.gap}[${box}]${task.gapAfterBox}${text}`;
      if (rebuilt !== work.lines[task.lineIndex].text) {
        work.lines[task.lineIndex].text = rebuilt;
        origin[task.lineIndex] = null;
      }
    } else if (edit.kind === 'rename_heading') {
      const title = normalizeHeadingTitle(edit.title);
      if (!title) fail('INVALID_VALUE', 'A replacement heading title must not be empty');
      const section = resolveAnchor(view, registry, edit.anchor_id, false);
      const record = registry.find(entry => entry.anchor_id === edit.anchor_id);
      const fingerprint = headingFingerprint(title);
      if (registry.some(entry => entry !== record && entry.fingerprint === fingerprint) ||
          view.headings.some(heading => heading.lineIndex !== section.startLine && headingFingerprint(heading.title) === fingerprint)) {
        fail('AMBIGUOUS_ANCHOR', 'The replacement heading title collides with another heading');
      }
      const line = work.lines[section.startLine];
      const marker = line.text.match(/^( {0,3}#{1,6})([ \t]+)(.*)$/);
      if (!marker) fail('INVALID_ANCHOR', 'The anchored line is no longer a heading');
      renames.push({ from: record.fingerprint, to: title });
      record.fingerprint = fingerprint;
      record.title = title;
      line.text = `${marker[1]}${marker[2]}${title}`;
      origin[section.startLine] = null;
    } else if (edit.kind === 'move_section') {
      const section = resolveAnchor(view, registry, edit.anchor_id, false);
      let target;
      if (edit.before_anchor_id == null) target = work.lines.length;
      else target = resolveAnchor(view, registry, edit.before_anchor_id, false).startLine;
      if (target > section.startLine && target < section.endLine) {
        fail('INVALID_MOVE', 'A section cannot move inside its own subsections');
      }
      if (target !== section.startLine && target !== section.endLine) {
        const count = section.endLine - section.startLine;
        const lines = work.lines.splice(section.startLine, count);
        const origins = origin.splice(section.startLine, count);
        const insertion = target > section.startLine ? target - count : target;
        work.lines.splice(insertion, 0, ...lines);
        origin.splice(insertion, 0, ...origins);
      }
    }
  }
  repairLineEndings(work);
  return { content: renderDocument(work), origin, renames };
}

function rewrittenAnchor(anchor, renames) {
  if (!anchor.startsWith('heading:')) return anchor;
  const fingerprint = headingFingerprint(anchor.slice(8));
  const rename = renames.find(entry => entry.from === fingerprint);
  return rename ? `heading:${rename.to}` : anchor;
}

function affectedRecords(state, sourceId) {
  const source = state.sources.find(entry => entry.id === sourceId);
  const plans = state.plans.filter(plan => plan.source.source_id === sourceId)
    .map(plan => ({ plan_id: plan.id, anchor_id: plan.source.anchor_id, revision: plan.revision }));
  const criteria = state.items.filter(item => item.source.source_id === sourceId)
    .map(item => ({ item_id: item.id, anchor_id: item.source.anchor_id, revision: item.revision }));
  const criterionIds = new Set(criteria.map(entry => entry.item_id));
  const dependencies = state.plans
    .filter(plan => plan.baseline_refs.some(reference => criterionIds.has(reference.item_id)))
    .map(plan => ({ plan_id: plan.id,
      item_ids: plan.baseline_refs.filter(reference => criterionIds.has(reference.item_id))
        .map(reference => reference.item_id) }));
  const evidence = {
    observation_ids: (state.observations ?? []).filter(observation =>
      observation.subject.kind === 'source' && observation.subject.id === sourceId).map(observation => observation.id),
    artifact_ids: (state.artifacts ?? []).filter(artifact => source && artifact.path === source.path)
      .map(artifact => artifact.id) };
  return { sources: [sourceId], plans, criteria, dependencies, evidence };
}

// The core of source.edit: mutates the given (already cloned) state and returns
// the changed identities plus the file write the bridge must transact.
export function performSourceEdit(state, payload, context) {
  const source = sourceRecordFor(state, payload.source_id);
  if (payload.expected_source_revision !== source.revision) {
    fail('SOURCE_REVISION_CONFLICT', 'The source moved past the requested semantic revision');
  }
  const capture = captureFor(state, payload.source_id, context, source.path);
  if (capture.sha256 !== payload.expected_sha256 &&
      (typeof source.skeleton_sha256 !== 'string' || skeletonDigest(capture.content) !== source.skeleton_sha256)) {
    fail('SOURCE_CHANGED', 'The source changed materially from the requested revision');
  }
  const others = (state.source_anchors ?? []).filter(record => record.source_id !== payload.source_id);
  const seed = anchorRecordsFor(state, payload.source_id);
  const initial = syncAnchors(seed, state.source_anchors ?? [], payload.source_id, capture.content, state.revision + 1);
  const liveBefore = initial.live;
  const registry = initial.records;
  const { content, origin, renames } = applyEdits(capture.content, payload.edits, registry);

  const digest = sha256Text(content);
  const final = syncAnchors(registry, [...others, ...registry], payload.source_id, content, state.revision + 1);
  state.source_anchors = [...others, ...final.records];

  source.accepted_sha256 = digest;
  source.revision += 1;
  source.registered_at = context.occurredAt;
  source.skeleton_sha256 = skeletonDigest(content);

  const changedIds = [payload.source_id];
  let baselineBumped = false;
  for (const plan of state.plans.filter(entry => entry.source.source_id === payload.source_id)) {
    const priorAnchor = plan.source.anchor_id;
    const anchor = rewrittenAnchor(priorAnchor, renames);
    const extracted = extractSourceAnchor(content, anchor, source.path);
    plan.source = { ...plan.source, sha256: digest, anchor_id: anchor };
    if (priorAnchor !== anchor || plan.text !== extracted.text || plan.title !== extracted.title) {
      plan.text = extracted.text; plan.title = extracted.title;
      plan.revision += 1; plan.updated_at = context.occurredAt;
      changedIds.push(plan.id);
    }
  }
  for (const item of state.items.filter(entry => entry.source.source_id === payload.source_id)) {
    const priorAnchor = item.source.anchor_id;
    const anchor = rewrittenAnchor(priorAnchor, renames);
    const extracted = extractSourceAnchor(content, anchor, source.path);
    item.source = { ...item.source, sha256: digest, anchor_id: anchor };
    if (priorAnchor !== anchor || item.text !== extracted.text) {
      item.text = extracted.text;
      item.revision += 1; item.recorded_at = context.occurredAt;
      baselineBumped = true;
      changedIds.push(item.id);
    }
  }
  if (baselineBumped) state.baseline_revision += 1;
  const writes = content === capture.content ? [] : [{
    source_id: payload.source_id, path: source.path,
    from_sha256: capture.sha256, to_sha256: digest, content,
    patch_text: buildPatch(source.path, capture.content, content, origin) }];
  return { changed_ids: changedIds, writes, live_before: liveBefore, live_after: final.live,
    current_sha256: capture.sha256, next_sha256: digest };
}

export function sourceEditPreview(state, payload, context) {
  const working = clone(state);
  const outcome = performSourceEdit(working, payload, context);
  return { schema_version: 1, status: 'valid', operation: 'source.edit.preview', initialized: true,
    project_id: state.project_id, revision: state.revision, source_id: payload.source_id,
    authority: payload.authority, current_sha256: outcome.current_sha256,
    next_sha256: outcome.next_sha256, patch_text: outcome.writes[0]?.patch_text ?? '',
    edits: clone(payload.edits), changed_ids: outcome.changed_ids,
    affected: affectedRecords(state, payload.source_id),
    anchors: { before: outcome.live_before, after: outcome.live_after } };
}

function anchorMatches(anchor, entry) {
  if (anchor === 'document') return true;
  return anchor.startsWith('heading:') && headingFingerprint(anchor.slice(8)) === entry.fingerprint;
}

export function sourceMapResult(state, payload, context) {
  const source = sourceRecordFor(state, payload.source_id);
  const capture = captureFor(state, payload.source_id, context, source.path);
  const document = parseDocument(capture.content);
  const synced = syncAnchors(anchorRecordsFor(state, payload.source_id), state.source_anchors ?? [],
    payload.source_id, capture.content, state.revision + 1);
  const anchors = synced.live.map(entry => {
    const plans = state.plans.filter(plan => plan.source.source_id === payload.source_id
      && anchorMatches(plan.source.anchor_id, entry)).map(plan => plan.id);
    const items = state.items.filter(item => item.source.source_id === payload.source_id
      && anchorMatches(item.source.anchor_id, entry)).map(item => item.id);
    return { anchor_id: entry.anchor_id, ambiguous: entry.ambiguous, title: entry.title,
      level: entry.level, line: entry.line, byte_start: document.lines[entry.line].start,
      linked_plan_ids: plans, linked_item_ids: items };
  });
  return { schema_version: 1, status: 'ok', operation: 'source.map', initialized: true,
    project_id: state.project_id, revision: state.revision, source_id: payload.source_id,
    path: source.path, sha256: capture.sha256, accepted_sha256: source.accepted_sha256,
    observation: capture.sha256 === source.accepted_sha256 ? 'current' : 'changed',
    anchors, unresolved_anchor_ids: synced.unresolved };
}

// Adopting an external change is restricted to formatting-only differences:
// the skeleton digest proves every non-fence change was whitespace. Material
// external edits stay visible working changes until accepted through authority.
export function adoptSource(state, payload, context) {
  const source = sourceRecordFor(state, payload.source_id);
  const capture = captureFor(state, payload.source_id, context, source.path);
  if (capture.sha256 === source.accepted_sha256) return [];
  if (payload.expected_source_revision != null && payload.expected_source_revision !== source.revision) {
    fail('SOURCE_REVISION_CONFLICT', 'The source moved past the requested semantic revision');
  }
  if (typeof source.skeleton_sha256 !== 'string' || skeletonDigest(capture.content) !== source.skeleton_sha256) {
    fail('MATERIAL_EXTERNAL_EDIT', 'A material external change stays a visible working change');
  }
  source.accepted_sha256 = capture.sha256;
  source.revision += 1;
  source.registered_at = context.occurredAt;
  const changedIds = [payload.source_id];
  for (const plan of state.plans.filter(entry => entry.source.source_id === payload.source_id)) {
    const extracted = extractSourceAnchor(capture.content, plan.source.anchor_id, source.path);
    plan.source = { ...plan.source, sha256: capture.sha256 };
    if (plan.text !== extracted.text || plan.title !== extracted.title) {
      plan.text = extracted.text; plan.title = extracted.title;
      plan.updated_at = context.occurredAt;
      changedIds.push(plan.id);
    }
  }
  for (const item of state.items.filter(entry => entry.source.source_id === payload.source_id)) {
    const extracted = extractSourceAnchor(capture.content, item.source.anchor_id, source.path);
    item.source = { ...item.source, sha256: capture.sha256 };
    if (item.text !== extracted.text) {
      item.text = extracted.text;
      item.recorded_at = context.occurredAt;
      changedIds.push(item.id);
    }
  }
  return changedIds;
}
