// T19 evidence and research composition — a PURE read-only adapter that calls
// the T12 artifacts package (index/query/research; called, never forked) and
// adds the presentation fields T12 deliberately leaves out: per-status state
// sentences with digest provenance, the applicable-version line, the
// navigation scope index (task/gate/plan/feature/global), and the inert
// research display records (T12's researchPromotionView plus the finding's own
// captured text). Pagination, coverage and scope filtering stay T12's: every
// page object below is T12's paginate() output verbatim, so totals and
// truncation honesty have exactly one authority. No file access happens here —
// the index is built by T12's buildArtifactIndex before composition.
import {
  artifactsForFeature, artifactsForGate, artifactsForPlan, artifactsForTask, coverageOf,
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginate, STATUSES,
} from '../../project/artifacts/query.mjs';
import { assertResearchGrantsNothing, researchPromotionView } from '../../project/artifacts/research.mjs';

export class EvidenceViewError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EvidenceViewError';
    this.code = code;
  }
}

export const NAVIGATION_SCOPES = Object.freeze(['global', 'task', 'gate', 'plan', 'feature']);
const STATUS_SET = new Set(STATUSES);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const digestPrefix = value => (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? `${value.slice(0, 12)}…` : null);
const sortedIds = values => [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const STATE_SENTENCES = Object.freeze({
  available: status => `available — safe preview`,
  missing: status => `missing — file deleted from disk`,
  moved: status => `moved — relocated with matching digest`,
  redacted: status => `redacted — bytes differ from the registered digest`,
  unsupported: status => `unsupported — no safe preview for this artifact`,
  inaccessible: status => `inaccessible — read refused`,
});

// Digest provenance per state. Only T12-computed fields are read: moved_to and
// expected_sha256 come from the index, and 'moved' itself means T12 located the
// registered digest at the new path.
function provenanceOf(entry) {
  const expected = digestPrefix(entry.expected_sha256);
  if (entry.status === 'moved') {
    return `moved — registered digest ${expected} now verified at ${entry.moved_to}`;
  }
  if (entry.status === 'missing') {
    return `missing — registered digest ${expected ?? 'none'} not found on disk`;
  }
  if (entry.status === 'redacted') {
    return `redacted — current bytes no longer match registered digest ${expected}`;
  }
  if (entry.status === 'unsupported') {
    const cause = entry.preview?.reason === 'file_too_large' ? 'file exceeds the read limit' : 'no preview kind';
    return `unsupported preview (${cause}) · digest ${entry.sha256 ? `${digestPrefix(entry.sha256)}…` : 'none — never read'}`;
  }
  if (entry.status === 'inaccessible') {
    return `inaccessible — ${entry.preview?.reason ?? 'read refused'} · digest none — never read`;
  }
  const actual = digestPrefix(entry.sha256);
  if (!actual) return `digest none — not yet read`;
  return expected && expected !== actual
    ? `digest ${actual}… (differs from registered ${expected})`
    : `digest ${actual}…${expected ? ' — matches the registered digest' : ''}`;
}

// The revisions an artifact applies to, per its T12 registration and scan
// binding. Every clause names a recorded field; nothing is inferred.
function appliesTo(entry) {
  const applicability = entry.applicability ?? {};
  const parts = [];
  if (Number.isSafeInteger(applicability.project_revision)) parts.push(`project revision ${applicability.project_revision}`);
  if (boundedText(applicability.run_id)) {
    let clause = `run ${applicability.run_id}`;
    if (Number.isSafeInteger(applicability.run_revision)) clause += ` @ revision ${applicability.run_revision}`;
    if (Number.isSafeInteger(applicability.plan_revision)) clause += ` · plan revision ${applicability.plan_revision}`;
    parts.push(clause);
  }
  for (const planId of applicability.plan_ids ?? []) parts.push(`plan ${planId}`);
  for (const featureId of applicability.feature_ids ?? []) parts.push(`feature ${featureId}`);
  for (const taskId of applicability.task_ids ?? []) parts.push(`task ${taskId}`);
  for (const attemptId of applicability.attempt_ids ?? []) parts.push(`attempt ${attemptId}`);
  for (const criterion of applicability.criterion_versions ?? []) {
    parts.push(`criterion ${criterion.id} v${criterion.version}`);
  }
  for (const gateName of applicability.gate_names ?? []) parts.push(`gate ${gateName}`);
  for (const researchId of applicability.research_ids ?? []) parts.push(`research ${researchId}`);
  const content = entry.sha256 ? `content ${entry.sha256.slice(0, 12)}…` : 'content revision none — digest not read';
  return `applies to: ${parts.length ? parts.join(' · ') : 'no recorded applicability'} · ${content}`;
}

function slimEntry(entry) {
  return {
    id: entry.id, origins: [...(entry.origins ?? [])], type: entry.type, producer: entry.producer,
    path: entry.path, sha256: entry.sha256 ?? null, expected_sha256: entry.expected_sha256 ?? null,
    bytes: entry.bytes ?? null, created_at: entry.created_at ?? null, status: entry.status,
    moved_to: entry.moved_to ?? null, preview: { kind: entry.preview?.kind ?? null,
      available: Boolean(entry.preview?.available), reason: entry.preview?.reason ?? null },
    registered: entry.registered ? { id: entry.registered.id, type: entry.registered.type,
      producer: entry.registered.producer, path: entry.registered.path,
      sha256: entry.registered.sha256 ?? null } : null,
    applicability: {
      project_revision: entry.applicability?.project_revision ?? null,
      run_id: entry.applicability?.run_id ?? null, run_revision: entry.applicability?.run_revision ?? null,
      plan_revision: entry.applicability?.plan_revision ?? null,
      plan_ids: [...(entry.applicability?.plan_ids ?? [])],
      feature_ids: [...(entry.applicability?.feature_ids ?? [])],
      task_ids: [...(entry.applicability?.task_ids ?? [])],
      attempt_ids: [...(entry.applicability?.attempt_ids ?? [])],
      criterion_versions: (entry.applicability?.criterion_versions ?? []).map(version => ({ ...version })),
      gate_names: [...(entry.applicability?.gate_names ?? [])],
      observation_ids: [...(entry.applicability?.observation_ids ?? [])],
      research_ids: [...(entry.applicability?.research_ids ?? [])],
      content_revision: entry.applicability?.content_revision ?? null,
    },
    stateSentence: STATE_SENTENCES[entry.status](),
    provenance: provenanceOf(entry),
    appliesTo: appliesTo(entry),
  };
}

export function normalizeNavigation(input) {
  if (!plain(input) || typeof input.scope !== 'string' || !NAVIGATION_SCOPES.includes(input.scope)) {
    throw new EvidenceViewError('INVALID_NAVIGATION', 'A navigation names one scope: global, task, gate, plan or feature');
  }
  if (input.scope === 'global') return Object.freeze({ scope: 'global', id: null });
  if (!boundedText(input.id, 512)) {
    throw new EvidenceViewError('INVALID_NAVIGATION', `The ${input.scope} scope requires the record identity`);
  }
  return Object.freeze({ scope: input.scope, id: input.id });
}

export const scopeKeyOf = nav => {
  const normalized = normalizeNavigation(nav);
  return normalized.scope === 'global' ? 'global' : `${normalized.scope}:${normalized.id}`;
};

// Scope filtering is T12's own query surface, called with the slimmed entries
// (same identities, same applicability arrays), so filtered sets cannot drift
// from the package that owns them.
export function scopeEntries(fixture, nav) {
  if (!plain(fixture) || !Array.isArray(fixture.entries)) {
    throw new EvidenceViewError('INVALID_FIXTURE', 'scopeEntries composes an evidence fixture');
  }
  const normalized = normalizeNavigation(nav);
  const like = { entries: fixture.entries };
  const scoped = normalized.scope === 'global'
    ? { entries: fixture.entries, total: fixture.entries.length, coverage: coverageOf(fixture.entries) }
    : normalized.scope === 'task' ? artifactsForTask(like, normalized.id)
      : normalized.scope === 'gate' ? artifactsForGate(like, normalized.id)
        : normalized.scope === 'plan' ? artifactsForPlan(like, normalized.id)
          : artifactsForFeature(like, normalized.id);
  return { nav: normalized, key: scopeKeyOf(normalized), entries: scoped.entries,
    total: scoped.total, coverage: scoped.coverage };
}

// One honest page: T12's paginate() output plus the navigation it belongs to.
export function evidencePage(fixture, nav, page = 1, options = {}) {
  const scope = scopeEntries(fixture, nav);
  const pageSize = options.page_size ?? fixture.page_defaults?.page_size ?? DEFAULT_PAGE_SIZE;
  return { nav: scope.nav, scope_key: scope.key,
    ...paginate(scope.entries, { page, page_size: pageSize }) };
}

function researchDisplay(snapshot, promotionViews) {
  const recorded = new Map((snapshot?.research ?? []).map(finding => [finding.id, finding]));
  const rejectedSources = new Map((snapshot?.research ?? []).map(finding => [finding.id,
    finding.sources.filter(source => typeof source === 'string' && /^[a-z]+:\/\//i.test(source))]));
  return promotionViews.map(view => ({
    id: view.id, question: view.question, sources: [...(view.sources ?? [])],
    captured_at: view.captured_at, findings: recorded.get(view.id)?.findings ?? null,
    uncertainty: view.uncertainty, recommendation: view.recommendation,
    external_sources: rejectedSources.get(view.id) ?? [],
    promotion: view.promotion,
  }));
}

function validateRefusals(refusals) {
  if (!Array.isArray(refusals)) throw new EvidenceViewError('INVALID_FIXTURE', 'refusals must be an array');
  return refusals.map(refusal => {
    if (!plain(refusal) || !boundedText(refusal.path, 1024) || !boundedText(refusal.code, 128)) {
      throw new EvidenceViewError('INVALID_FIXTURE', 'A refusal records a bounded path and typed code');
    }
    return { path: refusal.path, code: refusal.code,
      detail: boundedText(refusal.detail, 2048) ? refusal.detail : null,
      registered: false };
  });
}

export function evidenceFixture({ index, snapshot, refusals = [] } = {}) {
  if (!plain(index) || !Array.isArray(index.entries)) {
    throw new EvidenceViewError('INVALID_FIXTURE', 'evidenceFixture composes a built T12 artifact index');
  }
  // Fail-closed authority assertion first: a research record that smuggles an
  // acceptance or verification field stops composition entirely (T12's own
  // typed error propagates).
  const authority = assertResearchGrantsNothing(snapshot);
  const promotionViews = researchPromotionView(snapshot);

  const slimmed = index.entries
    .filter(entry => plain(entry) && boundedText(entry.id, 512))
    .map(entry => {
      if (!STATUS_SET.has(entry.status)) {
        throw new EvidenceViewError('UNKNOWN_ARTIFACT_STATUS', String(entry.status));
      }
      return slimEntry(entry);
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const fixture = {
    viewId: 'evidence',
    docId: `evidence:${snapshot?.project_id ?? index.project_id ?? 'unknown'}`,
    title: 'Evidence and research',
    subtitle: 'Indexed artifacts with safe previews, honest pagination and distinct access states (read-only)',
    projectRevision: Number.isSafeInteger(snapshot?.revision) ? snapshot.revision : null,
    statuses: [...STATUSES],
    stateSentences: Object.fromEntries(STATUSES.map(status => [status, STATE_SENTENCES[status]()])),
    page_defaults: { page_size: DEFAULT_PAGE_SIZE, max_page_size: MAX_PAGE_SIZE },
    entries: slimmed,
    coverage: coverageOf(slimmed),
    total: slimmed.length,
    research: researchDisplay(snapshot, promotionViews),
    researchAuthority: { grants_verification: authority.grants_verification,
      accepts_requirement: authority.accepts_requirement,
      accepted_requirement_ids: [...authority.accepted_requirement_ids],
      accepted_requirement_ids_before_research: [...authority.accepted_requirement_ids] },
    refusals: validateRefusals(refusals),
    scan: { scanned_at: index.scan?.scanned_at ?? null, runs_indexed: index.scan?.runs_indexed ?? null,
      files_seen: index.scan?.files_seen ?? null, native_state_root: index.scan?.native_state_root ?? null,
      history_status: index.scan?.history_status ?? 'observed', history_reason: index.scan?.history_reason ?? null },
  };
  fixture.total = fixture.entries.length;

  // Navigation scope index: global plus every task/gate/plan/feature identity
  // the index actually bound, each with its T12-computed total.
  const identities = { task: new Set(), gate: new Set(), plan: new Set(), feature: new Set() };
  for (const entry of slimmed) {
    for (const taskId of entry.applicability.task_ids) identities.task.add(taskId);
    for (const gateName of entry.applicability.gate_names) identities.gate.add(gateName);
    for (const planId of entry.applicability.plan_ids) identities.plan.add(planId);
    for (const featureId of entry.applicability.feature_ids) identities.feature.add(featureId);
  }
  fixture.scopes = [{ nav: { scope: 'global', id: null }, key: 'global', label: 'global index',
    total: fixture.total, page_count: Math.max(1, Math.ceil(fixture.total / DEFAULT_PAGE_SIZE)) }];
  for (const scope of ['task', 'gate', 'plan', 'feature']) {
    for (const id of sortedIds([...identities[scope]])) {
      const scoped = scopeEntries(fixture, { scope, id });
      fixture.scopes.push({ nav: { scope, id }, key: scoped.key, label: `${scope} ${id}`,
        total: scoped.total, page_count: Math.max(1, Math.ceil(scoped.total / DEFAULT_PAGE_SIZE)) });
    }
  }

  // Precomputed honest pages per scope for fixture-only consumers (the browser
  // demo cannot import the Node-side T12 package; it replays these pages
  // verbatim instead of recomputing any total).
  fixture.scopePages = {};
  for (const scope of fixture.scopes) {
    const pages = [];
    for (let page = 1; page <= scope.page_count; page += 1) {
      const composed = evidencePage(fixture, scope.nav, page);
      pages.push({ page: composed.page, page_size: composed.page_size, total: composed.total,
        page_count: composed.page_count, has_next: composed.has_next, truncated: composed.truncated,
        coverage: composed.coverage, entries: composed.entries });
    }
    fixture.scopePages[scope.key] = { total: scope.total, page_count: scope.page_count, pages };
  }
  return fixture;
}
