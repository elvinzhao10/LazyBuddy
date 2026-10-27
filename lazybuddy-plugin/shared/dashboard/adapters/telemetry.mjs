import { normalizeUsage } from '../../project/usage-accounting.mjs';

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,159}$/.test(value)
  && !/^sk-[A-Za-z0-9_-]{20,}$/.test(value) ? value : null;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const tokens = values => Number.isSafeInteger(values.total_tokens) ? values.total_tokens
  : Number.isSafeInteger(values.input_tokens) && Number.isSafeInteger(values.output_tokens)
    && Number.isSafeInteger(values.input_tokens + values.output_tokens) ? values.input_tokens + values.output_tokens : null;

function monitor(run, usage, records) {
  const observations = run?.observations ?? [];
  const trace = [];
  for (const observation of observations) {
    const payload = observation.payload ?? {};
    const eventName = String(observation.event ?? '').replaceAll('_', '-');
    const explicit = payload.runtime_trace;
    const value = explicit && typeof explicit === 'object' ? explicit : payload;
    let kind = explicit?.kind;
    if (!kind && /tool-use/.test(eventName)) kind = value.server_name || /^mcp__/.test(value.tool_name ?? value.tool ?? '') ? 'mcp' : 'tool';
    if (!kind && /subagent-(start|stop)/.test(eventName)) kind = 'agent';
    if (!kind && /config-change|instructions-loaded/.test(eventName)) kind = 'settings';
    if (!kind && /^(stop-failure|context-compacted|pre-compact|session-start)$/.test(eventName)) kind = 'hook';
    if (!kind && observation.provenance?.kind === 'hook') kind = 'hook';
    if (!['tool', 'mcp', 'agent', 'skill', 'hook', 'settings'].includes(kind)) continue;
    trace.push({ kind, name: identifier(value.name ?? value.tool_name ?? value.tool ?? value.agent_type ?? value.agent_id ?? value.source) ?? identifier(observation.event) ?? 'unreported',
      task_id: identifier(value.task_id), attempt_id: identifier(value.attempt_id), worker_id: identifier(value.worker_id ?? value.agent_id),
      server: identifier(value.server_name), model: identifier(value.model), settings_profile: identifier(value.settings_profile),
      status: ['completed', 'failed', 'cancelled', 'started'].includes(value.status) ? value.status : /failure|denied/.test(observation.event) ? 'failed' : 'recorded',
      duration_ms: Number.isSafeInteger(value.duration_ms) && value.duration_ms >= 0 ? value.duration_ms : null,
      at: time(observation.provenance?.timestamp), event: identifier(observation.event),
      source_id: identifier(observation.provenance?.source_id), source_event_id: identifier(observation.provenance?.source_event_id),
      line: Number.isSafeInteger(observation.provenance?.line) ? observation.provenance.line : null });
  }
  const points = observations.map(entry => time(entry.provenance?.timestamp)).filter(Boolean).map(at => ({ at, events: 1, tokens: null }));
  const byRecord = new Map(records.map(record => [`${record.request_id}\u0000${record.id}`, record]));
  for (const request of usage?.requests ?? []) {
    const at = request.source_record_ids.map(id => time(byRecord.get(`${request.request_id}\u0000${id}`)?.observed_at)).filter(Boolean).sort().at(-1);
    if (at) points.push({ at, events: 0, tokens: tokens(request.usage) });
  }
  const sorted = points.sort((a, b) => a.at.localeCompare(b.at));
  const start = sorted.length ? Date.parse(sorted[0].at) : null;
  const end = sorted.length ? Date.parse(sorted.at(-1).at) : null;
  const bins = [];
  if (start !== null) {
    const step = Math.max(60000, Math.ceil((end - start + 1) / 24 / 60000) * 60000);
    for (let at = start; at <= end; at += step) bins.push({ at: new Date(at).toISOString(), events: 0, tokens: null });
    const overflowed = new Set();
    for (const point of sorted) {
      const bin = bins[Math.min(bins.length - 1, Math.floor((Date.parse(point.at) - start) / step))];
      bin.events += point.events;
      if (point.tokens !== null && !overflowed.has(bin)) {
        bin.tokens = (bin.tokens ?? 0) + point.tokens;
        if (!Number.isSafeInteger(bin.tokens)) { bin.tokens = null; overflowed.add(bin); }
      }
    }
  }
  const tasks = run?.tasks ?? [];
  const required = tasks.flatMap(task => task.criteria ?? []).filter(item => item.applicability === 'required');
  const completed = tasks.filter(task => task.execution === 'finished').length;
  return { available: Boolean(run), task_states: ['not_started', 'running', 'finished', 'failed', 'cancelled'].map(state => ({ state,
    count: tasks.filter(task => task.execution === state).length })),
    progress: { finished: completed, total: tasks.length, verified: required.filter(item => item.verification === 'verified').length,
      required: required.length, blocked: tasks.filter(task => task.blocker).length },
    bins, window: start === null ? null : { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    trace: trace.slice(-200).reverse(), trace_total: trace.length,
    latest_event_at: sorted.at(-1)?.at ?? null,
    tasks: tasks.slice(0, 200).map(task => ({ id: task.id, title: task.title, execution: task.execution, verification: task.verification,
      blocker: Boolean(task.blocker), attempts: task.attempts?.length ?? 0, evidence: (task.attempts ?? []).reduce((sum, attempt) => sum + (attempt.evidence?.length ?? 0), 0) })),
    tasks_total: tasks.length };
}

export async function attachCostHistory(telemetry, { runtime, readFile }) {
  const directories = { LazyBuddy: '.lazybuddy', LazyTrae: '.lazytrae', LazyQoder: '.lazyqoder', LazyZCode: '.lazyzcode', LazyKimi: '.lazykimi', LazyDeepSeek: '.lazydeepseek' };
  const directory = directories[runtime];
  if (!directory) return { ...telemetry, cost_history: { state: 'unavailable', code: 'RUNTIME_UNKNOWN', records: [] } };
  const source = `${directory}/state/telemetry/cost-outcomes.json`;
  try {
    const store = JSON.parse(String(await readFile(source, 1024 * 1024)));
    if (store.schema_version !== 'lazyseries.cost-outcome-store.v1' || !Array.isArray(store.completed) || store.completed.length > 20) throw new Error('INVALID_COST_STORE');
    const records = store.completed.map(record => {
      if (record.schema_version !== 'lazyseries.cost-outcome.v1' || !identifier(record.run_id)
        || !['direct', 'comprehensive'].includes(record.route)) throw new Error('INVALID_COST_RECORD');
      const result = { run_id: record.run_id, route: record.route,
        measurement_scope: ['execution', 'fixture-validation'].includes(record.measurement_scope) ? record.measurement_scope : 'unclassified' };
      for (const key of ['elapsed_ms', 'tool_invocations', 'agent_invocations', 'evidence_bytes', 'reruns', 'rework_count']) {
        if (!Number.isSafeInteger(record[key]) || record[key] < 0) throw new Error('INVALID_COST_RECORD');
        result[key] = record[key];
      }
      return result;
    });
    if (new Set(records.map(record => record.run_id)).size !== records.length) throw new Error('INVALID_COST_STORE');
    return { ...telemetry, cost_history: { state: 'observed', source, records } };
  } catch (error) {
    return { ...telemetry, cost_history: { state: 'unavailable', source,
      code: error.message?.startsWith('INVALID_COST') ? error.message : 'COST_HISTORY_UNREADABLE', records: [] } };
  }
}

export function runtimeTelemetry(project, run = null, runError = null) {
  const problems = [];
  const add = (id, title, detail, destination) => problems.push({ id, title, detail, destination });
  for (const issue of [...(project.issues ?? []), ...(run?.issues ?? [])]) {
    add(issue.code ?? issue.id ?? 'runtime-issue', issue.code ?? issue.id ?? 'Runtime issue', issue.detail ?? 'Inspect the recorded runtime issue.', 'execution');
  }
  for (const task of run?.tasks ?? []) {
    if (task.execution === 'failed' || task.verification === 'failed' || task.blocker) {
      add(task.id, task.title ?? task.id, `Execution ${task.execution}; verification ${task.verification}${task.blocker ? '; blocked' : ''}`, 'execution');
    }
  }
  for (const source of project.sources ?? []) if (['missing', 'changed', 'inaccessible'].includes(source.observation?.status)) {
    add(source.id, source.path, `Registered source ${source.observation.status}`, 'project');
  }
  if (runError) add('run-observation', 'Run observation unavailable', runError, 'execution');
  const attempts = (run?.tasks ?? []).flatMap(task => (task.attempts ?? []).map(attempt => ({ id: attempt.id,
    task_id: task.id, worker_id: attempt.worker_id, execution: attempt.execution, verification: attempt.verification,
    source_revision: attempt.source_revision, started_at: attempt.started_at, finished_at: attempt.finished_at })));
  const records = (run?.observations ?? []).flatMap(observation => observation.payload?.usage_record ? [observation.payload.usage_record] : []);
  let usage = null;
  if (records.length) {
    try { usage = normalizeUsage(records); }
    catch (error) { add('usage-records', 'Usage records could not be normalized', error.code ?? 'INVALID_USAGE_RECORDS', 'evidence'); }
  }
  let total = null; let complete = true;
  if (usage) {
    for (const request of usage.requests) {
      const values = request.usage;
      const value = Number.isSafeInteger(values.total_tokens) ? values.total_tokens
        : Number.isSafeInteger(values.input_tokens) && Number.isSafeInteger(values.output_tokens) ? values.input_tokens + values.output_tokens : null;
      if (value === null) complete = false;
      else total = (total ?? 0) + value;
    }
    if (total !== null && !Number.isSafeInteger(total)) { total = null; complete = false; }
  }
  return { schema: 'lazyseries/runtime-telemetry@1', project_id: project.project_id,
    project_revision: project.revision, run_id: run?.run_id ?? null, run_revision: run?.revision ?? null,
    monitor: monitor(run, usage, records),
    observed_at: new Date().toISOString(), usage: usage ? { ...usage, total_tokens: total,
      complete: complete && total !== null, scope: 'bound-run-reported-requests' } : null,
    agent_attempts: attempts.slice(0, 200), agent_attempts_total: attempts.length,
    usage_reports: (project.observations ?? []).filter(entry => entry.subject?.kind === 'usage').slice(0, 50).map(entry => ({ id: entry.id,
      text: entry.text.slice(0, 4000), truncated: entry.text.length > 4000, observed_at: entry.observed_at, reference: entry.provenance?.reference })),
    usage_reports_total: (project.observations ?? []).filter(entry => entry.subject?.kind === 'usage').length,
    tasks: run ? { total: run.tasks?.length ?? 0, running: (run.tasks ?? []).filter(task => task.execution === 'running').length,
      failed: (run.tasks ?? []).filter(task => task.execution === 'failed' || task.verification === 'failed').length } : null,
    problems: problems.slice(0, 200), problems_total: problems.length,
    coverage: 'Only the bound run and registered project observations are visible. Missing usage and host activity are not inferred.' };
}
