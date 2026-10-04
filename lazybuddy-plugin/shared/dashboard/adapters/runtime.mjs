import { ContractError, requireRecord, requireText, stableJSON } from '../contracts/parse.mjs';
import { readLedger, provenance } from './ledger.mjs';
export function adaptRuntime(source, runId) {
  const ledger = readLedger(source);
  const records = ledger.records.map(record => {
    const value = record.value;
    if (value.run_id !== runId) throw new ContractError('RUN_ID_MISMATCH');
    requireText(value.event); requireText(value.ts);
    let payload;
    switch (source.kind) {
      case 'runtime':
        if (value.schema_version !== 1) throw new ContractError('UNSUPPORTED_RUNTIME_SCHEMA');
        requireText(value.event_id); payload = requireRecord(value.event_payload); break;
      case 'legacy': {
        const { ts, run_id, event, event_id, ...rest } = value;
        payload = rest; break;
      }
      default: throw new ContractError('RUNTIME_SOURCE_KIND');
    }
    if (value.event_id !== undefined) requireText(value.event_id);
    const origin = provenance(source, record, value.ts, source.kind);
    return { event: value.event, payload, provenance: origin,
      dedup_key: value.event_id ? `runtime:${runId}:${value.event_id}` : `${source.id}:${source.generation}:${record.line}`,
      identity: stableJSON({ event: value.event, payload, timestamp: value.ts }) };
  });
  return { ...ledger, records };
}
