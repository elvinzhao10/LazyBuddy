import { timelineModel } from './timeline-model.mjs';

export class LiveExecutionModelError extends Error {
  constructor(code) { super(code); this.name = 'LiveExecutionModelError'; this.code = code; }
}

const executionState = Object.freeze({
  not_started: { state: 'neutral', label: 'Not started' },
  running: { state: 'active', label: 'Running' },
  finished: { state: 'neutral', label: 'Finished' },
  failed: { state: 'failed', label: 'Failed' },
  cancelled: { state: 'neutral', label: 'Cancelled' },
});
const verificationState = Object.freeze({
  unverified: { state: 'neutral', label: 'Unverified' },
  verifying: { state: 'active', label: 'Verifying' },
  verified: { state: 'verified', label: 'Verified' },
  failed: { state: 'failed', label: 'Failed' },
  stale: { state: 'stale', label: 'Stale' },
  unavailable: { state: 'unavailable', label: 'Unavailable' },
});
const timelineState = Object.freeze({ running: 'executing', finished: 'finished', failed: 'failed', cancelled: 'cancelled' });
const chip = (table, value, fallback) => structuredClone(table[value] ?? fallback);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

function timelineAttempt(task, attempt) {
  const startMs = timestamp(attempt.started_at);
  const endMs = timestamp(attempt.finished_at);
  if (startMs === null || typeof attempt.worker_id !== 'string' || !attempt.worker_id) return null;
  if (attempt.execution !== 'running' && endMs === null) return null;
  if (endMs !== null && endMs < startMs) return null;
  return {
    observationId: attempt.provenance?.source_event_id ?? attempt.id,
    observedAt: attempt.provenance?.timestamp ?? null,
    provenanceReference: attempt.provenance?.source_id ?? null,
    contentRevision: attempt.source_revision ?? null,
    agentId: attempt.worker_id,
    role: 'unreported',
    sessionId: null,
    sessionBasis: 'unreported',
    attemptId: attempt.id,
    taskId: task.id,
    criterionId: attempt.criterion_id ?? null,
    planRevision: attempt.plan_revision,
    resumesAttemptId: null,
    stepId: null,
    commandIndex: null,
    argvSha256: null,
    state: timelineState[attempt.execution] ?? 'blocked',
    liveness: attempt.execution === 'running' ? 'observed' : 'terminated',
    startMs,
    endMs: attempt.execution === 'running' ? null : endMs,
    endObserved: attempt.execution !== 'running',
    waiting: null,
    durationBasis: 'native attempt timestamps',
    liveConversationalAgent: false,
    delivery: null,
  };
}

function timelineFor(tasks, asOf) {
  const eligible = [];
  let omitted = 0;
  for (const task of tasks) for (const attempt of task.attempts ?? []) {
    const projected = timelineAttempt(task, attempt);
    if (projected) eligible.push(projected); else omitted += 1;
  }
  const latestRecorded = eligible.length ? Math.max(...eligible.flatMap(attempt => [attempt.startMs, attempt.endMs ?? attempt.startMs])) : Date.parse(asOf);
  const effectiveAsOf = eligible.some(attempt => attempt.endMs === null)
    ? asOf : new Date(latestRecorded).toISOString();
  const model = timelineModel(eligible, { asOf: effectiveAsOf });
  model.lanes = model.lanes.map(lane => ({ ...lane, label: `Reported worker · ${lane.agentId}` }));
  return { ...model, title: 'Recorded attempt timeline',
    description: 'Only native attempts with a reported worker identity and recorded timestamps appear on this shared time axis.',
    laneLabel: 'reported worker', durationLabel: 'native attempt timestamps', omitted };
}

function taskSummary(task) {
  const attempts = task.attempts?.length ?? 0;
  const criteria = task.criteria?.length ?? 0;
  return `${task.scope} · ${attempts} recorded attempt${attempts === 1 ? '' : 's'} · ${criteria} ${criteria === 1 ? 'criterion' : 'criteria'}`;
}

