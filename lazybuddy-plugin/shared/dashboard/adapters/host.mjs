import { ContractError, parseContract, requireRecord, requireText, stableJSON } from '../contracts/parse.mjs';
import { readLedger, provenance } from './ledger.mjs';
const events = new Set(['post-tool-use', 'post-tool-use-failure', 'pre-compact', 'pre-tool-use', 'session-start',
  'stop', 'stop-failure', 'subagent-start', 'subagent-stop', 'task-completed', 'task-created', 'user-prompt-submit',
  'permission-request', 'permission-denied', 'notification', 'post-compact', 'session-end', 'instructions-loaded',
  'config-change', 'cwd-changed', 'file-changed', 'worktree-create', 'worktree-remove', 'elicitation', 'elicitation-result', 'unsupported']);
export function adaptHost(source) {
  const ledger = readLedger(source);
  const records = ledger.records.map(record => {
    const value = record.value;
    if (value.schema_version !== 1) throw new ContractError('UNSUPPORTED_HOST_SCHEMA');
    requireText(value.event_id); requireText(value.raw_event); requireText(value.occurred_at);
    requireRecord(value.payload); requireText(value.canonical_event);
    let authority;
    switch (source.kind) {
      case 'host':
        parseContract('host_source', value);
        if (value.record_type !== 'canonical-event' || value.contract_version !== '1.0.0') throw new ContractError('HOST_ENVELOPE');
        requireText(value.host); requireRecord(value.surface);
        if (!events.has(value.canonical_event)) throw new ContractError('HOST_EVENT_UNKNOWN');
        authority = value.host; break;
      case 'hook':
        if (value.record_type !== 'normalized-hook-event' || requireRecord(value.consumer).completion_authority !== false) throw new ContractError('HOOK_ENVELOPE');
        requireText(value.session_id); requireText(value.cwd); authority = `hook:${value.session_id}`; break;
      default: throw new ContractError('HOST_SOURCE_KIND');
    }
    return { event: value.canonical_event, payload: value.payload,
      provenance: provenance(source, record, value.occurred_at, source.kind),
      dedup_key: `${authority}:${value.event_id}`, identity: stableJSON(value) };
  });
  return { ...ledger, records };
}
