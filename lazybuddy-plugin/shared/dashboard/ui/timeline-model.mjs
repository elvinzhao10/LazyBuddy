// T16 actual-run timeline model — pure functions, no DOM and no scheduler authority.
// Intervals come exclusively from recorded T09 producer-attempt activity observations
// (schema lazybuddy.producer-attempt-activity.v1). A dispatch without a terminal record
// keeps an OPEN interval and renders stale up to the as-of time — never running, never a
// fabricated terminal outcome. Retries are new attempt identities on the same agent lane;
// they never insert edges into the plan dependency DAG.
export const ACTIVITY_SCHEMA = 'lazybuddy.producer-attempt-activity.v1';

export class TimelineModelError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TimelineModelError';
    this.code = code;
  }
}

const isOpen = interval => interval.end == null || interval.endObserved === false;

function attemptFrom(record) {
  let payload;
  try { payload = JSON.parse(record.text); } catch { return null; }
  if (payload?.schema_version !== ACTIVITY_SCHEMA) return null;
  if (typeof payload.agent?.id !== 'string' || typeof payload.attempt?.id !== 'string') {
    throw new TimelineModelError('ATTEMPT_IDENTITY_REQUIRED', record.id);
  }
  const interval = payload.activity?.interval ?? {};
  const startMs = Date.parse(interval.start ?? '');
  if (!Number.isFinite(startMs)) throw new TimelineModelError('INTERVAL_START_REQUIRED', record.id);
  const endMs = interval.end == null ? null : Date.parse(interval.end);
  if (endMs != null && !Number.isFinite(endMs)) throw new TimelineModelError('INTERVAL_END_INVALID', record.id);
  if (endMs != null && endMs < startMs) throw new TimelineModelError('INTERVAL_END_BEFORE_START', record.id);
  // Honesty invariant carried from the producer: an attempt without a terminal record
  // is stale/unknown, never running and never terminally finished.
  if (payload.activity.state === 'stale' && !isOpen(interval)) {
    throw new TimelineModelError('STALE_ATTEMPT_NEEDS_OPEN_INTERVAL', record.id);
  }
  return {
    observationId: record.id, observedAt: record.observed_at ?? null,
    provenanceReference: record.provenance?.reference ?? null, contentRevision: record.content_revision ?? null,
    agentId: payload.agent.id, role: payload.role ?? 'unreported',
    sessionId: payload.session?.id ?? null, sessionBasis: payload.session?.basis ?? 'unreported',
    attemptId: payload.attempt.id, taskId: payload.attempt.task_id ?? null,
    criterionId: payload.attempt.criterion_id ?? null, planRevision: payload.attempt.plan_revision ?? null,
    resumesAttemptId: payload.attempt.resumes_attempt ?? null,
    stepId: payload.step?.id ?? null, commandIndex: payload.step?.command_index ?? null,
    argvSha256: payload.step?.argv_sha256 ?? null,
    state: payload.activity.state, liveness: payload.activity.liveness,
    startMs, endMs, endObserved: interval.end_observed === true,
    waiting: payload.activity.waiting ?? null,
    durationBasis: payload.activity.duration_basis ?? null,
    liveConversationalAgent: payload.activity.live_conversational_agent === true,
    delivery: payload.delivery ?? null,
  };
}

/** Parse recorded observations into attempt records. Non-activity observations are
 *  reported as ignored (typed, never silently reinterpreted), malformed activity
 *  payloads fail closed. */
export function parseAttemptObservations(observations) {
  if (!Array.isArray(observations)) throw new TimelineModelError('OBSERVATIONS_REQUIRED');
  const seen = new Set();
  const attempts = [];
  const ignored = [];
  for (const record of observations) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || typeof record.text !== 'string') {
      throw new TimelineModelError('OBSERVATION_SHAPE');
    }
    if (seen.has(record.id)) throw new TimelineModelError('DUPLICATE_OBSERVATION', record.id);
    seen.add(record.id);
    const attempt = attemptFrom(record);
    if (!attempt) { ignored.push({ id: record.id, reason: 'UNSUPPORTED_OBSERVATION' }); continue; }
    attempts.push(attempt);
  }
  return { attempts, ignored };
}

/** Shared-time-axis timeline: one lane per distinct agent, real concurrent intervals,
 *  measured overlaps, retry chains and peak concurrency. Deterministic for the same
 *  inputs. Open (not-yet-terminal) intervals extend to `asOf` for geometry only; their
 *  state stays the recorded stale/blocked/executing value. */
