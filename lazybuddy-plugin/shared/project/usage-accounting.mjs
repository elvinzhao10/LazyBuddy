// Usage and time accounting (spec §8/§8.1). Every metric carries scope,
// filters, window, definition, unit, basis, source records, coverage, as-of
// and projection revision. Normalization happens at a declared accounting
// grain (physical provider invocation). Raw records are preserved with their
// kind; duplicate delivery is never a new request, parent aggregates and
// child records are never summed twice, and unknown values stay null — a
// reported zero is the only zero.
import { fail } from './contract.mjs';

const RECORD_KINDS = Object.freeze(['delta', 'cumulative-snapshot', 'final-value', 'parent-aggregate']);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTimestamp = value => typeof value === 'string' && TIMESTAMP.test(value) && Date.parse(value) !== Number.NaN;

function fields(value, allowed, path) {
  if (!plain(value)) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
  }
}

// One reported usage record at the declared grain. `kind` drives arithmetic:
// deltas sum within their window; cumulative snapshots keep the latest value
// per subject; final values replace; parent aggregates never add to children.
function usageRecord(record, path) {
  fields(record, ['id', 'request_id', 'kind', 'observed_at', 'subject', 'usage', 'status'], path);
  if (typeof record.id !== 'string' || !record.id.length) fail('INVALID_ID', `${path}.id is required`);
  if (typeof record.request_id !== 'string' || !record.request_id.length) fail('INVALID_VALUE', `${path}.request_id binds the record to its physical invocation`);
  if (!RECORD_KINDS.includes(record.kind)) fail('INVALID_VALUE', `${path}.kind must be a declared accounting kind`);
  if (!isTimestamp(record.observed_at)) fail('INVALID_VALUE', `${path}.observed_at must be a UTC timestamp`);
  if (record.subject !== undefined && typeof record.subject !== 'string') fail('INVALID_VALUE', `${path}.subject must be text or null`);
  if (record.status !== undefined && !['completed', 'failed', 'cancelled'].includes(record.status)) {
    fail('INVALID_VALUE', `${path}.status must be completed, failed or cancelled — failed and cancelled requests keep their reported usage`);
  }
  if (!plain(record.usage)) fail('INVALID_VALUE', `${path}.usage must be a plain object`);
  for (const [field, value] of Object.entries(record.usage)) {
    if (value === null) continue; // unknown is null; zero must be reported explicitly
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('INVALID_VALUE', `${path}.usage.${field} must be a nonnegative integer or null`);
    }
  }
  return { id: record.id, request_id: record.request_id, kind: record.kind,
    observed_at: record.observed_at, subject: record.subject ?? null, usage: { ...record.usage },
    status: record.status ?? 'completed' };
}

const INTERVAL_FIELDS = Object.freeze(['agent_id', 'role', 'started_at', 'ended_at']);

// One observed execution interval for one distinct agent. Session-boundary
// durations are labeled as such by the caller; nothing here infers liveness.
function intervalRecord(record, path) {
  fields(record, INTERVAL_FIELDS, path);
  if (typeof record.agent_id !== 'string' || !record.agent_id.length) fail('INVALID_ID', `${path}.agent_id is required`);
  if (record.role !== undefined && !['worker', 'verifier'].includes(record.role)) {
    fail('INVALID_VALUE', `${path}.role must be worker or verifier when reported`);
  }
  if (!isTimestamp(record.started_at) || !isTimestamp(record.ended_at)) {
    fail('INVALID_VALUE', `${path} needs UTC started_at and ended_at`);
  }
  if (Date.parse(record.ended_at) < Date.parse(record.started_at)) {
    fail('INVALID_VALUE', `${path}.ended_at precedes started_at`);
  }
  return { agent_id: record.agent_id, role: record.role ?? null,
    started_at: record.started_at, ended_at: record.ended_at };
}

