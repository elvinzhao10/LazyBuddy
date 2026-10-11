// T16 nested execution presentation model — pure functions, no DOM, no scheduler
// authority, no persistence beyond the T02 observation route it calls below.
// Drill-down levels plan -> batch -> task CHANGE AGGREGATION: the plan level shows
// batches/gates with rolled-up obligations, the batch level shows worker tasks,
// verifier stages and joins individually, and the task level shows the actual
// attempts, steps and evidence production. The planned dependency DAG derives from
// the accepted T07 graph; the actual run timeline derives from recorded T09 attempt
// observations (see timeline-model.mjs). The two are rendered separately.
import { evaluateDependency, evaluateTaskGate, normalizeDependencyFacts } from '../../project/plans/readiness.mjs';
import { recordObservations } from '../../project/model.mjs';
import { parseAttemptObservations } from './timeline-model.mjs';

export class ExecutionModelError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExecutionModelError';
    this.code = code;
  }
}

export const EXECUTION_LEVELS = Object.freeze(['plan', 'batch', 'task']);

// The execution view's durable observation path: the first production caller of the
// T02 recordObservations route (G1 note N3). Native activity observations recorded by
// this route advance only the observation revision; they never append command
// receipts or grant verification authority.
export function recordExecutionObservations(state, records) {
  return recordObservations(state, records);
}

// Design-system chip states; `unverified` keeps the neutral verification semantics.
const CHIP_STATES = Object.freeze({
  neutral: 'neutral', active: 'active', verified: 'verified', attention: 'attention',
  failed: 'failed', stale: 'stale', unavailable: 'unavailable', unverified: 'neutral',
});
const chip = (state, label) => {
  if (!Object.hasOwn(CHIP_STATES, state)) throw new ExecutionModelError('UNKNOWN_CHIP_STATE', String(state));
  return { state: CHIP_STATES[state], label };
};

const asFacts = input => input?.latest instanceof Map && Array.isArray(input.list)
  ? input : normalizeDependencyFacts(input ?? []);

function requireGraph(set, planId) {
  const graph = set.graphFor(planId);
  if (!graph) throw new ExecutionModelError('UNKNOWN_PLAN', planId);
  return graph;
}

// A worker task's execution rollup from recorded attempts. A stale (dispatched but
// never terminal) attempt never makes the task running: only an observed
// executing/waiting attempt does.
function taskExecutionChip(attempts) {
  if (!attempts.length) return chip('unavailable', 'No attempt observed');
  const live = attempts.filter(attempt => attempt.state === 'executing' || attempt.state === 'waiting');
  if (live.length) return chip('active', `Running · ${live[live.length - 1].attemptId}`);
  const failed = attempts.filter(attempt => attempt.state === 'failed' || attempt.state === 'cancelled');
  const finished = attempts.filter(attempt => attempt.state === 'finished');
  if (finished.length) return chip('neutral', `Finished · ${finished.length} attempt${finished.length === 1 ? '' : 's'}`);
  if (failed.length) return chip('failed', `Failed · ${failed.length} attempt${failed.length === 1 ? '' : 's'}`);
  const blocked = attempts.filter(attempt => attempt.state === 'blocked');
  if (blocked.length === attempts.length) return chip('attention', 'Blocked at dispatch');
  return chip('stale', 'Interrupted · no terminal record');
}

// Verification rollup reusing the T07 dependency evaluator against the SAME accepted
// state, graph set and facts, so a stale criterion revision or an old plan revision
// can never render as confirmed here.
function verificationForTask(environment, planId, task) {
  const input = { id: `verification:${task.id}`, kind: 'depends-on-gate',
    condition: 'independent-verification-confirmed',
    outcome_id: null, gate_id: null, target: { type: 'task', plan_id: planId, task_id: task.id } };
  const outcome = evaluateDependency(input, environment);
  if (outcome.status === 'satisfied') return { chip: chip('verified', 'Verified at current revisions'), status: outcome.status };
  if (outcome.status.startsWith('stale')) return { chip: chip('stale', 'Stale verification'), status: outcome.status };
  return { chip: chip('unverified', 'Verification pending'), status: outcome.status };
}

