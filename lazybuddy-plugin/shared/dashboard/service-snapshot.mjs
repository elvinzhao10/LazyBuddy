import { authorityFor } from './service-adapter.mjs';
import { parseContract, stableJSON } from './contracts/parse.mjs';
import { hash, protectedServiceArtifact, ServiceError } from './service-files.mjs';

export function decodeCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ServiceError('RESYNC_REQUIRED', 409);
  try { return parseContract('cursor', JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); }
  catch { throw new ServiceError('RESYNC_REQUIRED', 409); }
}
export const encodeCursor = cursor => Buffer.from(stableJSON(cursor)).toString('base64url');
export async function capture(options, previous) {
  const input = await authorityFor(options).read(options);
  const snapshot = parseContract('snapshot', await authorityFor(options).project(previous ? { ...input, previous_cursor: previous } : input));
  const references = [];
  const protectedArchives = new Set();
  for (const task of input.state.tasks) for (const path of task.evidence ?? []) {
    if (typeof path === 'string') references.push({ path, task_id: task.id });
  }
  for (const item of input.state.evidence_submissions ?? []) {
    if (typeof item.archived_path === 'string') {
      const path = `.lazybuddy/runs/${options.runId}/${item.archived_path}`;
      if (protectedServiceArtifact(item.evidence?.path)) protectedArchives.add(path.toLowerCase());
      references.push({ path, task_id: item.task_id, sha256: item.archived_sha256 });
    }
  }
  if (references.length > 256) throw new ServiceError('REFERENCE_LIMIT', 503);
  return { snapshot, cursor: encodeCursor(snapshot.cursor), editability: input.editability,
    queue_authority: Number.isSafeInteger(input.queue_revision) ? { supported: true, reason: null } : { supported: false, reason: 'QUEUE_AUTHORITY_REQUIRED' },
    evidence: references.map(item => ({ ...item, id: hash(`${options.projectId}\n${options.runId}\n${item.path}`),
      ...(protectedServiceArtifact(item.path) || protectedArchives.has(item.path.toLowerCase()) ? { unavailable_reason: 'PROTECTED_SERVICE_ARTIFACT' } : {}) })) };
}
export async function evidence(options, id) {
  const current = await capture(options);
  const reference = current.evidence.find(item => item.id === id);
  if (!reference) throw new ServiceError('UNKNOWN_EVIDENCE', 404);
  if (reference.unavailable_reason) throw new ServiceError(reference.unavailable_reason, 403);
  const bytes = await authorityFor(options).readReference(options, reference.path);
  if (reference.sha256 && hash(bytes) !== reference.sha256) throw new ServiceError('REFERENCE_CHANGED', 409);
  return bytes;
}
