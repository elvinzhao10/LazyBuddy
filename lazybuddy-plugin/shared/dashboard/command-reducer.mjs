import { parseContract, ContractError, stableJSON } from './contracts/parse.mjs';
import { adaptState } from './adapters/state.mjs';
import { projectSnapshot } from './projection.mjs';
import { reviewIsCurrent } from './ui/verification-history.mjs';
import { adaptRuntime } from './adapters/runtime.mjs';
import { digest } from './adapters/ledger.mjs';

const fail = code => { throw new ContractError(code); };
const find = (items, id, code) => items.find(item => item.id === id) ?? fail(code);
function archive(criterion) {
  criterion.history.push({ version: criterion.version, requirement: criterion.requirement, result_ids: [...criterion.result_ids], scenarios: structuredClone(criterion.scenarios) });
  criterion.version += 1;
  criterion.result_ids = [];
  criterion.verification = 'unverified';
}
function invalidate(state, taskId, criterionId) {
  const affected = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.tasks) if (!affected.has(task.id) && task.depends_on?.some(id => affected.has(id))) {
      affected.add(task.id); changed = true;
    }
  }
  for (const task of state.tasks) if (affected.has(task.id)) {
    for (const criterion of task.criteria ?? []) {
      if (criterion.id !== criterionId && (criterion.result_ids.length || criterion.verification !== 'unverified')) criterion.verification = 'stale';
    }
    if (task.evidence?.length) task.evidence_status = 'stale';
  }
}
function decisionChange(state, command) {
  const { operation, payload } = command;
  state.decisions ??= [];
  const replacement = structuredClone(payload.decision ?? payload.replacement);
  if (state.decisions.some(item => item.id === replacement.id)) fail('DUPLICATE_DECISION');
  if (replacement.scope.some(id => !state.tasks.some(task => task.id === id))) fail('UNKNOWN_DECISION_SCOPE');
  if (replacement.state !== 'proposed' || replacement.revision !== 0) fail('INVALID_DECISION_TRANSITION');
  if (operation === 'supersede_decision') {
    const prior = find(state.decisions, payload.decision_id, 'UNKNOWN_DECISION');
    if (prior.state === 'superseded' || replacement.supersedes !== prior.id) fail('INVALID_DECISION_TRANSITION');
    prior.state = 'superseded'; prior.revision += 1;
  } else if (replacement.supersedes !== null) fail('INVALID_DECISION_TRANSITION');
  state.decisions.push(replacement);
}
function apply(state, command, input) {
  const { operation, payload, target } = command;
  if (operation === 'compact_history') {
    if (target.id !== state.run_id) fail('INVALID_HISTORY_TARGET');
    return false;
  }
  if (operation.endsWith('queued_plan')) fail('QUEUE_AUTHORITY_REQUIRED');
  if (operation === 'propose_decision' || operation === 'supersede_decision') {
    if (target.id !== state.run_id) fail('INVALID_DECISION_TARGET');
    decisionChange(state, command); return false;
  }
  const task = find(state.tasks, target.id, 'UNKNOWN_TASK');
  task.criteria ??= []; task.depends_on ??= [];
  if (['request_review', 'resolve_review', 'consume_review'].includes(operation)) {
    state.reviews ??= [];
    if (operation === 'request_review') {
      if (state.reviews.some(review => review.id === payload.review_id)) fail('DUPLICATE_REVIEW');
      const criterion = find(task.criteria, payload.criterion_id, 'UNKNOWN_CRITERION');
      const review = { id: payload.review_id, task_id: task.id, criterion_id: criterion.id, action: payload.action,
        subject: payload.subject, state: 'pending', requested_by: input.actor, decided_by: null, rationale: null, consumed_by: null };
      if (!reviewIsCurrent(review, input, criterion)) fail('STALE_REVIEW_SUBJECT');
      state.reviews.push(review);
    } else {
      const review = find(state.reviews, payload.review_id, 'UNKNOWN_REVIEW');
      if (review.task_id !== task.id) fail('REVIEW_TASK_MISMATCH');
      const criterion = find(task.criteria, review.criterion_id, 'UNKNOWN_CRITERION');
      if (stableJSON(review.subject) !== stableJSON(payload.subject) || !reviewIsCurrent(review, input, criterion)) fail('STALE_REVIEW_SUBJECT');
      if (operation === 'resolve_review') {
        if (review.state !== 'pending') fail('REVIEW_ALREADY_DECIDED');
        review.state = payload.decision; review.rationale = payload.rationale; review.decided_by = input.actor;
      } else {
        if (review.state !== 'approved' || payload.action !== review.action) fail('REVIEW_NOT_APPROVED');
        review.state = 'consumed'; review.consumed_by = input.actor;
      }
    }
    return false;
  }
  let semantic = true;
  switch (operation) {
    case 'amend_task':
      semantic = payload.scope !== undefined && payload.scope !== task.scope;
      Object.assign(task, payload); break;
    case 'add_dependency':
      find(state.tasks, payload.prerequisite_id, 'UNKNOWN_DEPENDENCY');
      if (task.depends_on.includes(payload.prerequisite_id)) fail('DUPLICATE_DEPENDENCY');
      task.depends_on.push(payload.prerequisite_id); break;
    case 'remove_dependency':
      if (!task.depends_on.includes(payload.prerequisite_id)) fail('UNKNOWN_DEPENDENCY');
      task.depends_on = task.depends_on.filter(id => id !== payload.prerequisite_id); break;
    case 'add_criterion':
      if (state.tasks.some(item => item.criteria?.some(criterion => criterion.id === payload.criterion_id))) fail('DUPLICATE_CRITERION');
      task.criteria.push({ id: payload.criterion_id, task_id: task.id, version: 1,
        requirement: payload.requirement, applicability: payload.applicability,
        scenarios: payload.scenarios, verification: 'unverified', result_ids: [], history: [] }); break;
    case 'amend_criterion': {
      const criterion = find(task.criteria, payload.criterion_id, 'UNKNOWN_CRITERION');
      if (criterion.version !== payload.expected_version) fail('CRITERION_VERSION_CONFLICT');
      archive(criterion); criterion.requirement = payload.requirement; break;
    }
    case 'add_scenario': case 'amend_scenario': {
      const criterion = find(task.criteria, payload.criterion_id, 'UNKNOWN_CRITERION');
      const index = criterion.scenarios.findIndex(item => item.id === payload.scenario.id);
      if ((operation === 'add_scenario') === (index >= 0)) fail('SCENARIO_REFERENCE_CONFLICT');
      archive(criterion);
      if (index < 0) criterion.scenarios.push(payload.scenario);
      else criterion.scenarios[index] = payload.scenario;
      break;
    }
    case 'promote_failure': {
      const criterion = find(task.criteria, payload.criterion_id, 'UNKNOWN_CRITERION');
      if (criterion.version !== payload.expected_version) fail('CRITERION_VERSION_CONFLICT');
      const observed = projectSnapshot(input).tasks.find(item => item.id === task.id);
      const attempt = observed.attempts.find(item => item.id === payload.attempt_id && item.criterion_id === criterion.id);
      if (!attempt || attempt.execution !== 'failed' || attempt.criterion_version === null) fail('FAILED_ATTEMPT_REQUIRED');
      if (payload.scenario.origin) fail('REGRESSION_ORIGIN_IS_OBSERVED');
      if (criterion.scenarios.some(item => item.id === payload.scenario.id)) fail('DUPLICATE_SCENARIO');
      archive(criterion);
      criterion.scenarios.push({ ...payload.scenario, origin: { attempt_id: attempt.id, criterion_version: attempt.criterion_version,
        plan_revision: attempt.plan_revision, source_revision: attempt.source_revision } });
      break;
    }
    case 'attach_evidence': {
      find(task.criteria, payload.criterion_id, 'UNKNOWN_CRITERION');
      state.evidence_submissions ??= [];
      state.evidence_submissions.push({ command_id: command.command_id, task_id: task.id, ...payload });
      semantic = false; break;
    }
    default: fail('UNKNOWN_OPERATION');
  }
  for (const criterion of task.criteria) {
    if (new Set(criterion.scenarios.map(item => item.id)).size !== criterion.scenarios.length) fail('DUPLICATE_SCENARIO');
  }
  if (semantic) invalidate(state, task.id, ['amend_criterion', 'add_scenario', 'amend_scenario', 'promote_failure'].includes(operation) ? payload.criterion_id : null);
  adaptState(state, state.run_id);
  return semantic;
}
export function reduceCommand(input) {
  const command = parseContract('command', input.command);
  if (command.operation.endsWith('queued_plan')) fail('QUEUE_AUTHORITY_REQUIRED');
  const { state, revision, project_id: projectId, run_id: runId } = input;
  if (command.target.project_id !== projectId || command.target.run_id !== runId || state.run_id !== runId) fail('COMMAND_BINDING_MISMATCH');
  if (state.dashboard_project_id && state.dashboard_project_id !== projectId) fail('PROJECT_BINDING_MISMATCH');
  const canonical = stableJSON(command);
  const prior = (state.dashboard_commands ?? []).find(item => item.command.command_id === command.command_id);
  if (prior) {
    if (stableJSON(prior.command) !== canonical) fail('COMMAND_ID_COLLISION');
    return { result: prior.result, replay: true };
  }
  const result = { schema_version: 1, command_id: command.command_id, target: command.target,
    status: 'conflict', revision, plan_revision: state.plan_revision ?? 0, consumed_plan_revision: null, reason: 'STALE_REVISION' };
  if (command.expected_revision !== revision) return { result, replay: true };
  adaptState(state, runId);
  const historical = structuredClone(state);
  let compaction;
  if (command.operation === 'compact_history') {
    const sources = input.sources.filter(source => source.kind === 'runtime');
    if (sources.length !== 1) fail('RUNTIME_SOURCE_REQUIRED');
    const source = sources[0];
    if (digest(source.text) !== command.payload.source_sha256) fail('STALE_HISTORY_SOURCE');
    const ledger = adaptRuntime(source, runId);
    if (ledger.issues.length) fail('INCOMPLETE_HISTORY_SOURCE');
    const seen = new Map(); const lines = source.text.split('\n'); const retained = [];
    for (const [index, record] of ledger.records.entries()) {
      const old = seen.get(record.dedup_key);
      if (old && old !== record.identity) fail('EVENT_ID_COLLISION');
      if (!old) { seen.set(record.dedup_key, record.identity); retained.push(lines[index]); }
    }
    const text = retained.length ? `${retained.join('\n')}\n` : '';
    compaction = { source_id: source.id, before_sha256: digest(source.text), after_sha256: digest(text),
      text, before_events: ledger.records.length, after_events: retained.length };
    const generation = state.dashboard_ledger_generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) fail('INVALID_LEDGER_GENERATION');
    state.dashboard_ledger_generation = generation + 1;
  }
  const semantic = apply(state, command, input);
  state.dashboard_project_id = projectId;
  state.plan_revision = (state.plan_revision ?? 0) + (semantic ? 1 : 0);
  if (semantic) {
    const affected = new Set([command.target.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of state.tasks) if (!affected.has(task.id) && task.depends_on?.some(id => affected.has(id))) {
        affected.add(task.id); changed = true;
      }
    }
    const unaffected = state.tasks.filter(task => !affected.has(task.id)).flatMap(task => (task.criteria ?? []).map(criterion => ({ id: criterion.id, version: criterion.version })));
    state.dashboard_plan_transitions ??= [];
    state.dashboard_plan_transitions.push({ from_revision: historical.plan_revision ?? 0, to_revision: state.plan_revision,
      command_id: command.command_id, unaffected });
  }
  Object.assign(result, { status: 'pending_agent', revision: revision + 1, plan_revision: state.plan_revision, reason: null });
  state.dashboard_commands ??= []; state.acknowledgements ??= [];
  state.dashboard_commands.push({ command, actor: input.actor, result: structuredClone(result) });
  state.acknowledgements.push(structuredClone(result));
  parseContract('acknowledgement', result);
  return { state, historical, result, replay: false, semantic, ...(compaction ? { compaction } : {}) };
}
