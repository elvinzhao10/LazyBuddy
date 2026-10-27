import { button, element, statusChip } from './components.mjs';

const number = value => value === null || value === undefined ? '—' : value.toLocaleString();
const utc = value => value ? `${value.slice(5, 10)} ${value.slice(11, 16)} UTC` : 'Unreported';
const stateRole = value => value === 'verified' ? 'verified' : value === 'failed' ? 'failed'
  : value === 'running' ? 'active' : value === 'stale' ? 'stale' : 'neutral';

function table(headers, rows) {
  const wrapper = element('div', 'monitor-table'); wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', headers.join(', '));
  const node = element('table', ''); const head = element('thead'); const titles = element('tr');
  for (const title of headers) { const cell = element('th', '', title); cell.setAttribute('scope', 'col'); titles.append(cell); }
  head.append(titles); const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(element('td', '', String(value ?? '—'))); body.append(tr); }
  node.append(head, body); wrapper.append(node); return wrapper;
}

export function trendChart({ title, rows, unit, temporal = false, empty }) {
  const figure = element('figure', 'monitor-chart stack');
  figure.append(element('figcaption', '', title));
  const valid = rows.filter(row => row.value !== null && Number.isFinite(row.value));
  if (!valid.length) { figure.append(element('p', 'meta monitor-empty', empty ?? 'No measurements recorded.')); return figure; }
  const max = Math.max(1, ...valid.map(row => row.value));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 150'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}. Zero to ${number(max)} ${unit}. ${valid.length} recorded values; exact values below.`);
  const shape = (tag, attrs) => { const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); svg.append(node); return node; };
  for (const y of [20, 70, 120]) shape('line', { x1: 16, x2: 624, y1: y, y2: y, class: 'monitor-gridline' });
  const from = temporal ? Date.parse(rows[0].label) : 0;
  const range = temporal ? Math.max(1, Date.parse(rows.at(-1).label) - from) : Math.max(1, rows.length - 1);
  const x = (row, index) => 24 + (temporal ? Date.parse(row.label) - from : index) / range * 592;
  let segment = [];
  const flush = () => { if (segment.length > 1) shape('polyline', { points: segment.join(' '), class: 'monitor-line' }); segment = []; };
  for (const [index, row] of rows.entries()) {
    if (row.value === null) { flush(); continue; }
    const px = rows.length === 1 ? 320 : x(row, index); const py = 120 - row.value / max * 100;
    segment.push(`${px},${py}`);
    shape('circle', { cx: px, cy: py, r: 3, class: 'monitor-point' });
  }
  flush(); figure.append(element('p', 'meta monitor-scale', `0–${number(max)} ${unit}`), svg);
  const axis = element('div', 'monitor-axis meta');
  axis.append(element('span', '', temporal ? utc(rows[0].label) : rows[0].label),
    element('span', '', temporal ? utc(rows.at(-1).label) : rows.at(-1).label));
  const exact = element('details', 'monitor-values'); const exactSummary = element('summary', '', 'Exact values'); exactSummary.setAttribute('aria-label', `${title}: exact values`);
  exact.append(exactSummary,
    table([temporal ? 'UTC interval start' : 'Recorded run', unit], rows.map(row => [row.label, number(row.value)])));
  figure.append(axis, exact); return figure;
}

