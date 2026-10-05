import { ContractError, parseContract, requireRecord, requireText, requireRevision } from '../contracts/parse.mjs';
export function executionState(status) {
  switch (status) {
    case 'pending': case 'queued': case 'ready': case 'blocked': case 'not_started': return 'not_started';
    case 'running': case 'in_progress': return 'running';
    case 'done': case 'complete': case 'finished': return 'finished';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: throw new ContractError('UNKNOWN_TASK_STATUS');
  }
}
export function progress(criteria) {
  const required = criteria.filter(item => item.applicability === 'required');
  const count = status => required.filter(item => item.verification === status).length;
  return { denominator: 'required_criteria', total: required.length, verified: count('verified'),
    stale: count('stale'), failed: count('failed'), unavailable: count('unavailable'),
    pending: count('unverified') + count('verifying'),
    optional: criteria.filter(item => item.applicability === 'optional').length,
    not_applicable: criteria.filter(item => item.applicability === 'not_applicable').length,
    criterion_versions: required.map(item => ({ id: item.id, version: item.version })) };
}
export function adaptState(state, runId) {
  requireRecord(state);
  if (state.run_id !== runId) throw new ContractError('RUN_ID_MISMATCH');
  if (state.schema_version !== undefined && !['1', '2', 1, 2].includes(state.schema_version)) throw new ContractError('UNSUPPORTED_STATE_SCHEMA');
  if (!Array.isArray(state.tasks) || state.tasks.length > 10000) throw new ContractError('TASKS_REQUIRED');
  const tasks = state.tasks.map(item => {
    requireRecord(item); requireText(item.id);
    const criteria = (item.criteria ?? []).map(raw => {
      const criterion = parseContract('criterion', raw);
      if (criterion.task_id !== item.id) throw new ContractError('CRITERION_TASK_MISMATCH');
      if (criterion.verification === 'verified') criterion.verification = 'unverified';
      return criterion;
    });
    return parseContract('task', { id: item.id, title: item.title || item.description || item.id,
      scope: item.scope || item.description || item.title || item.id, priority: item.priority ?? 0,
      depends_on: item.depends_on ?? [], execution: executionState(item.status), verification: 'unverified',
      blocker: item.blocker ?? (item.status === 'blocked' ? 'Blocked; reason not observed' : null),
      criteria, attempts: [], progress: progress(criteria) });
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new ContractError('DUPLICATE_TASK');
  const visited = new Set(); const active = new Set();
  function visit(id) {
    if (active.has(id)) throw new ContractError('DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new ContractError('UNKNOWN_DEPENDENCY');
    active.add(id); task.depends_on.forEach(visit); active.delete(id); visited.add(id);
  }
  tasks.forEach(task => visit(task.id));
  const criterionIds = tasks.flatMap(task => task.criteria.map(item => item.id));
  if (new Set(criterionIds).size !== criterionIds.length) throw new ContractError('DUPLICATE_CRITERION');
  return tasks;
}
export function parseBinding(input) {
  requireRecord(input); requireText(input.project_id); requireText(input.run_id);
  requireRevision(input.revision); requireRevision(input.plan_revision);
  if (!Array.isArray(input.sources) || input.sources.length > 64) throw new ContractError('SOURCES_REQUIRED');
}
