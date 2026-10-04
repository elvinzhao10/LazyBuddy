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
export function collectEvidenceReferences(input, snapshot, options) {
  const candidates = []; const protectedArchives = new Set();
  for (const task of input.state.tasks) for (const path of task.evidence ?? []) if (typeof path === 'string') candidates.push({ path, task_id: task.id });
  for (const item of input.state.evidence_submissions ?? []) {
    if (typeof item.archived_path !== 'string') continue;
    const path = `.lazybuddy/runs/${options.runId}/${item.archived_path}`;
    if (protectedServiceArtifact(item.evidence?.path)) protectedArchives.add(path.toLowerCase());
    candidates.push({ path, task_id: item.task_id, sha256: item.archived_sha256 });
  }
  for (const task of snapshot.tasks) for (const attempt of task.attempts) for (const item of attempt.evidence) {
    candidates.push({ path: item.path, task_id: task.id, sha256: item.sha256 });
  }
  const unique = new Map();
  for (const item of candidates) unique.set(`${item.task_id}\n${item.path}\n${item.sha256 ?? ''}`, item);
  if (unique.size > 256) throw new ServiceError('REFERENCE_LIMIT', 503);
  return [...unique.values()].map(item => ({ ...item, id: hash(`${options.projectId}\n${options.runId}\n${item.task_id}\n${item.path}\n${item.sha256 ?? ''}`),
    ...(protectedServiceArtifact(item.path) || protectedArchives.has(item.path.toLowerCase()) ? { unavailable_reason: 'PROTECTED_SERVICE_ARTIFACT' } : {}) }));
}
export async function capture(options, previous) {
  const input = await authorityFor(options).read(options);
  if (previous) input.previous_cursor = previous;
  const snapshot = parseContract('snapshot', await authorityFor(options).project(input));
  const references = collectEvidenceReferences(input, snapshot, options);
  return { snapshot, cursor: encodeCursor(snapshot.cursor), editability: input.editability,
    queue_authority: Number.isSafeInteger(input.queue_revision) ? { supported: true, reason: null } : { supported: false, reason: 'QUEUE_AUTHORITY_REQUIRED' },
    evidence: references };
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