export function timelineModel(attempts, { asOf } = {}) {
  if (!Array.isArray(attempts)) throw new TimelineModelError('ATTEMPTS_REQUIRED');
  const asOfMs = Date.parse(asOf ?? '');
  if (!Number.isFinite(asOfMs)) throw new TimelineModelError('AS_OF_REQUIRED');
  for (const attempt of attempts) {
    if (attempt.state === 'stale' && attempt.endMs != null) {
      throw new TimelineModelError('STALE_ATTEMPT_NEEDS_OPEN_INTERVAL', attempt.attemptId);
    }
  }
  const ordered = [...attempts].sort((left, right) => left.startMs - right.startMs
    || left.agentId.localeCompare(right.agentId) || left.attemptId.localeCompare(right.attemptId));
  const laneOf = new Map();
  const lanes = [];
  for (const attempt of ordered) {
    if (!laneOf.has(attempt.agentId)) {
      laneOf.set(attempt.agentId, lanes.length);
      lanes.push({ agentId: attempt.agentId, role: attempt.role, lane: lanes.length, attemptIds: [] });
    }
    const lane = lanes[laneOf.get(attempt.agentId)];
    if (lane.role !== attempt.role) lane.role = 'mixed';
    lane.attemptIds.push(attempt.attemptId);
  }
  const intervals = ordered.map(attempt => {
    const open = attempt.endMs == null;
    return {
      attemptId: attempt.attemptId, observationId: attempt.observationId,
      agentId: attempt.agentId, lane: laneOf.get(attempt.agentId), role: attempt.role,
      taskId: attempt.taskId, state: attempt.state, liveness: attempt.liveness,
      startMs: attempt.startMs, endMs: attempt.endMs, open,
      renderedEndMs: open ? Math.max(asOfMs, attempt.startMs) : attempt.endMs,
      resumesAttemptId: attempt.resumesAttemptId, waiting: attempt.waiting,
    };
  });
  const byId = new Map(intervals.map(interval => [interval.attemptId, interval]));
  const start = intervals.length ? Math.min(...intervals.map(interval => interval.startMs)) : asOfMs;
  const end = intervals.length ? Math.max(...intervals.map(interval => interval.renderedEndMs), asOfMs) : asOfMs;
  const overlaps = [];
  for (let outer = 0; outer < intervals.length; outer += 1) {
    for (let inner = outer + 1; inner < intervals.length; inner += 1) {
      const left = intervals[outer]; const right = intervals[inner];
      const shared = Math.min(left.renderedEndMs, right.renderedEndMs) - Math.max(left.startMs, right.startMs);
      if (shared > 0) overlaps.push({ a: left.attemptId, b: right.attemptId, laneA: left.lane, laneB: right.lane, ms: shared });
    }
  }
  const retryChains = intervals
    .filter(interval => interval.resumesAttemptId && byId.has(interval.resumesAttemptId))
    .map(interval => ({ from: interval.resumesAttemptId, to: interval.attemptId, lane: interval.lane }))
    .sort((left, right) => left.to.localeCompare(right.to));
  let peakConcurrency = 0;
  for (const interval of intervals) {
    let concurrent = 0;
    for (const other of intervals) {
      if (Math.min(interval.renderedEndMs, other.renderedEndMs) > Math.max(interval.startMs, other.startMs)) concurrent += 1;
    }
    peakConcurrency = Math.max(peakConcurrency, concurrent);
  }
  return { asOfMs, lanes, intervals, extent: { startMs: start, endMs: end }, overlaps, retryChains, peakConcurrency };
}

/** Left/width percentages for interval bars on the shared axis (0–100). */
export function intervalGeometry(model) {
  const span = Math.max(1, model.extent.endMs - model.extent.startMs);
  return new Map(model.intervals.map(interval => [interval.attemptId, {
    leftPercent: ((interval.startMs - model.extent.startMs) / span) * 100,
    widthPercent: (Math.max(1, interval.renderedEndMs - interval.startMs) / span) * 100,
  }]));
}

/** Axis ticks over the extent: deterministic, labeled with UTC clock time. */
export function timelineAxis(model, { ticks = 4 } = {}) {
  if (!Number.isInteger(ticks) || ticks < 2) throw new TimelineModelError('TICKS_INVALID');
  const span = Math.max(1, model.extent.endMs - model.extent.startMs);
  const step = span / (ticks - 1);
  const points = [];
  for (let index = 0; index < ticks; index += 1) {
    const ms = model.extent.startMs + step * index;
    points.push({ ms, percent: (index / (ticks - 1)) * 100, label: new Date(ms).toISOString().slice(11, 19) });
  }
  return points;
}