export function createRunMonitor({ telemetry, onNavigate, state = {} }) {
  const root = element('section', 'panel stack run-monitor'); root.dataset.testid = 'long-run-monitor';
  const monitor = telemetry?.monitor;
  const heading = element('div', 'monitor-heading');
  heading.append(element('h2', '', 'Run monitor'), element('span', 'meta', telemetry?.run_id ?? 'No bound run'));
  root.append(heading);
  const figures = element('div', 'monitor-figures');
  figures.append(element('span', '', `${number(telemetry?.usage?.total_tokens)} reported tokens`),
    button(`${number(telemetry?.problems_total)} problems`, () => onNavigate?.('execution')),
    element('span', 'meta', `${number(telemetry?.agent_attempts_total)} agent attempts`));
  root.append(figures);
  if (!monitor?.available) root.append(element('p', 'meta', 'Bind a run to see execution, verification and activity.'));
  else {
    const progress = monitor.progress; const strip = element('div', 'monitor-progress');
    for (const [label, value, total] of [['Tasks finished', progress.finished, progress.total], ['Required checks verified', progress.verified, progress.required]]) {
      const item = element('div', 'stack'); const bar = element('progress'); bar.max = Math.max(1, total); bar.value = value;
      bar.setAttribute('aria-label', label); item.append(element('span', '', `${label} · ${value}/${total}`), bar); strip.append(item);
    }
    root.append(strip);
    const distribution = element('div', 'monitor-states');
    for (const entry of monitor.task_states.filter(entry => entry.count)) distribution.append(statusChip({ state: stateRole(entry.state), label: `${entry.count} ${entry.state.replaceAll('_', ' ')}` }));
    if (progress.blocked) distribution.append(statusChip({ state: 'attention', label: `${progress.blocked} blocked` }));
    root.append(distribution);
    const chartControls = element('div', 'monitor-filters'); const windowLabel = element('label', 'cluster', 'Chart window'); const window = element('select');
    window.setAttribute('aria-label', 'Chart window');
    for (const [value, label] of [['all', 'All recorded intervals'], ['12', 'Latest 12 intervals'], ['6', 'Latest 6 intervals']]) {
      const option = element('option', '', label); option.value = value; window.append(option);
    }
    window.value = state.chartWindow ?? 'all'; windowLabel.append(window); chartControls.append(windowLabel);
    const charts = element('div', 'monitor-charts');
    function renderCharts() {
      state.chartWindow = window.value;
      const bins = window.value === 'all' ? monitor.bins : monitor.bins.slice(-Number(window.value));
      charts.replaceChildren(trendChart({ title: 'Recorded activity', temporal: true, unit: 'events / interval', rows: bins.map(bin => ({ label: bin.at, value: bin.events })) }),
        trendChart({ title: 'Reported token trend', temporal: true, unit: 'tokens / interval', rows: bins.map(bin => ({ label: bin.at, value: bin.tokens })), empty: 'Provider usage has not been recorded.' }));
    }
    window.addEventListener('change', renderCharts); renderCharts();
    root.append(chartControls, charts, element('p', 'meta', `Latest recorded event ${utc(monitor.latest_event_at)} · ${monitor.bins.length} recorded intervals. Tokens attributed to each request’s latest accounting record; gaps are unreported.`));
    if (monitor.tasks.length) {
      const tasks = element('details', 'monitor-tasks'); tasks.append(element('summary', '', `Step status · ${monitor.tasks.length} of ${monitor.tasks_total}`));
      for (const task of monitor.tasks) {
        const row = element('div', 'monitor-step');
        row.append(button(task.title ?? task.id, () => onNavigate?.('execution')), element('code', 'meta', task.id),
          statusChip({ state: stateRole(task.execution), label: task.execution }), statusChip({ state: stateRole(task.verification), label: `Checks ${task.verification}` }),
          element('span', 'meta', `${task.attempts} attempts${task.blocker ? ' · blocked' : ''}`));
        row.append(button('Step resources', () => { trace.open = true; search.value = task.id; kind.value = 'all'; renderTrace(); search.focus(); }));
        tasks.append(row);
      }
      root.append(tasks);
    }
  }
  const trace = element('details', 'monitor-trace'); trace.append(element('summary', '', `Resource trace · ${monitor?.trace_total ?? 0} recorded steps`));
  trace.querySelector('summary').setAttribute('aria-label', 'Resource trace');
  const toolbar = element('div', 'monitor-filters');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Tool, agent, step or profile';
  search.setAttribute('aria-label', 'Search resource trace'); search.value = state.traceSearch ?? '';
  const kind = element('select'); kind.setAttribute('aria-label', 'Resource type');
  for (const value of ['all', 'tool', 'mcp', 'agent', 'skill', 'hook', 'settings']) { const option = element('option', '', value === 'all' ? 'All resources' : value); option.value = value; kind.append(option); }
  kind.value = state.traceKind ?? 'all'; const traceRows = element('div');
  function renderTrace() {
    state.traceSearch = search.value; state.traceKind = kind.value;
    const rows = (monitor?.trace ?? []).filter(row => (kind.value === 'all' || row.kind === kind.value)
      && Object.values(row).join(' ').toLowerCase().includes(search.value.trim().toLowerCase()));
    traceRows.replaceChildren(element('p', 'meta', `${rows.length} matching · latest ${monitor?.trace.length ?? 0} of ${monitor?.trace_total ?? 0} records`));
    if (rows.length) traceRows.append(table(['Resource', 'Step / worker', 'Configuration', 'Result', 'UTC / ledger'], rows.map(row => [
      `${row.kind}: ${row.server ? `${row.server} / ` : ''}${row.name}`,
      [row.task_id, row.attempt_id, row.worker_id].filter(Boolean).join(' · ') || 'Unlinked',
      [row.model, row.settings_profile].filter(Boolean).join(' · ') || 'Unreported',
      `${row.status}${row.duration_ms === null ? '' : ` · ${row.duration_ms} ms`}`,
      `${utc(row.at)} · ${row.source_id ?? 'unreported'}:${row.line ?? '—'} / ${row.source_event_id ?? '—'}`
    ])));
    else traceRows.append(element('p', 'meta', 'No matching resource observations. Installed components are listed in Health.'));
  }
  search.addEventListener('input', renderTrace); kind.addEventListener('change', renderTrace); renderTrace();
  toolbar.append(search, kind); trace.append(toolbar, traceRows); root.append(trace);
  trace.append(element('p', 'meta', `${(monitor?.trace ?? []).filter(row => row.task_id).length}/${monitor?.trace.length ?? 0} shown resource events identify a task. Unlinked events cannot establish per-step configuration or tool use.`));
  const history = telemetry?.cost_history;
  const efficiency = element('details', 'monitor-efficiency'); efficiency.append(element('summary', '', 'Efficiency across retained runs'));
  efficiency.querySelector('summary').setAttribute('aria-label', 'Efficiency across retained runs');
  const scope = element('select'); scope.setAttribute('aria-label', 'Efficiency measurement scope');
  for (const [value, label] of [['execution', 'Execution runs'], ['fixture-validation', 'Fixture validation'], ['unclassified', 'Unclassified records']]) {
    const option = element('option', '', label); option.value = value; scope.append(option);
  }
  scope.value = state.costScope ?? 'execution'; const historyCharts = element('div', 'monitor-charts');
  function renderHistory() {
    state.costScope = scope.value;
    const rows = (history?.records ?? []).filter(row => row.measurement_scope === scope.value);
    historyCharts.replaceChildren();
    if (!rows.length) { historyCharts.append(element('p', 'meta', `No ${scope.value} cost outcomes available. ${history?.code ?? ''}`)); return; }
    for (const [key, title, unit, factor] of [['elapsed_ms', 'Run duration', 'minutes', 60000], ['tool_invocations', 'Tool calls', 'calls', 1], ['reruns', 'Reruns', 'reruns', 1], ['rework_count', 'Rework', 'reworks', 1]]) {
      historyCharts.append(trendChart({ title, unit, rows: rows.map(row => ({ label: row.run_id, value: Number((row[key] / factor).toFixed(2)) })) }));
    }
    historyCharts.append(table(['Run', 'Route', 'Tools', 'Agents', 'Evidence bytes', 'Reruns', 'Rework'], rows.map(row => [row.run_id, row.route, row.tool_invocations, row.agent_invocations, row.evidence_bytes, row.reruns, row.rework_count])));
  }
  scope.addEventListener('change', renderHistory); renderHistory();
  efficiency.append(scope, historyCharts, element('p', 'meta', `Retained run order · up to 20 records · ${history?.source ?? 'cost outcome store'}. Duration includes waiting. These measures do not establish quality or a causal efficiency improvement.`));
  root.append(efficiency); return root;
}
