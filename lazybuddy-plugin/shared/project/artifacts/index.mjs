import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EVIDENCE_DIRECTORIES, RUN_ID_PATTERN, SCAN_DEPTH_LIMIT, SCAN_FILE_BUDGET, readArtifactFile,
} from './paths.mjs';
import { previewProfile } from './preview.mjs';
import { researchSourcePaths } from './research.mjs';

// Deterministic collector for the native evidence tree plus registered artifact,
// research and observation records. Scanning is read-only: it observes files and
// digests, and never mutates the run tree, the project store or any original file.

const sha256Bytes = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const VIDEO_EXTENSIONS = new Set(['.mkv', '.mov', '.mp4', '.webm']);
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const STATUSES = ['available', 'missing', 'moved', 'redacted', 'unsupported', 'inaccessible'];

export function classifyArtifact(relativePath) {
  const segments = relativePath.toLowerCase().split('/');
  const name = segments[segments.length - 1] ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (segments.includes('research')) return 'research';
  if (name.includes('receipt')) return 'release_receipt';
  if (extension === '.png' || extension === '.jpg' || extension === '.jpeg' ||
      extension === '.gif' || extension === '.webp' || extension === '.bmp') return 'screenshot';
  if (VIDEO_EXTENSIONS.has(extension)) return 'recording';
  if (extension === '.md' || extension === '.markdown') {
    return segments.includes('verification') ? 'verification_report' : 'design_note';
  }
  if (extension === '.log' || extension === '.txt') return 'log';
  if (extension === '.json') return segments.includes('verification') ? 'verification_report' : 'test_summary';
  return null;
}

function stableId(path) {
  const candidate = `artifact:${path}`;
  return ARTIFACT_ID_PATTERN.test(candidate) ? candidate : `artifact:scan:${sha256Bytes(path)}`;
}

function referencePath(runId, reference) {
  const value = typeof reference === 'string' ? reference : plain(reference) && typeof reference.path === 'string' ? reference.path : null;
  if (!value || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return value.startsWith('.lazybuddy/') ? value : `.lazybuddy/runs/${runId}/${value}`;
}

// Tolerant, deterministic extraction from either recognized run-state shape: the
// dashboard contract (revision, plan_revision, tasks with criteria/attempts/evidence)
// or the native v2 record (verification_gates, tasks with evidence paths).
function runStateFacts(runId, state) {
  const facts = { run_id: runId, revision: null, plan_revision: null, task_ids: [], attempt_ids: [],
    criterion_versions: [], gate_names: [], references: [], expected_digests: new Map() };
  if (!plain(state)) return facts;
  if (boundedText(state.run_id)) facts.run_id = state.run_id;
  if (Number.isSafeInteger(state.revision)) facts.revision = state.revision;
  if (Number.isSafeInteger(state.plan_revision)) facts.plan_revision = state.plan_revision;
  if (Array.isArray(state.verification_gates)) {
    for (const gate of state.verification_gates) {
      if (plain(gate) && boundedText(gate.name)) facts.gate_names.push(gate.name);
    }
  }
  if (Array.isArray(state.tasks)) {
    for (const task of state.tasks) {
      if (!plain(task)) continue;
      const taskId = boundedText(task.id) ? task.id : null;
      if (taskId) facts.task_ids.push(taskId);
      if (Array.isArray(task.criteria)) {
        for (const criterion of task.criteria) {
          if (plain(criterion) && boundedText(criterion.id) && Number.isSafeInteger(criterion.version)) {
            facts.criterion_versions.push({ id: criterion.id, version: criterion.version });
          }
        }
      }
      const evidenceLists = [];
      if (Array.isArray(task.attempts)) {
        for (const attempt of task.attempts) {
          if (!plain(attempt)) continue;
          const attemptId = boundedText(attempt.id) ? attempt.id : null;
          if (attemptId) facts.attempt_ids.push(attemptId);
          if (Array.isArray(attempt.evidence)) {
            evidenceLists.push({ evidence: attempt.evidence, task_id: taskId, attempt_id: attemptId,
              criterion_id: boundedText(attempt.criterion_id) ? attempt.criterion_id : null });
          }
        }
      }
      if (Array.isArray(task.evidence)) evidenceLists.push({ evidence: task.evidence, task_id: taskId, attempt_id: null, criterion_id: null });
      for (const list of evidenceLists) {
        for (const reference of list.evidence) {
          const path = referencePath(runId, reference);
          if (!path) continue;
          const digest = plain(reference) && DIGEST_PATTERN.test(reference.sha256 ?? '') ? reference.sha256 : null;
          facts.references.push({ path, task_id: list.task_id, attempt_id: list.attempt_id,
            criterion_id: list.criterion_id, expected_sha256: digest });
        }
      }
    }
  }
  if (Array.isArray(state.evidence_submissions)) {
    for (const submission of state.evidence_submissions) {
      if (!plain(submission) || !boundedText(submission.archived_path)) continue;
      const path = referencePath(runId, submission.archived_path);
      if (path && DIGEST_PATTERN.test(submission.archived_sha256 ?? '')) facts.expected_digests.set(path, submission.archived_sha256);
    }
  }
  return facts;
}

async function walkEvidenceTree(root, runId, sink) {
  const runRoot = join(root, '.lazybuddy', 'runs', runId);
  for (const directory of EVIDENCE_DIRECTORIES) {
    await walk(join(runRoot, directory), `.lazybuddy/runs/${runId}/${directory}`, 0);
  }
  async function walk(absolute, relative, depth) {
    if (depth > SCAN_DEPTH_LIMIT) { sink.skipped.push({ path: relative, reason: 'depth_limit_exceeded' }); return; }
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') sink.skipped.push({ path: relative, reason: 'unreadable_directory' });
      return;
    }
    for (const dirent of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = `${relative}/${dirent.name}`;
      if (sink.files >= SCAN_FILE_BUDGET) { sink.skipped.push({ path, reason: 'scan_budget_exceeded' }); continue; }
      if (dirent.isSymbolicLink()) { sink.files += 1; sink.filesystems.push({ path, symlink: true }); continue; }
      if (dirent.isDirectory()) { await walk(join(absolute, dirent.name), path, depth + 1); continue; }
      if (!dirent.isFile()) { sink.skipped.push({ path, reason: 'not_a_regular_file' }); continue; }
      sink.files += 1;
      sink.filesystems.push({ path, symlink: false });
    }
  }
}

