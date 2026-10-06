import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, accountTime, usageWithSubsets } from '../usage-accounting.mjs';

test('spec §8.1 acceptance fixture: 30-minute window arithmetic', () => {
  const result = accountTime({
    window_start: '2026-10-06T12:00:00Z', window_end: '2026-10-06T12:30:00Z',
    intervals: [
      { agent_id: 'agent:A', role: 'worker', started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T12:10:00Z' },
      { agent_id: 'agent:B', role: 'worker', started_at: '2026-10-06T12:05:00Z', ended_at: '2026-10-06T12:15:00Z' },
      { agent_id: 'agent:C', role: 'worker', started_at: '2026-10-06T12:20:00Z', ended_at: '2026-10-06T12:25:00Z' },
    ],
  });
  assert.equal(result.elapsed_minutes, 30);
  assert.equal(result.observed_execution_wall_minutes, 20);
  assert.equal(result.recorded_agent_minutes, 25);
  assert.equal(result.peak_concurrency, 2);
  assert.equal(result.distinct_agents, 3);
});

test('subset token fixture: 100 incl. cached 40 + 50 incl. reasoning 20 totals 150, not 210', () => {
  const result = usageWithSubsets({ input_total: 100, cached_input: 40, output_total: 50, reasoning_output: 20 });
  assert.equal(result.total_tokens, 150);
  assert.match(result.subset_rule, /never added again/);
  assert.throws(() => usageWithSubsets({ input_total: 30, cached_input: 40, output_total: 50, reasoning_output: 20 }),
    error => error.code === 'INVALID_VALUE');
});

test('cumulative values 40, 100 and final 100 total 100', () => {
  const result = normalizeUsage([
    { id: 'r1-s1', request_id: 'req:1', kind: 'cumulative-snapshot', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: 40 } },
    { id: 'r1-s2', request_id: 'req:1', kind: 'cumulative-snapshot', observed_at: '2026-10-06T12:02:00Z', usage: { total_tokens: 100 } },
    { id: 'r1-final', request_id: 'req:1', kind: 'final-value', observed_at: '2026-10-06T12:03:00Z', usage: { total_tokens: 100 } },
    { id: 'r2-d1', request_id: 'req:2', kind: 'delta', observed_at: '2026-10-06T12:04:00Z', usage: { total_tokens: 0 } },
  ]);
  assert.equal(result.totals.total_tokens, 100);
  assert.equal(result.coverage.requests_with_usage, 2);
});

test('duplicate delivery is not a new request; parent aggregates are not summed with children', () => {
  const result = normalizeUsage([
    { id: 'a', request_id: 'req:1', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: 10 } },
    { id: 'b', request_id: 'req:1', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: { total_tokens: 10 } },
    { id: 'parent', request_id: 'req:rollup', kind: 'parent-aggregate', observed_at: '2026-10-06T12:05:00Z', usage: { total_tokens: 500 } },
  ]);
  assert.equal(result.totals.total_tokens, 20); // 10 + 10 summed as deltas of one request is still one request; parent excluded
  assert.deepEqual(result.parent_aggregate_requests_excluded, ['req:rollup']);
  // A literal duplicate record id is rejected outright.
  assert.throws(() => normalizeUsage([
    { id: 'a', request_id: 'req:1', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: {} },
    { id: 'a', request_id: 'req:1', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: {} },
  ]), error => error.code === 'DUPLICATE_ID');
});

test('failed and cancelled requests keep their reported usage; unknown stays null, zero is reported zero', () => {
  const result = normalizeUsage([
    { id: 'f1', request_id: 'req:failed', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', status: 'failed', usage: { total_tokens: 7 } },
    { id: 'c1', request_id: 'req:cancelled', kind: 'delta', observed_at: '2026-10-06T12:01:00Z', status: 'cancelled', usage: { total_tokens: 3 } },
    { id: 'u1', request_id: 'req:unknown-field', kind: 'delta', observed_at: '2026-10-06T12:02:00Z', usage: { reasoning_output: null } },
    { id: 'z1', request_id: 'req:zero', kind: 'delta', observed_at: '2026-10-06T12:03:00Z', usage: { total_tokens: 0 } },
  ]);
  assert.equal(result.totals.total_tokens, 10);
  assert.equal(result.totals.reasoning_output, null);
  assert.equal(result.requests.find(entry => entry.request_id === 'req:zero').usage.total_tokens, 0);
});

test('partial reporting coverage is precise and never implies token coverage', () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    id: `d${index}`, request_id: `req:${index}`, kind: 'delta',
    observed_at: `2026-10-06T12:0${index}:00Z`, usage: index < 7 ? { total_tokens: index + 1 } : {},
  }));
  const result = normalizeUsage(records);
  assert.equal(result.coverage.distinct_request_ids, 10);
  assert.equal(result.coverage.requests_with_usage, 7); // usage reported for 7 of 10 recorded requests
  assert.equal(result.totals.total_tokens, 28); // and the totals cover only those 7 — no invented allocation
});

test('session durations are labeled recorded-session-duration and never become agent time', () => {
  const result = accountTime({
    window_start: '2026-10-06T12:00:00Z', window_end: '2026-10-06T12:10:00Z',
    intervals: [{ agent_id: 'agent:A', role: 'verifier', started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T12:04:00Z' }],
    session_durations: [10, 5],
  });
  assert.equal(result.recorded_agent_minutes, 4);
  assert.equal(result.recorded_session_minutes, 15);
  assert.equal(result.session_duration_label, 'recorded-session-duration');
});

test('malformed records fail closed without partial totals', () => {
  assert.throws(() => normalizeUsage([{ id: 'x', request_id: 'r', kind: 'delta', observed_at: 'not-a-time', usage: {} }]),
    error => error.code === 'INVALID_VALUE');
  assert.throws(() => normalizeUsage([{ id: 'x', request_id: 'r', kind: 'mystery', observed_at: '2026-10-06T12:00:00Z', usage: {} }]),
    error => error.code === 'INVALID_VALUE');
  assert.throws(() => normalizeUsage([{ id: 'x', request_id: 'r', kind: 'delta', observed_at: '2026-10-06T12:00:00Z', usage: { tokens: -5 } }]),
    error => error.code === 'INVALID_VALUE');
  assert.throws(() => accountTime({ window_start: '2026-10-06T12:10:00Z', window_end: '2026-10-06T12:00:00Z', intervals: [] }),
    error => error.code === 'INVALID_VALUE');
  assert.throws(() => accountTime({ window_start: '2026-10-06T12:00:00Z', window_end: '2026-10-06T12:10:00Z',
    intervals: [{ agent_id: 'a', started_at: '2026-10-06T12:05:00Z', ended_at: '2026-10-06T12:01:00Z' }] }),
    error => error.code === 'INVALID_VALUE');
});
