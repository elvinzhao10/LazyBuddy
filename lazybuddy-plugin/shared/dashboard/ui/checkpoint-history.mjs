const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function snapshotSummary(state) {
  return { run_id: state.run_id, plan_revision: state.plan_revision ?? null,
    tasks: (state.tasks ?? []).map(task => ({ id: task.id, title: task.title ?? task.description ?? task.id, status: task.status,
      scope: task.scope ?? null, priority: task.priority ?? null, depends_on: task.depends_on ?? [],
      criteria: (task.criteria ?? []).map(criterion => ({ id: criterion.id, version: criterion.version,
        requirement: criterion.requirement, scenarios: criterion.scenarios ?? [] })) })),
    decisions: (state.decisions ?? []).map(decision => ({ id: decision.id, title: decision.title, scope: decision.scope,
      revision: decision.revision, reference: decision.reference, state: decision.state, choice: decision.choice,
      alternatives: decision.alternatives, supersedes: decision.supersedes, rationale: decision.rationale })) };
}
export function compareCheckpoints(before, after) {
  if (before.run_id !== after.run_id) throw new Error('CHECKPOINT_RUN_MISMATCH');
  const compare = (oldRows, newRows) => {
    const old = new Map(oldRows.map(row => [row.id, row])); const next = new Map(newRows.map(row => [row.id, row]));
    return [...new Set([...old.keys(), ...next.keys()])].filter(id => JSON.stringify(canonical(old.get(id))) !== JSON.stringify(canonical(next.get(id))))
      .map(id => ({ id, before: old.get(id) ?? null, after: next.get(id) ?? null }));
  };
  return { run_id: before.run_id, before_plan_revision: before.plan_revision, after_plan_revision: after.plan_revision,
    tasks: compare(before.tasks, after.tasks), decisions: compare(before.decisions, after.decisions), verification_authority: 'none' };
}
export async function queryCheckpointHistory(input, request, readCheckpoint) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('INVALID_HISTORY_QUERY');
  const receipts = input.state.dashboard_commands ?? [];
  const entries = receipts.map(item => ({ id: item.result.revision, command_id: item.command.command_id,
    operation: item.command.operation })).reverse();
  if (request.operation === 'index') {
    if (Object.keys(request).sort().join(',') !== 'limit,offset,operation' || !Number.isSafeInteger(request.offset) || request.offset < 0
      || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new Error('INVALID_HISTORY_QUERY');
    return { revision: input.revision, total: entries.length, offset: request.offset,
      entries: entries.slice(request.offset, request.offset + request.limit), current: snapshotSummary(input.state) };
  }
  if (request.operation !== 'compare' || Object.keys(request).sort().join(',') !== 'after,before,operation') throw new Error('INVALID_HISTORY_QUERY');
  async function read(id) {
    if (id === null) return snapshotSummary(input.state);
    if (!Number.isSafeInteger(id) || !entries.some(entry => entry.id === id)) throw new Error('UNKNOWN_HISTORY_CHECKPOINT');
    const state = await readCheckpoint(id);
    if (state.run_id !== input.run_id) throw new Error('CHECKPOINT_RUN_MISMATCH');
    return snapshotSummary(state);
  }
  return { revision: input.revision, comparison: compareCheckpoints(await read(request.before), await read(request.after)) };
}
