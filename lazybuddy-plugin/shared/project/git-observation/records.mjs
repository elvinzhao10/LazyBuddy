// Bridges collector results into the existing T02 project-record surfaces
// without schema edits: observation inputs for `recordObservations` and
// worktree observations for the projection options. No new authority is
// granted; observations are source-backed records only.
import { LOCAL_COLLECTOR } from './local.mjs';
import { REMOTE_COLLECTOR } from './remote.mjs';
import { digestOf, sha256Hex } from './command.mjs';

const TEXT_LIMIT = 1048576;
const COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function provenanceReference(result) {
  const commands = digestOf((result.commands ?? []).map(command =>
    [command.purpose, command.argv, command.exit_code, command.unavailable ?? null]));
  return `${result.collector}#${commands}`;
}

function boundedText(payload, result) {
  let text = JSON.stringify(payload);
  if (text.length > TEXT_LIMIT) {
    const reduced = { ...payload, truncated_text: true,
      note: 'Payload path lists were reduced to fit the observation text limit.' };
    if (Array.isArray(payload.changed_paths)) reduced.changed_paths = { count: payload.changed_paths.length };
    if (Array.isArray(payload.pull_requests)) reduced.pull_requests = { count: payload.pull_requests.length };
    text = JSON.stringify(reduced);
  }
  if (text.length > TEXT_LIMIT) {
    text = JSON.stringify({ collector: result.collector, status: result.status, reason: result.reason,
      truncated_text: true, note: 'Facts exceeded the observation text limit and were dropped.' });
  }
  return text;
}

function observationRecord({ id, subject, result, payload, contentRevision, coverage }) {
  const record = {
    id,
    subject,
    classification: 'observed',
    observed_by: result.collector,
    observed_at: result.observed_at,
    provenance: { kind: 'collector', reference: provenanceReference(result) },
    text: boundedText(payload, result),
  };
  if (contentRevision !== undefined) record.content_revision = contentRevision;
  if (coverage !== undefined) record.coverage = coverage;
  return record;
}

// Maps a local collector result onto observation inputs for the T02 route.
// One repository-level `git` subject plus one `worktree` subject per observed
// worktree, each bound to that worktree's HEAD as its content revision.
export function localObservationRecords(result, options = {}) {
  if (result?.collector !== LOCAL_COLLECTOR) throw new Error('INVALID_RESULT');
  const prefix = options.idPrefix ?? 'observation:git';
  if (result.status !== 'observed') {
    return [observationRecord({
      id: `${prefix}:git`,
      subject: { kind: 'git' },
      result,
      payload: { status: result.status, reason: result.reason, repository: result.repository ?? null,
        source_scope: result.source_scope },
      contentRevision: null,
    })];
  }
  const records = [observationRecord({
    id: `${prefix}:git`,
    subject: { kind: 'git' },
    result,
    payload: {
      status: 'observed', repository: result.repository, head: result.head,
      commits: result.commits, binary_diff_counts: result.binary_diff_counts,
      conflicts: result.conflicts, capture: result.capture, coverage: result.coverage, limits: result.limits,
      worktree_roots: result.worktrees.map(worktree => worktree.root),
    },
    contentRevision: result.head,
    coverage: result.commits.coverage.total == null ? undefined
      : { reported: result.commits.coverage.reported, total: result.commits.coverage.total },
  })];
  for (const worktree of result.worktrees) {
    if (worktree.status !== 'observed') {
      records.push(observationRecord({
        id: `${prefix}:worktree:${sha256Hex(worktree.root).slice(0, 16)}`,
        subject: { kind: 'worktree', worktree: worktree.root },
        result,
        payload: { status: 'unavailable', reason: worktree.reason, worktree_root: worktree.root },
        contentRevision: null,
      }));
      continue;
    }
    const changed = worktree.changed;
    const listed = changed.staged.paths.length + changed.unstaged.paths.length
      + changed.untracked.paths.length + changed.unmerged.paths.length;
    const truncated = changed.staged.truncated || changed.unstaged.truncated
      || changed.untracked.truncated || changed.unmerged.truncated;
    records.push(observationRecord({
      id: `${prefix}:worktree:${sha256Hex(worktree.root).slice(0, 16)}`,
      subject: { kind: 'worktree', worktree: worktree.root },
      result,
      payload: {
        status: 'observed', worktree_root: worktree.root, kind: worktree.kind,
        branch: worktree.branch, head: worktree.head, detached: worktree.detached, bare: worktree.bare,
        upstream: worktree.upstream ?? null, ahead: worktree.ahead ?? null, behind: worktree.behind ?? null,
        staged: changed.staged.paths, unstaged: changed.unstaged.paths,
        untracked: changed.untracked.paths, unmerged: changed.unmerged.paths,
        union_changed_path_total: changed.union_total,
        binary_paths: worktree.binary_paths,
        content_binding: worktree.binding,
        conflicts: {
          actual_unmerged_index: result.conflicts.actual_unmerged_index.paths
            .filter(paths => paths.worktree_root === worktree.root),
          concurrent_edit_overlap: result.conflicts.concurrent_edit_overlap.overlaps
            .filter(overlap => overlap.worktree_roots.includes(worktree.root)),
        },
      },
      contentRevision: COMMIT_OID.test(worktree.head ?? '') ? worktree.head : null,
      coverage: truncated ? { reported: listed, total: changed.union_total } : undefined,
    }));
  }
  return records;
}

// Maps a remote collector result onto one observation input. Unavailability is
// itself an observed fact and is recorded as such, never as zero PRs.
export function remoteObservationRecords(result, options = {}) {
  if (result?.collector !== REMOTE_COLLECTOR) throw new Error('INVALID_RESULT');
  const prefix = options.idPrefix ?? 'observation:git-remote';
  const payload = result.status === 'observed'
    ? { status: 'observed', remote: result.remote, pull_requests: result.pull_requests,
        limits: result.limits }
    : { status: 'unavailable', reason: result.reason };
  return [observationRecord({
    id: `${prefix}:gh`,
    subject: { kind: 'git' },
    result,
    payload,
    contentRevision: null,
    coverage: result.status === 'observed' && result.coverage.total != null
      ? { reported: result.coverage.reported, total: result.coverage.total } : undefined,
  })];
}

// Worktree observations in the exact shape `assertProjectionOptions` expects:
// exactly one current entry, branch null for detached or bare worktrees.
export function worktreeProjectionObservations(result) {
  if (result?.collector !== LOCAL_COLLECTOR || result.status !== 'observed') return [];
  return result.worktrees.map(worktree => ({
    root: worktree.root,
    kind: worktree.kind,
    branch: worktree.detached || worktree.bare ? null : worktree.branch ?? null,
    head: worktree.head,
    detached: worktree.detached,
    bare: worktree.bare,
    current: worktree.current,
  }));
}

// Dirty-content snapshot bindings for downstream consumers (T13/UI): same HEAD
// plus changed relevant paths must stale affected proof; branch labels are
// deliberately not part of a binding.
export function dirtyContentBindings(result) {
  if (result?.collector !== LOCAL_COLLECTOR || result.status !== 'observed') return [];
  return result.worktrees.filter(worktree => worktree.binding).map(worktree => worktree.binding);
}

export function sameBinding(left, right) {
  return left?.digest != null && left.digest === right?.digest;
}