function unionLength(intervals) {
  // Union of [start, end) intervals in ms.
  if (!intervals.length) return 0;
  const points = intervals.flatMap(item => [[Date.parse(item.started_at), 1], [Date.parse(item.ended_at), -1]])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let depth = 0; let total = 0; let openAt = 0;
  for (const [time, delta] of points) {
    if (depth > 0) total += time - openAt;
    depth += delta; openAt = time;
  }
  return total;
}

function toMinutes(milliseconds) {
  return Number((milliseconds / 60000).toFixed(6));
}

// Normalize raw usage records into per-request totals that never double count.
// Subset categories (cached inside input, reasoning inside output) stay
// subsets: 100 incl. cached 40 + 50 incl. reasoning 20 totals 150, not 210.
export function normalizeUsage(records, { window: usageWindow } = {}) {
  if (!Array.isArray(records) || records.length > 100000) fail('INVALID_VALUE', 'Usage records must be a bounded array');
  const normalized = records.map((record, index) => usageRecord(record, `records[${index}]`));
  const seen = new Set();
  for (const record of normalized) {
    const dedupeKey = `${record.request_id}\u0000${record.id}`;
    if (seen.has(dedupeKey)) fail('DUPLICATE_ID', 'A usage record identity was delivered twice');
    seen.add(dedupeKey);
  }
  if (usageWindow !== undefined) {
    if (!plain(usageWindow)) fail('INVALID_VALUE', 'A usage window must be a plain object');
    fields(usageWindow, ['start', 'end'], 'window');
    if (!isTimestamp(usageWindow.start) || !isTimestamp(usageWindow.end)) fail('INVALID_VALUE', 'A usage window needs UTC bounds');
  }
  const latestSnapshot = new Map();
  const finalValues = new Map();
  const kindPrecedence = { delta: 1, 'cumulative-snapshot': 2, 'final-value': 3 };
  const byAccountingTime = (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)
    || kindPrecedence[a.kind] - kindPrecedence[b.kind]
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const record of normalized) {
    if (record.kind === 'cumulative-snapshot') {
      const current = latestSnapshot.get(record.request_id);
      if (!current || byAccountingTime(record, current) > 0) latestSnapshot.set(record.request_id, record);
    } else if (record.kind === 'final-value') {
      const current = finalValues.get(record.request_id);
      if (!current || byAccountingTime(record, current) > 0) finalValues.set(record.request_id, record);
    }
  }
  const perRequest = new Map();
  const parentRequests = new Set();
  const applicable = new Map();
  for (const record of normalized) {
    if (record.kind === 'parent-aggregate') { parentRequests.add(record.request_id); continue; }
    if (record.kind === 'cumulative-snapshot' && latestSnapshot.get(record.request_id) !== record) continue;
    if (record.kind === 'final-value' && finalValues.get(record.request_id) !== record) continue;
    const list = applicable.get(record.request_id) ?? [];
    list.push(record); applicable.set(record.request_id, list);
  }
  for (const [requestId, list] of applicable) {
    list.sort(byAccountingTime);
    for (const record of list) {
      const current = perRequest.get(requestId);
      if (!current) perRequest.set(requestId, { usage: { ...record.usage }, sources: [record.id] });
      else if (record.kind === 'delta') {
        for (const [field, value] of Object.entries(record.usage)) {
          const base = current.usage[field] ?? 0;
          current.usage[field] = value === null ? current.usage[field] ?? null : base + value;
        }
        current.sources.push(record.id);
      } else {
        for (const [field, value] of Object.entries(record.usage)) current.usage[field] = value;
        current.sources.push(record.id);
      }
      if (record.kind === 'final-value') break; // the latest final replaces at its timestamp and ends accumulation
    }
  }
  for (const parent of parentRequests) perRequest.delete(parent);
  const fieldTotals = {};
  const requestTotals = [];
  for (const [requestId, entry] of [...perRequest.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    requestTotals.push({ request_id: requestId, usage: entry.usage, source_record_ids: entry.sources });
    for (const [field, value] of Object.entries(entry.usage)) {
      if (value === null) { fieldTotals[field] = null; continue; }
      if (fieldTotals[field] == null) fieldTotals[field] = 0;
      if (fieldTotals[field] !== null) fieldTotals[field] += value;
    }
  }
  const requestsReported = new Set(normalized.filter(record => record.kind !== 'parent-aggregate').map(record => record.request_id));
  const withReportedFields = new Set();
  for (const [requestId, entry] of perRequest) {
    if (Object.keys(entry.usage).length > 0) withReportedFields.add(requestId);
  }
  return { grain: 'physical-provider-invocation', requests: requestTotals, totals: fieldTotals,
    parent_aggregate_requests_excluded: [...parentRequests].sort(),
    window: usageWindow ?? null,
    coverage: { requests_with_usage: withReportedFields.size, distinct_request_ids: requestsReported.size } };
}