function groupAttemptsByTask(attempts, graph) {
  const taskIds = new Set(graph.tasks.map(task => task.id));
  const grouped = new Map(graph.tasks.map(task => [task.id, []]));
  for (const attempt of attempts) {
    if (attempt.taskId != null && taskIds.has(attempt.taskId)) grouped.get(attempt.taskId).push(attempt);
  }
  return grouped;
}

function attemptSort(attempts) {
  return [...attempts].sort((left, right) => left.startMs - right.startMs || left.attemptId.localeCompare(right.attemptId));
}

function gateJoinSummary(gate) {
  if (!gate.inputs.length) return 'Join unconstrained';
  const branches = gate.inputs.map(input =>
    `${input.input_id}: ${input.status === 'satisfied' ? 'confirmed' : input.status.startsWith('stale') ? 'stale' : 'pending'}`);
  const mode = gate.join.mode === 'all' ? 'requires all branches' : `requires ${gate.join.mode} of its branches`;
  return `Join ${mode} · ${branches.join(' · ')}`;
}

function statusSentenceFor(planId, batches, gates, verificationByTask) {
  const blocked = gates.filter(gate => gate.status === 'blocked');
  const stale = [...verificationByTask.values()].filter(entry => entry.status.startsWith('stale'));
  const text = blocked.length
    ? `Delivery held: ${blocked.length} join gate${blocked.length === 1 ? '' : 's'} blocked on pending or stale verification.`
    : stale.length
      ? 'Delivery continuing; stale verification retained as history.'
      : 'Delivery proceeding; recorded attempts and verifier receipts agree.';
  const clauses = [];
  for (const gate of blocked) clauses.push({ text: `join ${gate.task_id} blocked`, ref: `join:${planId}:${gate.task_id}` });
  for (const [taskId, entry] of verificationByTask) {
    if (entry.status.startsWith('stale')) clauses.push({ text: `task ${taskId} verification stale`, ref: `check:${planId}:${taskId}` });
  }
  if (!clauses.length && batches.length) clauses.push({ text: `${batches[0].taskIds.length} task${batches[0].taskIds.length === 1 ? '' : 's'} in ${batches[0].id}`, ref: batches[0].id });
  return { text, clauses };
}

/**
 * Build one drill-down document for the accepted plan graph `planId`.
 * `batches` is the plan's presentation grouping ({ id, title, taskIds }): a visual
 * grouping only — it never gates anything (T07 keeps execution edges authoritative).
 * `observations` are recorded T09 observation records (parsed here); observations the
 * producer did not report stay typed-unavailable, never zero.
 */
