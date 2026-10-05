import { ContractError, parseContract, stableJSON } from './contracts/parse.mjs';
import { adaptRuntime } from './adapters/runtime.mjs';
import { adaptHost } from './adapters/host.mjs';
import { digest } from './adapters/ledger.mjs';
import { adaptState, parseBinding, progress } from './adapters/state.mjs';
import { completionApplies } from './completion-proof.mjs';
import { compatiblePlanRevision } from './revision-compatibility.mjs';
export { parseContract, ContractError, stableJSON } from './contracts/parse.mjs';
const absent = { embedding: 'unobserved', chat_handoff: 'unobserved', wake: 'unobserved', observations: 'unobserved' };
function replay(input) {
  const records = []; const cursors = []; const issues = []; const seen = new Map();
  const sourceIds = new Set();
  for (const source of input.sources) {
    if (sourceIds.has(source.id)) throw new ContractError('DUPLICATE_SOURCE');
    sourceIds.add(source.id);
    let adapted;
    switch (source.kind) {
      case 'runtime': case 'legacy': adapted = adaptRuntime(source, input.run_id); break;
      case 'host': case 'hook': adapted = adaptHost(source); break;
      default: throw new ContractError('UNKNOWN_SOURCE_KIND');
    }
    cursors.push(adapted.cursor); issues.push(...adapted.issues);
    for (const record of adapted.records) {
      const prior = seen.get(record.dedup_key);
      if (prior && prior !== record.identity) throw new ContractError('EVENT_ID_COLLISION');
      if (!prior) { seen.set(record.dedup_key, record.identity); records.push(record); }
    }
  }
  return { records, cursors, issues };
}
function checkCursor(input, current, issues) {
  if (!input.previous_cursor) return;
  const previous = parseContract('cursor', input.previous_cursor);
  const issue = code => issues.push({ code, source_id: null, line: null });
  if (previous.project_id !== input.project_id || previous.run_id !== input.run_id) { issue('CURSOR_IDENTITY_MISMATCH'); return; }
  if (previous.queue_revision > current.queue_revision) issue('QUEUE_REVISION_REGRESSION');
  if (current.queue_revision > previous.queue_revision + 1) issue('QUEUE_REVISION_GAP');
  if (previous.queue_revision === current.queue_revision && previous.queue_sha256 !== current.queue_sha256) issue('QUEUE_CHANGED_WITHOUT_REVISION');
  if (previous.revision > current.revision) issue('REVISION_REGRESSION');
  if (current.revision > previous.revision + 1) issue('REVISION_GAP');
  if (previous.revision === current.revision && previous.state_sha256 !== current.state_sha256) issue('STATE_CHANGED_WITHOUT_REVISION');
  for (const old of previous.sources) {
    const source = input.sources.find(item => item.id === old.id);
    const next = current.sources.find(item => item.id === old.id);
    if (!source || next.generation !== old.generation || next.lines < old.lines) { issue('SOURCE_ROTATED'); continue; }
    const prefix = source.text.split('\n').slice(0, old.lines).map(line => `${line}\n`).join('');
    if (digest(prefix) !== old.sha256) issue('SOURCE_ROTATED');
  }
}
function applyAttempt(tasks, observation, binding) {
  const attempt = parseContract('attempt', { ...observation.payload, provenance: observation.provenance });
  const task = tasks.find(item => item.id === attempt.task_id);
  if (!task) throw new ContractError('ATTEMPT_TASK_UNKNOWN');
  if (attempt.parent_task_id && !tasks.some(item => item.id === attempt.parent_task_id)) throw new ContractError('ATTEMPT_PARENT_UNKNOWN');
  if (attempt.consumed_plan_revision !== null && attempt.consumed_plan_revision !== attempt.plan_revision) throw new ContractError('ATTEMPT_DISPATCH_REVISION_MISMATCH');
  const prior = task.attempts.findIndex(item => item.id === attempt.id);
  if (prior >= 0) {
    const old = task.attempts[prior];
    if (old.execution !== 'running' && old.execution !== 'not_started') throw new ContractError('TERMINAL_ATTEMPT_REWRITTEN');
    if (old.plan_revision !== attempt.plan_revision || old.criterion_id !== attempt.criterion_id || old.criterion_version !== attempt.criterion_version) throw new ContractError('ATTEMPT_IDENTITY_CHANGED');
    task.attempts.splice(prior, 1);
  }
  task.attempts.push(attempt);
  if (attempt.verification === 'verified') attempt.verification = 'unverified';
  if (attempt.execution === 'failed') attempt.verification = 'failed';
  if (attempt.execution === 'cancelled') attempt.verification = 'unverified';
  const criterion = task.criteria.find(item => item.id === attempt.criterion_id);
  if (attempt.criterion_id && !criterion) throw new ContractError('ATTEMPT_CRITERION_UNKNOWN');
  if (criterion) {
    if (!criterion.result_ids.includes(attempt.id)) criterion.result_ids.push(attempt.id);
    const stale = attempt.criterion_version !== criterion.version || (attempt.plan_revision !== binding.plan_revision && !compatiblePlanRevision(binding, attempt)) ||
      (binding.source_revision && attempt.source_revision !== binding.source_revision);
    criterion.verification = stale ? 'stale' : attempt.verification;
  }
}
function verification(task) {
  const required = task.criteria.filter(item => item.applicability === 'required');
  if (!required.length) return 'unverified';
  for (const status of ['failed', 'stale', 'verifying', 'unavailable', 'unverified']) {
    if (required.some(item => item.verification === status)) return status;
  }
  return 'verified';
}
export function projectSnapshot(input, completionProof) {
  parseBinding(input);
  const tasks = adaptState(input.state, input.run_id);
  const { records, cursors, issues } = replay(input);
  const cursor = parseContract('cursor', { schema_version: 1, project_id: input.project_id,
    run_id: input.run_id, revision: input.revision, state_sha256: digest(stableJSON(input.state)), queue_revision: input.queue_revision ?? 0,
    queue_sha256: digest(stableJSON(input.queue ?? [])), sources: cursors });
  checkCursor(input, cursor, issues);
  const decisions = (input.state.decisions ?? []).map(item => parseContract('decision', item));
  const acknowledgements = (input.state.acknowledgements ?? []).map(item => parseContract('acknowledgement', item));
  for (const observation of records) {
    if (observation.provenance.kind === 'runtime' || observation.provenance.kind === 'legacy') {
      if (observation.event === 'attempt_result') applyAttempt(tasks, observation, input);
    }
  }
  for (const task of tasks) {
    for (const criterion of task.criteria) {
      const currentAttempt = task.attempts.filter(attempt => attempt.criterion_id === criterion.id &&
        attempt.criterion_version === criterion.version && (attempt.plan_revision === input.plan_revision || compatiblePlanRevision(input, attempt)) &&
        (!input.source_revision || attempt.source_revision === input.source_revision)).at(-1);
      if (currentAttempt) criterion.verification = currentAttempt.verification;
      if (!issues.length && (!currentAttempt || currentAttempt.execution === 'finished') && completionApplies(completionProof, input, criterion) && task.execution === 'finished' && !['failed', 'unavailable', 'stale', 'verifying'].includes(criterion.verification)) criterion.verification = 'verified';
    }
    task.verification = verification(task); task.progress = progress(task.criteria);
  }
  const queue = (input.queue ?? []).map(item => parseContract('queued_plan', item));
  if (queue.some(item => item.project_id !== input.project_id)) throw new ContractError('QUEUE_PROJECT_MISMATCH');
  acknowledgements.push(...(input.queue_acknowledgements ?? []).map(item => parseContract('acknowledgement', item)));
  if (acknowledgements.some(item => item.target.project_id !== input.project_id || (item.target.run_id && item.target.run_id !== input.run_id))) throw new ContractError('ACK_IDENTITY_MISMATCH');
  return parseContract('snapshot', { schema_version: 1, project_id: input.project_id, run_id: input.run_id,
    revision: input.revision, plan_revision: input.plan_revision, queue_revision: input.queue_revision ?? 0,
    cursor, freshness: issues.length ? 'resync_required' : 'snapshot', capabilities: input.capabilities ?? absent,
    tasks, decisions, queue, acknowledgements, ...(input.queue_readiness ? { queue_readiness: input.queue_readiness } : {}),
    observations: records.map(({ event, payload, provenance }) => ({ event, payload, provenance })), issues });
}