// The exact time-accounting arithmetic of spec §8.1 over one reporting window.
export function accountTime({ window_start, window_end, intervals, session_durations }) {
  if (!isTimestamp(window_start) || !isTimestamp(window_end)) fail('INVALID_VALUE', 'A reporting window needs UTC bounds');
  if (Date.parse(window_end) < Date.parse(window_start)) fail('INVALID_VALUE', 'The reporting window ends before it starts');
  if (intervals !== undefined && !Array.isArray(intervals)) fail('INVALID_VALUE', 'Intervals must be an array');
  const recorded = (intervals ?? []).map((record, index) => intervalRecord(record, `intervals[${index}]`));
  const elapsedMs = Date.parse(window_end) - Date.parse(window_start);
  const wallMs = unionLength(recorded);
  const perAgent = new Map();
  for (const interval of recorded) {
    const list = perAgent.get(interval.agent_id) ?? [];
    list.push(interval); perAgent.set(interval.agent_id, list);
  }
  let agentMs = 0;
  for (const list of perAgent.values()) agentMs += unionLength(list);
  let peak = 0; let depth = 0;
  const points = recorded.flatMap(item => [[Date.parse(item.started_at), 1], [Date.parse(item.ended_at), -1]])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  for (const [, delta] of points) { depth += delta; peak = Math.max(peak, depth); }
  const result = {
    window: { start: window_start, end: window_end },
    basis: { definition: 'end minus start includes waiting; wall is the union of observed execution intervals; agent time is the per-agent union summed', unit: 'minutes' },
    elapsed_minutes: toMinutes(elapsedMs),
    observed_execution_wall_minutes: toMinutes(wallMs),
    recorded_agent_minutes: toMinutes(agentMs),
    peak_concurrency: peak,
    distinct_agents: perAgent.size,
  };
  if (session_durations !== undefined) {
    if (!Array.isArray(session_durations)) fail('INVALID_VALUE', 'Session durations must be an array');
    let total = 0;
    for (const [index, value] of session_durations.entries()) {
      if (!Number.isFinite(value) || value < 0) fail('INVALID_VALUE', `session_durations[${index}] must be nonnegative minutes`);
      total += value;
    }
    result.recorded_session_minutes = Number(total.toFixed(6));
    result.session_duration_label = 'recorded-session-duration';
  }
  return result;
}

// Spec §8.1 subset arithmetic: declared subset categories never add to totals.
export function usageWithSubsets({ input_total, cached_input, output_total, reasoning_output }) {
  for (const [name, value] of Object.entries({ input_total, cached_input, output_total, reasoning_output })) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      fail('INVALID_VALUE', `${name} must be a nonnegative integer or null`);
    }
  }
  if (cached_input !== null && input_total !== null && cached_input > input_total) {
    fail('INVALID_VALUE', 'cached_input is a subset of input_total and cannot exceed it');
  }
  if (reasoning_output !== null && output_total !== null && reasoning_output > output_total) {
    fail('INVALID_VALUE', 'reasoning_output is a subset of output_total and cannot exceed it');
  }
  const total = (input_total ?? 0) + (output_total ?? 0);
  return { input_total, cached_input, output_total, reasoning_output,
    total_tokens: input_total === null || output_total === null ? null : total,
    subset_rule: 'input and output totals already include their declared subsets; they are never added again' };
}
