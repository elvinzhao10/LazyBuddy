import { ContractError, parseContract, stableJSON } from './contracts/parse.mjs';
import { adaptRuntime } from './adapters/runtime.mjs';
import { adaptHost } from './adapters/host.mjs';
import { digest } from './adapters/ledger.mjs';
import { adaptState, parseBinding, progress } from './adapters/state.mjs';
import { reviewIsCurrent } from './ui/verification-history.mjs';
export { parseContract, ContractError, stableJSON } from './contracts/parse.mjs';
const absent = { embedding: 'unobserved', chat_handoff: 'unobserved', wake: 'unobserved', observations: 'unobserved' };
function replay(input, cache) {
  const records = []; const cursors = []; const issues = []; const seen = new Map();
  const sourceIds = new Set();
  for (const source of input.sources) {
    if (sourceIds.has(source.id)) throw new ContractError('DUPLICATE_SOURCE');
    sourceIds.add(source.id);
    const key = stableJSON([input.run_id, source.id, source.kind, source.generation, source.text]);
    let adapted = cache.get(source.id);
    if (!adapted || adapted.key !== key) {
      let result;
      switch (source.kind) {
        case 'runtime': case 'legacy': result = adaptRuntime(source, input.run_id); break;
        case 'host': case 'hook': result = adaptHost(source); break;
        default: throw new ContractError('UNKNOWN_SOURCE_KIND');
      }
      adapted = { key, result }; cache.set(source.id, adapted);
    }
    cursors.push(adapted.result.cursor); issues.push(...adapted.result.issues);
    for (const record of adapted.result.records) {
      const prior = seen.get(record.dedup_key);
      if (prior && prior !== record.identity) throw new ContractError('EVENT_ID_COLLISION');
      if (!prior) { seen.set(record.dedup_key, record.identity); records.push(record); }
    }
  }
  for (const id of cache.keys()) if (!sourceIds.has(id)) cache.delete(id);
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
function applyAttempt(index, observation, binding, compatiblePlanRevision) {
  let parsed = index.parsedAttempts.get(observation);
  if (!parsed) {
    parsed = parseContract('attempt', { ...observation.payload, provenance: observation.provenance });
    index.parsedAttempts.set(observation, parsed);
  }
  const attempt = structuredClone(parsed);
  const task = index.tasks.get(attempt.task_id);
  if (!task) throw new ContractError('ATTEMPT_TASK_UNKNOWN');
  if (attempt.parent_task_id && !index.tasks.has(attempt.parent_task_id)) throw new ContractError('ATTEMPT_PARENT_UNKNOWN');
  if (attempt.consumed_plan_revision !== null && attempt.consumed_plan_revision !== attempt.plan_revision) throw new ContractError('ATTEMPT_DISPATCH_REVISION_MISMATCH');
  const attempts = index.attempts.get(task.id);
  const old = attempts.get(attempt.id);
  if (old) {
    if (old.execution !== 'running' && old.execution !== 'not_started') throw new ContractError('TERMINAL_ATTEMPT_REWRITTEN');
    if (old.plan_revision !== attempt.plan_revision || old.criterion_id !== attempt.criterion_id || old.criterion_version !== attempt.criterion_version) throw new ContractError('ATTEMPT_IDENTITY_CHANGED');
    attempts.delete(attempt.id);
  }
  attempts.set(attempt.id, attempt);
  if (attempt.verification === 'verified') attempt.verification = 'unverified';
  if (attempt.execution === 'failed') attempt.verification = 'failed';
  if (attempt.execution === 'cancelled') attempt.verification = 'unverified';
  const criterion = index.criteria.get(attempt.criterion_id);
  if (criterion && criterion.task_id !== task.id) throw new ContractError('ATTEMPT_CRITERION_UNKNOWN');
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
export function createProjector({ completionApplies = () => false, compatiblePlanRevision = () => false } = {}) {
const ledgerCache = new Map();
const parsedAttempts = new WeakMap();
let stateCache = null;
return function projectSnapshot(input, completionProof) {
  parseBinding(input);
  const stateKey = stableJSON([input.run_id, input.state]);
  if (!stateCache || stateCache.key !== stateKey) stateCache = { key: stateKey, tasks: adaptState(input.state, input.run_id) };
  const tasks = structuredClone(stateCache.tasks);
  const index = { parsedAttempts, tasks: new Map(tasks.map(task => [task.id, task])),
    criteria: new Map(tasks.flatMap(task => task.criteria.map(criterion => [criterion.id, criterion]))),
    attempts: new Map(tasks.map(task => [task.id, new Map()])) };
  const { records, cursors, issues } = replay(input, ledgerCache);
  const cursor = parseContract('cursor', { schema_version: 1, project_id: input.project_id,
    run_id: input.run_id, revision: input.revision, state_sha256: digest(stableJSON(input.state)), queue_revision: input.queue_revision ?? 0,
    queue_sha256: digest(stableJSON(input.queue ?? [])), sources: cursors });
  checkCursor(input, cursor, issues);
  const decisions = (input.state.decisions ?? []).map(item => parseContract('decision', item));
  const acknowledgements = (input.state.acknowledgements ?? []).map(item => parseContract('acknowledgement', item));
  for (const observation of records) {
    if (observation.provenance.kind === 'runtime' || observation.provenance.kind === 'legacy') {
      if (observation.event === 'attempt_result') applyAttempt(index, observation, input, compatiblePlanRevision);
    }
  }
  for (const task of tasks) {
    task.attempts = [...index.attempts.get(task.id).values()];
    for (const criterion of task.criteria) {
      const currentAttempt = task.attempts.filter(attempt => attempt.criterion_id === criterion.id &&
        attempt.criterion_version === criterion.version && (attempt.plan_revision === input.plan_revision || compatiblePlanRevision(input, attempt)) &&
        (!input.source_revision || attempt.source_revision === input.source_revision)).at(-1);
      if (currentAttempt) criterion.verification = currentAttempt.verification;
      criterion.current_attempt_id = currentAttempt?.id ?? null;
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
    reviews: (input.state.reviews ?? []).map(raw => {
      const review = parseContract('review', raw);
      const criterion = tasks.find(task => task.id === review.task_id)?.criteria.find(item => item.id === review.criterion_id);
      return { ...review, current: reviewIsCurrent(review, input, criterion) };
    }),
    review_context: { source_revision: input.source_revision ?? null,
      plan_sha256: input.review_plan_current === false ? null : input.plan_digest ?? null, content_sha256: input.review_content_sha256 ?? null },
    observations: records.map(({ event, payload, provenance }) => ({ event, payload, provenance })), issues });
};
}
export const projectSnapshot = createProjector();