function emptyApplicability() {
  return { project_revision: null, run_id: null, run_revision: null, plan_revision: null,
    plan_ids: [], feature_ids: [], task_ids: [], attempt_ids: [], criterion_versions: [],
    gate_names: [], observation_ids: [], research_ids: [], content_revision: null };
}

function baseEntry(path, origin = 'scan') {
  return { id: stableId(path), origins: [origin], registered: null, type: classifyArtifact(path),
    producer: null, path, sha256: null, expected_sha256: null, bytes: null, created_at: null,
    status: 'available', moved_to: null, preview: { kind: null, available: false, reason: null },
    applicability: emptyApplicability(), read_error: null };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null))].sort();
}

export async function buildArtifactIndex(root, options = {}) {
  const snapshot = plain(options.snapshot) ? options.snapshot : null;
  const scan = { scanned_at: new Date().toISOString(), directories: [...EVIDENCE_DIRECTORIES],
    runs_discovered: 0, runs_indexed: 0, files_seen: 0, skipped: [], notes: [] };
  const entries = new Map();

  const runsDirectory = join(root, '.lazybuddy', 'runs');
  let runDirents = [];
  try {
    runDirents = (await readdir(runsDirectory, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  } catch (error) {
    if (error.code !== 'ENOENT') scan.notes.push({ run_id: null, reason: 'runs_directory_unreadable' });
  }
  scan.runs_discovered = runDirents.length;

  for (const dirent of runDirents) {
    if (!RUN_ID_PATTERN.test(dirent.name)) { scan.notes.push({ run_id: dirent.name, reason: 'unsupported_run_id' }); continue; }
    if (dirent.isSymbolicLink() || !dirent.isDirectory()) { scan.notes.push({ run_id: dirent.name, reason: 'run_not_a_directory' }); continue; }
    const runId = dirent.name;
    let facts = runStateFacts(runId, null);
    try {
      const state = JSON.parse((await readArtifactFile(root, `.lazybuddy/runs/${runId}/state.json`)).bytes.toString('utf8'));
      facts = runStateFacts(runId, state);
    } catch (error) {
      if (error.code === 'ARTIFACT_MISSING') scan.notes.push({ run_id: runId, reason: 'state_absent' });
      else if (error.code === 'ARTIFACT_TOO_LARGE') scan.notes.push({ run_id: runId, reason: 'state_too_large' });
      else scan.notes.push({ run_id: runId, reason: 'state_unparseable' });
    }
    const sink = { files: 0, skipped: scan.skipped, filesystems: [] };
    await walkEvidenceTree(root, runId, sink);
    scan.files_seen += sink.files;

    for (const found of sink.filesystems) {
      const entry = entries.get(found.path) ?? baseEntry(found.path);
      entry.applicability.run_id = facts.run_id;
      entry.applicability.run_revision = facts.revision;
      entry.applicability.plan_revision = facts.plan_revision;
      entry.producer ??= `run:${runId}`;
      if (found.path.startsWith(`.lazybuddy/runs/${runId}/verification/`) && facts.gate_names.length) {
        entry.applicability.gate_names = uniqueSorted(facts.gate_names);
      }
      for (const reference of facts.references) {
        if (reference.path !== found.path) continue;
        if (reference.task_id) entry.applicability.task_ids.push(reference.task_id);
        if (reference.attempt_id) entry.applicability.attempt_ids.push(reference.attempt_id);
        if (reference.criterion_id) {
          const version = facts.criterion_versions.find(candidate => candidate.id === reference.criterion_id);
          if (version) entry.applicability.criterion_versions.push({ ...version });
        }
        if (reference.expected_sha256) entry.expected_sha256 ??= reference.expected_sha256;
      }
      if (!found.symlink) {
        try {
          const content = await readArtifactFile(root, found.path);
          entry.sha256 = sha256Bytes(content.bytes);
          entry.bytes = content.size;
          entry.created_at = content.modified_at;
        } catch (error) {
          entry.read_error = { code: error.code ?? 'ARTIFACT_INACCESSIBLE' };
        }
      } else {
        entry.read_error = { code: 'ARTIFACT_SYMLINK_REFUSED' };
      }
      const expected = facts.expected_digests.get(found.path);
      if (expected) entry.expected_sha256 ??= expected;
      entries.set(found.path, entry);
    }
    scan.runs_indexed += 1;
  }

  if (snapshot && Array.isArray(snapshot.artifacts)) {
    for (const record of snapshot.artifacts) {
      if (!plain(record) || !boundedText(record.path)) continue;
      const entry = entries.get(record.path) ?? baseEntry(record.path, 'registered');
      if (!entry.origins.includes('registered')) entry.origins.push('registered');
      entry.registered = { id: record.id, type: record.type, producer: record.producer,
        path: record.path, sha256: record.sha256 ?? null, registered_by: record.registered_by,
        registered_at: record.registered_at };
      entry.type = record.type;
      entry.producer = record.producer;
      if (record.sha256) entry.expected_sha256 ??= record.sha256;
      if (!entry.read_error && entry.sha256 === null) {
        try {
          const content = await readArtifactFile(root, record.path);
          entry.sha256 = sha256Bytes(content.bytes);
          entry.bytes = content.size;
          entry.created_at = content.modified_at;
        } catch (error) {
          entry.read_error = { code: error.code ?? 'ARTIFACT_INACCESSIBLE' };
        }
      }
      entries.set(record.path, entry);
    }
  }

  if (snapshot && Array.isArray(snapshot.research)) {
    for (const finding of snapshot.research) {
      if (!plain(finding)) continue;
      for (const source of researchSourcePaths(finding).paths) {
        const entry = entries.get(source) ?? baseEntry(source, 'research');
        if (!entry.origins.includes('research')) entry.origins.push('research');
        entry.producer ??= `research:${finding.id}`;
        entry.applicability.research_ids.push(finding.id);
        if (!entry.read_error && entry.sha256 === null) {
          try {
            const content = await readArtifactFile(root, source);
            entry.sha256 = sha256Bytes(content.bytes);
            entry.bytes = content.size;
            entry.created_at = content.modified_at;
          } catch (error) {
            entry.read_error = { code: error.code ?? 'ARTIFACT_INACCESSIBLE' };
          }
        }
        entries.set(source, entry);
      }
    }
  }

  const digestLocations = new Map();
  for (const entry of entries.values()) {
    if (entry.sha256) digestLocations.set(entry.sha256, [...(digestLocations.get(entry.sha256) ?? []), entry.path].sort());
  }

  for (const entry of entries.values()) {
    const profile = previewProfile(entry.path);
    entry.preview = { kind: profile.kind, available: false, reason: null };
    if (entry.read_error) {
      if (entry.read_error.code === 'ARTIFACT_MISSING') {
        const elsewhere = entry.expected_sha256 ? (digestLocations.get(entry.expected_sha256) ?? []) : [];
        const target = elsewhere.find(path => path !== entry.path);
        if (target) { entry.status = 'moved'; entry.moved_to = target; entry.preview.reason = 'artifact_moved'; }
        else { entry.status = 'missing'; entry.preview.reason = 'artifact_missing'; }
      } else if (entry.read_error.code === 'ARTIFACT_TOO_LARGE') {
        entry.status = 'unsupported'; entry.preview.reason = 'file_too_large';
      } else if (entry.read_error.code === 'ARTIFACT_SYMLINK_REFUSED') {
        entry.status = 'inaccessible'; entry.preview.reason = 'symlink_refused';
      } else {
        entry.status = 'inaccessible'; entry.preview.reason = 'unreadable';
      }
    } else if (entry.expected_sha256 && entry.expected_sha256 !== entry.sha256) {
      entry.status = 'redacted'; entry.preview.reason = 'digest_mismatch';
    } else if (!profile.kind) {
      entry.status = 'unsupported'; entry.preview.reason = 'unsupported_preview_kind';
    } else {
      entry.status = 'available';
      if (profile.kind === 'image' && entry.bytes > 2 * 1024 * 1024) entry.preview.reason = 'image_too_large';
      else entry.preview.available = true;
    }
    entry.applicability.content_revision = entry.sha256;
    entry.applicability.task_ids = uniqueSorted(entry.applicability.task_ids);
    entry.applicability.attempt_ids = uniqueSorted(entry.applicability.attempt_ids);
    entry.applicability.criterion_versions.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.version - right.version);
    entry.applicability.research_ids = uniqueSorted(entry.applicability.research_ids);
    delete entry.read_error;
  }

  if (snapshot) {
    const planIdsByRun = new Map();
    for (const plan of snapshot.plans ?? []) {
      for (const reference of plan.native_runs ?? []) {
        planIdsByRun.set(reference.run_id, uniqueSorted([...(planIdsByRun.get(reference.run_id) ?? []), plan.id]));
      }
    }
    const featuresByPlan = new Map();
    for (const item of snapshot.items ?? []) {
      if (item.kind !== 'feature') continue;
      for (const planId of item.contributing_plan_ids ?? []) {
        featuresByPlan.set(planId, uniqueSorted([...(featuresByPlan.get(planId) ?? []), item.id]));
      }
    }
    for (const entry of entries.values()) {
      entry.applicability.project_revision = snapshot.revision ?? null;
      const planIds = planIdsByRun.get(entry.applicability.run_id) ?? [];
      entry.applicability.plan_ids = planIds;
      entry.applicability.feature_ids = uniqueSorted(planIds.flatMap(planId => featuresByPlan.get(planId) ?? []));
    }
    const observationsByArtifact = new Map();
    for (const observation of snapshot.observations ?? []) {
      if (!plain(observation)) continue;
      for (const artifactId of uniqueSorted([observation.subject?.kind === 'artifact' ? observation.subject.id : null,
        ...((plain(observation) && Array.isArray(observation.artifact_ids)) ? observation.artifact_ids : [])])) {
        observationsByArtifact.set(artifactId, uniqueSorted([...(observationsByArtifact.get(artifactId) ?? []), observation.id]));
      }
    }
    for (const entry of entries.values()) {
      if (entry.registered) entry.applicability.observation_ids = observationsByArtifact.get(entry.registered.id) ?? [];
    }
  }

  const sorted = [...entries.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const byStatus = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const entry of sorted) byStatus[entry.status] += 1;
  return { schema_version: 1, root, project_id: snapshot?.project_id ?? null, scan,
    entries: sorted, coverage: { total: sorted.length, by_status: byStatus, truncation: 'none' } };
}
