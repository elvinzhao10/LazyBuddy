import { parseContract, ContractError, requireRevision, stableJSON } from './contracts/parse.mjs';

export function authorityBinding(input) {
  return stableJSON({ project_id: input.project_id, run_id: input.run_id, revision: input.revision,
    plan_revision: input.plan_revision, state: input.state, sources: input.sources,
    source_revision: input.source_revision ?? null, plan_digest: input.plan_digest ?? null });
}
export function validateTransitions(input) {
  const records = input.state.dashboard_plan_transitions ?? [];
  if (!Array.isArray(records) || records.length > 10000) throw new ContractError('INVALID_REVISION_COMPATIBILITY');
  const previous = new Set();
  for (const record of records) {
    if (!record || Object.keys(record).sort().join(',') !== 'command_id,from_revision,to_revision,unaffected') throw new ContractError('INVALID_REVISION_COMPATIBILITY');
    requireRevision(record.from_revision); requireRevision(record.to_revision);
    if (record.to_revision !== record.from_revision + 1 || record.to_revision > input.plan_revision || previous.has(record.from_revision)) throw new ContractError('INVALID_REVISION_COMPATIBILITY');
    previous.add(record.from_revision);
    const receipt = input.state.dashboard_commands?.find(item => item.command.command_id === record.command_id);
    if (!receipt) throw new ContractError('UNCOMMITTED_REVISION_COMPATIBILITY');
    const command = parseContract('command', receipt.command); const result = parseContract('acknowledgement', receipt.result);
    if (result.plan_revision !== record.to_revision || result.status !== 'pending_agent' || result.revision > input.revision || result.command_id !== record.command_id ||
      command.target.run_id !== input.run_id || command.target.project_id !== input.project_id) throw new ContractError('UNCOMMITTED_REVISION_COMPATIBILITY');
    if (!Array.isArray(record.unaffected) || record.unaffected.length > 10000) throw new ContractError('INVALID_REVISION_COMPATIBILITY');
    const ids = new Set();
    for (const criterion of record.unaffected) {
      if (!criterion || Object.keys(criterion).sort().join(',') !== 'id,version' || typeof criterion.id !== 'string' || ids.has(criterion.id)) throw new ContractError('INVALID_REVISION_COMPATIBILITY');
      requireRevision(criterion.version); ids.add(criterion.id);
    }
  }
  return structuredClone(records);
}
export function crossesCompatibleRevisions(records, attempt, currentRevision) {
  let revision = attempt.plan_revision;
  if (revision >= currentRevision) return false;
  while (revision < currentRevision) {
    const transition = records.find(record => record.from_revision === revision);
    if (!transition || !transition.unaffected.some(item => item.id === attempt.criterion_id && item.version === attempt.criterion_version)) return false;
    revision = transition.to_revision;
  }
  return revision === currentRevision;
}
