import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiniDom } from './fixtures/mini-dom.mjs';
import { createRunMonitor, trendChart } from '../ui/run-monitor.mjs';
import { runtimeTelemetry } from '../adapters/telemetry.mjs';
const dom = createMiniDom(); globalThis.document = dom.document;
const project = { project_id: 'p', revision: 1, sources: [] };

test('unknown series render no invented line; exact chart rows and UTC labels remain inspectable', () => {
  const empty = trendChart({ title: 'Tokens', rows: [{ label: '2026-10-26T12:00:00Z', value: null }], unit: 'tokens', temporal: true });
  assert.equal(empty.querySelector('svg'), null);
  const chart = trendChart({ title: 'Tokens', rows: [{ label: '2026-10-26T12:00:00Z', value: 10 },
    { label: '2026-10-26T12:01:00Z', value: null }, { label: '2026-10-26T12:02:00Z', value: 20 }], unit: 'tokens', temporal: true });
  assert.equal(chart.querySelectorAll('polyline').length, 0, 'missing interval breaks the series');
  assert.equal(chart.querySelectorAll('circle').length, 2);
  assert.match(chart.textContent, /UTC/); assert.equal(chart.querySelectorAll('tbody tr').length, 3);
});

test('step resources narrows the exact trace; unknown configuration stays explicit and scope excludes fixture outcomes by default', () => {
  const telemetry = runtimeTelemetry(project, { run_id: 'run', tasks: [{ id: 'T1', title: 'Build', execution: 'running', verification: 'unverified', criteria: [] }],
    observations: [{ event: 'step', payload: { runtime_trace: { kind: 'mcp', name: 'lookup', task_id: 'T1' } } }] });
  telemetry.cost_history = { state: 'observed', records: [{ run_id: 'fixture-only', measurement_scope: 'fixture-validation', route: 'direct',
    elapsed_ms: 60, tool_invocations: 5, agent_invocations: 1, evidence_bytes: 9, reruns: 0, rework_count: 0 }] };
  const state = {}; const root = createRunMonitor({ telemetry, state }); document.body.append(root);
  assert.match(root.textContent, /No execution cost outcomes/);
  [...root.querySelectorAll('button')].find(button => button.textContent === 'Step resources').click();
  assert.equal(root.querySelector('input').value, 'T1');
  assert.equal(root.querySelector('.monitor-trace').open, true); assert.equal(state.traceSearch, 'T1');
  assert.match(root.querySelector('.monitor-trace').textContent, /Unreported/);
  const scope = [...root.querySelectorAll('select')].find(control => control.getAttribute('aria-label') === 'Efficiency measurement scope'); scope.value = 'fixture-validation'; scope.dispatchEvent({ type: 'change' });
  assert.match(root.querySelector('.monitor-efficiency').textContent, /fixture-only/);
  assert.equal(state.costScope, 'fixture-validation');
});