function runDocument(snapshot) {
  const ids = new Set(snapshot.tasks.map(task => task.id));
  const nodes = snapshot.tasks.map(task => ({
    id: task.id, kind: 'task', title: task.title, summary: taskSummary(task),
    execution: chip(executionState, task.execution, { state: 'unavailable', label: 'Execution unavailable' }),
    verification: chip(verificationState, task.verification, { state: 'unavailable', label: 'Verification unavailable' }),
    meta: `Native task · priority ${task.priority}${task.blocker ? ` · blocker: ${task.blocker}` : ''}`,
    drill: task.attempts?.length ? task.id : null,
  }));
  const edges = snapshot.tasks.flatMap(task => (task.depends_on ?? [])
    .filter(dependency => ids.has(dependency))
    .map(dependency => ({ from: dependency, to: task.id, kind: 'dependency', label: 'Recorded native task dependency' })));
  const attention = snapshot.tasks.filter(task => ['failed'].includes(task.execution)
    || ['failed', 'stale', 'unavailable'].includes(task.verification));
  const running = snapshot.tasks.filter(task => task.execution === 'running');
  return {
    viewId: `${snapshot.run_id}:run`, docId: snapshot.run_id,
    title: `Execution — run ${snapshot.run_id}`,
    subtitle: 'Recorded native task dependencies and attempt intervals for the authenticated bound run.',
    level: 'batch', focusId: snapshot.run_id, nodes, edges,
    breadcrumbs: [{ level: 'plan', label: snapshot.project_id }, { level: 'batch', label: snapshot.run_id }],
    statusSentence: { text: running.length
      ? `${running.length} task${running.length === 1 ? '' : 's'} observed running.`
      : attention.length ? `${attention.length} task${attention.length === 1 ? '' : 's'} needs attention.`
        : 'No running or failed task is present in this captured native snapshot.',
    clauses: [...running, ...attention].map(task => ({ text: task.id, ref: task.id })) },
    ignoredObservations: [], attemptCount: snapshot.tasks.reduce((total, task) => total + (task.attempts?.length ?? 0), 0),
    graphLabel: 'Run task dependency graph',
    graphDescription: 'Recorded task dependencies for this bound native run. No batch, step, or agent topology is inferred.',
    timelineLabel: 'Recorded attempts',
    timelineDescription: 'Only native attempts with recorded timestamps and worker identities appear.',
    laneLabel: 'Reported worker', durationLabel: 'native attempt timestamps',
    levelLabels: { plan: 'Project', batch: 'Run', task: 'Task' },
    inspectorSource: `Authenticated native run ${snapshot.run_id} at revision ${snapshot.revision}`,
  };
}

function taskDocument(snapshot, task) {
  const nodes = task.attempts.map(attempt => ({
    id: attempt.id, kind: 'attempt', title: `Attempt ${attempt.id}`,
    summary: `${attempt.worker_id ? `Worker ${attempt.worker_id}` : 'Worker identity not reported'} · criterion ${attempt.criterion_id ?? 'not reported'} · plan revision ${attempt.plan_revision}`,
    execution: chip(executionState, attempt.execution, { state: 'unavailable', label: 'Execution unavailable' }),
    verification: chip(verificationState, attempt.verification, { state: 'unavailable', label: 'Verification unavailable' }),
    meta: `Native attempt · ${attempt.evidence?.length ?? 0} evidence reference${attempt.evidence?.length === 1 ? '' : 's'} · source revision ${attempt.source_revision ?? 'not reported'}`,
    drill: null,
  }));
  return {
    viewId: `${snapshot.run_id}:task:${task.id}`, docId: snapshot.run_id,
    title: `Execution — task ${task.id}`, subtitle: task.title,
    level: 'task', focusId: task.id, nodes, edges: [],
    breadcrumbs: [{ level: 'plan', label: snapshot.project_id }, { level: 'batch', label: snapshot.run_id },
      { level: 'task', label: task.id }],
    statusSentence: { text: `${task.attempts.length} distinct native attempt${task.attempts.length === 1 ? '' : 's'} recorded. Retry relationships remain unavailable unless the native record declares them.`,
      clauses: task.attempts.map(attempt => ({ text: attempt.id, ref: attempt.id })) },
    ignoredObservations: [], attemptCount: task.attempts.length,
    graphLabel: 'Task attempt records',
    graphDescription: 'Distinct native attempt identities for this task. No retry edge is inferred from ordering alone.',
    timelineLabel: 'Recorded attempts',
    timelineDescription: 'Only native attempts with recorded timestamps and worker identities appear.',
    laneLabel: 'Reported worker', durationLabel: 'native attempt timestamps',
    levelLabels: { plan: 'Project', batch: 'Run', task: 'Task' },
    inspectorSource: `Authenticated native run ${snapshot.run_id}, task ${task.id}`,
  };
}

export function liveExecutionProjection(snapshot, { taskId = null, asOf = new Date().toISOString() } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.tasks)
    || typeof snapshot.run_id !== 'string' || !snapshot.run_id) throw new LiveExecutionModelError('INVALID_RUN_SNAPSHOT');
  const task = taskId === null ? null : snapshot.tasks.find(candidate => candidate.id === taskId);
  if (taskId !== null && !task) throw new LiveExecutionModelError('UNKNOWN_TASK');
  const tasks = task ? [task] : snapshot.tasks;
  return { document: task ? taskDocument(snapshot, task) : runDocument(snapshot), timeline: timelineFor(tasks, asOf) };
}
