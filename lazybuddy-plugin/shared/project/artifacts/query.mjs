import { ArtifactIndexError } from './paths.mjs';

// Deterministic query surface over a built artifact index. Ordering is stable
// (artifact identity) and every page reports total and status coverage, so no
// collection is ever silently truncated.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
export const STATUSES = Object.freeze(['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible']);

const byIdentity = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export function coverageOf(entries) {
  const byStatus = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const entry of entries) {
    if (!Object.hasOwn(byStatus, entry.status)) throw new ArtifactIndexError('INVALID_QUERY', 'An entry carries an unknown status');
    byStatus[entry.status] += 1;
  }
  return { total: entries.length, by_status: byStatus, truncation: 'none' };
}

export function paginate(entries, options = {}) {
  const page = options.page ?? 1;
  const pageSize = options.page_size ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1) throw new ArtifactIndexError('INVALID_QUERY', 'A page must be a positive integer');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ArtifactIndexError('INVALID_QUERY', `A page size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  const sorted = [...entries].sort(byIdentity);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    entries: sorted.slice((page - 1) * pageSize, page * pageSize),
    total, page, page_size: pageSize, page_count: pageCount,
    has_next: page < pageCount, truncated: false,
    coverage: coverageOf(sorted),
  };
}

function scoped(index, predicate) {
  const entries = (index?.entries ?? []).filter(predicate).sort(byIdentity);
  return { entries, total: entries.length, coverage: coverageOf(entries) };
}

export function artifactsForTask(index, taskId) {
  if (typeof taskId !== 'string' || !taskId.length) throw new ArtifactIndexError('INVALID_QUERY', 'A task identity is required');
  return scoped(index, entry => (entry.applicability.task_ids ?? []).includes(taskId));
}

export function artifactsForGate(index, gateName) {
  if (typeof gateName !== 'string' || !gateName.length) throw new ArtifactIndexError('INVALID_QUERY', 'A gate name is required');
  return scoped(index, entry => (entry.applicability.gate_names ?? []).includes(gateName));
}

export function artifactsForPlan(index, planId) {
  if (typeof planId !== 'string' || !planId.length) throw new ArtifactIndexError('INVALID_QUERY', 'A plan identity is required');
  return scoped(index, entry => (entry.applicability.plan_ids ?? []).includes(planId));
}

export function artifactsForFeature(index, featureId) {
  if (typeof featureId !== 'string' || !featureId.length) throw new ArtifactIndexError('INVALID_QUERY', 'A feature identity is required');
  return scoped(index, entry => (entry.applicability.feature_ids ?? []).includes(featureId));
}

export function artifactById(index, id) {
  const entry = (index?.entries ?? []).find(candidate => candidate.id === id);
  if (!entry) throw new ArtifactIndexError('ARTIFACT_UNKNOWN', 'The artifact identity is not in this index');
  return entry;
}
