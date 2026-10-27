import { ContractError, requireRecord, requireText, stableJSON } from '../contracts/parse.mjs';
import { readLedger, provenance } from './ledger.mjs';
export function adaptRuntime(source, runId) {
  const ledger = readLedger(source);
  const records = ledger.records.map(record => {
    let value = record.value;
    // The shipped PostToolUse advisory writer predates the runtime envelope.
    // Its run is the bound ledger directory; it reports advisory activity only.
    const advisoryTool = [undefined, 'post_tool_use_failure'].includes(value.event)
      && typeof value.tool === 'string' && value.tool.length > 0 && value.tool.length <= 160;
    const advisoryStop = value.event === 'stop_failure';
    if (source.kind === 'legacy' && value.run_id === undefined && (advisoryTool || advisoryStop)
      && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
      && Object.keys(value).every(key => ['event', 'tool', 'timestamp', 'files', 'boundary_warning', 'ai_slop_comment',
        'status', 'error', 'suggestion', 'reason', 'synthesized', 'degraded'].includes(key))) {
      const failed = advisoryStop || value.status === 'failure' || value.event === 'post_tool_use_failure';
      value = { run_id: runId, event: advisoryStop ? 'stop-failure' : failed ? 'post-tool-use-failure' : 'post-tool-use',
        ts: value.timestamp, ...(advisoryTool ? { tool_name: value.tool } : {}), ...(failed ? { status: 'failed' } : {}) };
    }
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
