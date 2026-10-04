import { createHash } from 'node:crypto';
import { ContractError, requireRecord, requireText } from '../contracts/parse.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function readLedger(source) {
  requireRecord(source); requireText(source.id); requireText(source.generation); requireText(source.kind);
  if (typeof source.text !== 'string' || Buffer.byteLength(source.text) > 8 * 1024 * 1024) throw new ContractError('LEDGER_SIZE');
  const lines = source.text.split('\n');
  const tail = lines.pop();
  const issues = tail ? [{ code: 'INCOMPLETE_TAIL', source_id: source.id, line: lines.length + 1 }] : [];
  const records = [];
  for (const [index, line] of lines.entries()) {
    if (line.length > 65536) throw new ContractError('EVENT_SIZE', `${source.id}:${index + 1}`);
    try { records.push({ value: requireRecord(JSON.parse(line)), line: index + 1 }); }
    catch (error) {
      if (!(error instanceof SyntaxError || error instanceof ContractError)) throw error;
      issues.push({ code: 'CORRUPT_RECORD', source_id: source.id, line: index + 1 }); break;
    }
  }
  if (records.length > 10000) throw new ContractError('LEDGER_COUNT');
  return { records, issues, cursor: { id: source.id, generation: source.generation,
    lines: records.length, sha256: digest(lines.slice(0, records.length).map(line => `${line}\n`).join('')) } };
}
export function provenance(source, record, timestamp, kind) {
  if (timestamp !== undefined && (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))) throw new ContractError('INVALID_TIMESTAMP');
  return { source_id: source.id, generation: source.generation,
    source_event_id: record.value.event_id || `line:${record.line}`, line: record.line,
    timestamp: timestamp ?? null, kind };
}