export function executionDocument({ state, set, planId, facts: factsInput, observations, batches, level, focusId }) {
  if (!EXECUTION_LEVELS.includes(level)) throw new ExecutionModelError('UNKNOWN_LEVEL', String(level));
  const graph = requireGraph(set, planId);
  const facts = asFacts(factsInput);
  const environment = { state, set, facts };
  const { attempts, ignored } = parseAttemptObservations(observations ?? []);
  const attemptsByTask = groupAttemptsByTask(attempts, graph);
  const gates = graph.tasks.map(task => evaluateTaskGate(graph, task, environment));
  const gateByTask = new Map(gates.map(gate => [gate.task_id, gate]));
  const verificationByTask = new Map(graph.tasks.map(task => [task.id, verificationForTask(environment, planId, task)]));
  const batchList = Array.isArray(batches) && batches.length ? batches
    : [{ id: `batch:${planId}`, title: 'Batch — all tasks', taskIds: graph.tasks.map(task => task.id) }];
  for (const batch of batchList) {
    if (!batch.id || !Array.isArray(batch.taskIds)) throw new ExecutionModelError('BATCH_SHAPE', batch.id);
    for (const taskId of batch.taskIds) if (!graph.tasks.some(task => task.id === taskId)) {
      throw new ExecutionModelError('BATCH_UNKNOWN_TASK', `${batch.id}:${taskId}`);
    }
  }

  const title = `Execution — ${planId}`;
  const subtitle = 'Planned dependency DAG (drawn separately) · actual run timeline over recorded attempt observations';
  const base = { viewId: `${planId}:${level}${focusId ? `:${focusId}` : ''}`, docId: planId, title, subtitle, level };

  if (level === 'plan') {
    const nodes = [];
    const edges = [];
    for (const batch of batchList) {
      const batchAttempts = batch.taskIds.flatMap(taskId => attemptsByTask.get(taskId) ?? []);
      const finished = batchAttempts.filter(attempt => attempt.state === 'finished').length;
      const verification = batch.taskIds.map(taskId => verificationByTask.get(taskId));
      const pending = verification.filter(entry => entry.status === 'not-established' || entry.status === 'unknown-target').length;
      const stale = verification.filter(entry => entry.status.startsWith('stale')).length;
      const verificationChip = pending ? chip('attention', `${pending} verification pending`)
        : stale ? chip('stale', `${stale} verification stale`)
        : verification.every(entry => entry.status === 'satisfied') ? chip('verified', 'Verification confirmed')
        : chip('unverified', 'Verification pending');
      nodes.push({
        id: batch.id, kind: 'batch', title: batch.title,
        summary: `${batch.taskIds.length} worker task${batch.taskIds.length === 1 ? '' : 's'} · ${finished} finished attempt${finished === 1 ? '' : 's'} · ${batchAttempts.length} attempt${batchAttempts.length === 1 ? '' : 's'} recorded${ignored.length ? ` · ${ignored.length} unsupported observation${ignored.length === 1 ? '' : 's'} retained unrendered` : ''}`,
        execution: batchAttempts.length ? taskExecutionChip(batchAttempts) : chip('unavailable', 'No attempt observed'),
        verification: verificationChip,
        meta: `Batch · grouping only, never gates`, drill: batch.id,
      });
    }
    nodes.push({
      id: `gate:${planId}`, kind: 'gate',
      title: `Verification gate — ${planId} (collapsed: criterion obligations)`,
      summary: 'Collapsed gate keeps its blocking or stale checks visible.',
      execution: chip('neutral', 'Gate'), verification: chip('attention', 'See checks'),
      meta: 'Collapsed group', collapsed: true,
      children: graph.tasks.flatMap(task => task.criteria.map(criterion => {
        const entry = verificationByTask.get(task.id);
        const state = entry.status === 'satisfied' ? 'verified'
          : entry.status.startsWith('stale') ? 'stale' : 'attention';
        return {
          id: `check:${planId}:${task.id}:${criterion.id}`, kind: 'gate-check',
          title: `Check — ${task.id} · ${criterion.id}`,
          summary: `Required criterion at revision ${criterion.revision}.`,
          execution: chip('neutral', 'Recorded'),
          verification: chip(state, state === 'verified' ? `Verified · revision ${criterion.revision}` : state === 'stale' ? 'Stale verification' : 'Pending'),
          meta: 'Gate check',
        };
      })),
    });
    for (const batch of batchList) edges.push({ from: batch.id, to: `gate:${planId}`, kind: 'gate', label: 'gate consumes batch results' });
    return { ...base, focusId: null, nodes, edges,
      breadcrumbs: [{ level: 'plan', label: planId }],
      statusSentence: statusSentenceFor(planId, batchList, gates, verificationByTask),
      ignoredObservations: ignored, attemptCount: attempts.length };
  }

  if (level === 'batch') {
    const batch = batchList.find(entry => entry.id === focusId);
    if (!batch) throw new ExecutionModelError('UNKNOWN_BATCH', String(focusId));
    const taskIds = batch.taskIds;
    const nodes = [];
    const edges = [];
    for (const task of graph.tasks) {
      if (!taskIds.includes(task.id)) continue;
      if (task.dependencies.filter(input => input.target.type === 'task').length > 1) continue; // rendered as a join below
      const attempts = attemptSort(attemptsByTask.get(task.id) ?? []);
      const agents = [...new Set(attempts.map(attempt => attempt.agentId))];
      const gate = gateByTask.get(task.id);
      const blockedInputs = gate.status === 'blocked'
        ? gate.inputs.filter(input => input.status !== 'satisfied').map(input => `${input.input_id}:${input.status}`) : [];
      nodes.push({
        id: task.id, kind: 'task', title: task.title,
        summary: blockedInputs.length
          ? `Blocked: ${blockedInputs.join(', ')}.`
          : `Assignments: ${agents.length ? agents.join(', ') : 'unassigned'}. ${attempts.length} attempt${attempts.length === 1 ? '' : 's'} recorded.`,
        execution: taskExecutionChip(attempts), verification: verificationByTask.get(task.id).chip,
        meta: `Worker task · ${agents.length || 'no'} agent${agents.length === 1 ? '' : 's'}`, drill: task.id,
      });
    }
    // Verifier stages derive from recorded verifier-role attempts on this batch's
    // tasks: a distinct identity from the workers, with its own steps and receipts.
    const verifierAttempts = attemptSort(attempts.filter(attempt =>
      attempt.role === 'verifier' && attempt.taskId != null && taskIds.includes(attempt.taskId)));
    const verifiersByAgent = new Map();
    for (const attempt of verifierAttempts) {
      if (!verifiersByAgent.has(attempt.agentId)) verifiersByAgent.set(attempt.agentId, []);
      verifiersByAgent.get(attempt.agentId).push(attempt);
    }
    for (const [agentId, verifierList] of [...verifiersByAgent.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const verified = verifierList.some(attempt => attempt.state === 'finished');
      nodes.push({
        id: `verifier:${agentId}`, kind: 'verifier',
        title: `Verifier — ${agentId}`,
        summary: `Independent verifier on ${[...new Set(verifierList.map(attempt => attempt.taskId))].join(', ')}. Reported steps shown; unreported steps stay unknown. Verifier evidence is kept separate from worker artifacts.`,
        execution: chip(verified ? 'neutral' : 'active', verified ? 'Verifier finished' : 'Verifying'),
        verification: chip(verified ? 'verified' : 'attention', verified ? 'Verifier receipt recorded' : 'Verdict pending'),
        meta: `Verifier stage · ${verifierList.length} verifier attempt${verifierList.length === 1 ? '' : 's'}`,
        children: verifierList.map(attempt => ({
          id: `vstep:${attempt.attemptId}`, kind: 'step',
          title: `Verifier step — ${attempt.stepId ?? attempt.attemptId}`,
          summary: `argv digest ${attempt.argvSha256 ? `${attempt.argvSha256.slice(0, 16)}…` : 'unreported'} · session ${attempt.sessionId ?? 'unreported'}.`,
          execution: chip(attempt.state === 'finished' ? 'neutral' : attempt.state === 'stale' ? 'stale' : 'active',
            attempt.state === 'finished' ? 'Recorded' : attempt.state === 'stale' ? 'Stale' : 'Running'),
          verification: chip(attempt.state === 'finished' ? 'verified' : 'unverified',
            attempt.state === 'finished' ? 'Done' : 'Unknown'),
          meta: 'Verifier step',
        })),
      });
      for (const attempt of verifierList) {
        if (taskIds.includes(attempt.taskId)) {
          edges.push({ from: attempt.taskId, to: `verifier:${agentId}`, kind: 'gate', label: 'independent verification consumes the worker result' });
        }
      }
    }
    const isJoinTask = task => taskIds.includes(task.id)
      && task.dependencies.filter(input => input.target.type === 'task').length > 1 && task.join.mode !== 'any';
    for (const task of graph.tasks) {
      if (!taskIds.includes(task.id) || isJoinTask(task)) continue;
      for (const input of task.dependencies) {
        if (input.target.type !== 'task' || !taskIds.includes(input.target.task_id)) continue;
        const outcome = evaluateDependency(input, environment);
        edges.push({ from: input.target.task_id, to: task.id, kind: 'dependency',
          label: `${input.condition}: ${outcome.status === 'satisfied' ? 'confirmed' : outcome.status.startsWith('stale') ? 'stale' : 'pending'}` });
      }
    }
    for (const task of graph.tasks) {
      if (!isJoinTask(task)) continue;
      const gate = gateByTask.get(task.id);
      nodes.push({
        id: `join:${planId}:${task.id}`, kind: 'join', title: `Join — ${task.title}`,
        summary: gateJoinSummary(gate),
        execution: chip(gate.status === 'blocked' ? 'attention' : 'neutral', gate.status === 'blocked' ? 'Blocked' : 'Open'),
        verification: chip(gate.status === 'blocked' ? 'attention' : 'verified', gate.status === 'blocked' ? 'Waiting on a branch' : 'Branches confirmed'),
        meta: `Join · mode ${gate.join.mode}`,
      });
      for (const input of task.dependencies) {
        if (input.target.type !== 'task') continue;
        const outcome = evaluateDependency(input, environment);
        // A verified branch feeds the join from its verifier stage; an unverified
        // branch feeds it directly so the pending gate stays visible at the join.
        const branchVerifier = verifierAttempts.find(attempt => attempt.taskId === input.target.task_id);
        const from = branchVerifier ? `verifier:${branchVerifier.agentId}` : input.target.task_id;
        edges.push({ from, to: `join:${planId}:${task.id}`, kind: 'dependency',
          label: `join condition ${input.condition}: ${outcome.status === 'satisfied' ? 'confirmed' : outcome.status.startsWith('stale') ? 'stale' : 'pending'}` });
      }
    }
    return { ...base, focusId, nodes, edges,
      breadcrumbs: [{ level: 'plan', label: planId }, { level: 'batch', label: focusId }],
      statusSentence: statusSentenceFor(planId, [batch], gates, verificationByTask),
      ignoredObservations: ignored, attemptCount: attempts.length };
  }

  const task = graph.tasks.find(entry => entry.id === focusId);
  if (!task) throw new ExecutionModelError('UNKNOWN_TASK', String(focusId));
  const batch = batchList.find(entry => entry.taskIds.includes(task.id));
  const taskAttempts = attemptSort(attemptsByTask.get(task.id) ?? []);
  // Retry chains stay within one role: a verifier attempt is never a retry of a
  // worker attempt, so the repair loop only chains worker attempts to workers.
  const byRole = role => taskAttempts.filter(attempt => (attempt.role === 'verifier') === (role === 'verifier'));
  const nodes = [];
  const edges = [];
  taskAttempts.forEach((attempt) => {
    const sameRole = byRole(attempt.role);
    const roleIndex = sameRole.indexOf(attempt);
    const previous = roleIndex > 0 ? sameRole[roleIndex - 1] : null;
    const executionState = attempt.state === 'finished' ? 'neutral'
      : attempt.state === 'failed' || attempt.state === 'cancelled' ? 'failed'
      : attempt.state === 'stale' ? 'stale'
      : attempt.state === 'blocked' ? 'attention' : 'active';
    nodes.push({
      id: `attempt:${attempt.attemptId}`, kind: 'attempt',
      title: `Attempt ${roleIndex + 1} (${attempt.role}) — ${attempt.state}${attempt.resumesAttemptId ? ` (resumes ${attempt.resumesAttemptId})` : ''}`,
      summary: `Agent ${attempt.agentId} · session ${attempt.sessionId ?? 'unreported'} · ${attempt.durationBasis ?? 'unreported duration basis'}.`,
      execution: chip(executionState, attempt.state),
      verification: chip(attempt.role === 'verifier' && attempt.state === 'finished' ? 'verified' : 'unverified',
        attempt.role === 'verifier' ? 'Verifier receipt' : 'Unverified'),
      meta: `Attempt · role ${attempt.role}`,
      layoutAfter: previous ? `attempt:${previous.attemptId}` : null,
    });
    if (attempt.stepId) {
      nodes.push({
        id: attempt.stepId, kind: 'step',
        title: `Step — command #${attempt.commandIndex ?? '?'}`,
        summary: `argv digest ${attempt.argvSha256 ? `${attempt.argvSha256.slice(0, 16)}…` : 'unreported'} · waiting ${attempt.waiting ? attempt.waiting.basis : 'none reported'}.`,
        execution: chip(attempt.state === 'finished' ? 'neutral' : attempt.state === 'stale' ? 'stale' : 'active',
          attempt.state === 'finished' ? 'Finished' : attempt.state === 'stale' ? 'Stale' : 'Running'),
        verification: chip('unverified', 'Step receipt only'), meta: 'Attempt step',
      });
      edges.push({ from: `attempt:${attempt.attemptId}`, to: attempt.stepId, kind: 'dependency', label: 'attempt runs step' });
    }
    // Evidence identity stays separated: a worker attempt's manifests are never the
    // verifier's receipt, and an upstream prerequisite receipt never appears here.
    const manifest = attempt.delivery?.dispatch?.manifest ?? null;
    const evidenceRole = attempt.role === 'verifier' ? 'verifier receipt' : 'worker artifact evidence';
    nodes.push({
      id: `evidence:${attempt.role}:${attempt.attemptId}`, kind: 'evidence',
      title: `Evidence — ${evidenceRole} (${attempt.attemptId})`,
      summary: manifest ? `${manifest} · consumption ${attempt.delivery?.consumption?.status ?? 'unobserved'}` : 'Manifest unreported.',
      execution: chip(attempt.state === 'finished' ? 'neutral' : 'unavailable', attempt.state === 'finished' ? 'Recorded' : 'Pending'),
      verification: chip(attempt.role === 'verifier' ? 'verified' : 'unverified',
        attempt.role === 'verifier' ? 'Verifier-owned' : 'Worker-owned, unverified'),
      meta: `Evidence · ${attempt.role}-owned`,
    });
    edges.push({ from: `attempt:${attempt.attemptId}`, to: `evidence:${attempt.role}:${attempt.attemptId}`,
      kind: 'dependency', label: `${attempt.role} attempt produces its own evidence` });
    if (previous) {
      edges.push({ from: `attempt:${previous.attemptId}`, to: `attempt:${attempt.attemptId}`, kind: 'history',
        label: 'retry — new attempt on the time axis; the plan dependency DAG gains no cycle' });
    }
  });
  return { ...base, focusId, nodes, edges,
    breadcrumbs: [{ level: 'plan', label: planId }, ...(batch ? [{ level: 'batch', label: batch.id }] : []),
      { level: 'task', label: task.id }],
    statusSentence: { text: `${taskAttempts.length} attempt${taskAttempts.length === 1 ? '' : 's'} recorded for ${task.id}; retries are new attempts, the DAG is unchanged.`, clauses: taskAttempts.map(attempt => ({ text: `attempt ${attempt.attemptId} ${attempt.state}`, ref: `attempt:${attempt.attemptId}` })) },
    ignoredObservations: ignored, attemptCount: taskAttempts.length };
}

/** Which tasks of the plan have recorded attempts, for callers building timelines. */
export function tasksWithAttempts({ set, planId, observations }) {
  const graph = requireGraph(set, planId);
  const { attempts } = parseAttemptObservations(observations ?? []);
  const grouped = groupAttemptsByTask(attempts, graph);
  return graph.tasks.filter(task => grouped.get(task.id).length).map(task => task.id);
}
