// Served admission rechecking (T20b), bridged into canonical state (T23).
// The vendored plans library ships `previewAdmission` / `recheckAdmission` as
// pure derivations with documented refusal reasons, but no served route ever
// called them — the fabdbff scope note recorded admission rechecking as
// harness-proven only. This adapter is the service-side accommodation: it
// computes the admission preview itself against the CURRENT accepted project
// (callers submit graph documents and dependency facts, never a verdict),
// persists that evidence in a dashboard-owned store, and rechecks it
// server-side the moment a plan transition to `active` is attempted through
// the served command route. A stale/unsatisfied verifier gate therefore
// refuses the transition with the library's documented blocked reason
// (ADMIT_BLOCKED / STALE_PREVIEW / GATE_INVALIDATED). Plans with no recorded
// admission evidence keep the previous bridge semantics — the recheck layer
// is additive, never a bypass. T23 additionally mirrors every recorded
// recheck into canonical accepted state as an observation on the plan
// (subject `plan`, classification `inferred`, provenance pointing at the
// evidence file) through the bridge `observe` action when available; the
// evidence file remains the recheck-time store either way.
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { observeProject, readProject } from '../../project/cli.mjs';
import { composeGraphSet } from '../../project/plans/dependencies.mjs';
import { normalizeDependencyFacts, previewAdmission, recheckAdmission } from '../../project/plans/readiness.mjs';
import { observeUnavailable } from './observations.mjs';

export const ADMISSION_STORE = 'dashboard-service/admission-evidence@1';
const STORE_DIRECTORY = '.lazybuddy/project-admissions';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_GRAPHS = 256;
const MAX_FACTS = 10000;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const LOCK_WAIT_MS = 5000;
const STALE_LOCK_MS = 15000;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class AdmissionError extends Error {
  constructor(code, detail = code) { super(detail); this.name = 'AdmissionError'; this.code = code; }
}

function storePath(projectRoot, planId) {
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/') || typeof planId !== 'string'
    || !ID_PATTERN.test(planId)) throw new AdmissionError('INVALID_ADMISSION_BINDING');
  return { directory: join(projectRoot, STORE_DIRECTORY), file: join(projectRoot, STORE_DIRECTORY, `${createHash('sha256').update(planId).digest('hex')}.json`) };
}

async function initializedProject(projectRoot) {
  try { await stat(join(projectRoot, '.lazybuddy/project/owner.json')); return true; } catch { return false; }
}

// The accepted-state view the readiness derivations read. `readProject` returns
// the projected snapshot; the projection clones plan and item records whole
// (identity, revision, source digests, lifecycle, item state and revisions
// included) plus the top-level revision and runtime, which is exactly the field
// set graphCurrency, admissionBasis and evaluateDependency consume.
async function currentStateView(options, actor) {
  try {
    return await readProject({ projectRoot: options.projectRoot, projectId: options.projectId, actor });
  } catch (error) {
    if (error?.code === 'PROJECT_NOT_INITIALIZED') throw new AdmissionError('PROJECT_NOT_INITIALIZED');
    throw error;
  }
}

async function withStoreLock(paths, operation) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const lock = `${paths.file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let handle;
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new AdmissionError('ADMISSION_STORE_BUSY');
      try {
        const held = await stat(lock);
        if (Date.now() - held.mtimeMs > STALE_LOCK_MS) await unlink(lock);
      } catch { /* raced away or already fresh */ }
      await sleep(25);
      continue;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

async function readEvidence(paths) {
  let bytes;
  try { bytes = await readFile(paths.file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new AdmissionError('ADMISSION_EVIDENCE_CORRUPT');
  try {
    const evidence = JSON.parse(bytes.toString('utf8'));
    if (typeof evidence?.plan_id !== 'string' || typeof evidence?.task_id !== 'string'
      || !Array.isArray(evidence.graphs) || !Array.isArray(evidence.facts) || typeof evidence.preview !== 'object') {
      throw new AdmissionError('ADMISSION_EVIDENCE_CORRUPT');
    }
    return evidence;
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    throw new AdmissionError('ADMISSION_EVIDENCE_CORRUPT');
  }
}

async function writeEvidence(paths, evidence) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new AdmissionError('ADMISSION_EVIDENCE_LIMIT');
  const temporary = `${paths.file}.pending`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, paths.file);
}

function deriveAdmission(stateView, request) {
  const set = composeGraphSet(request.graphs, { state: stateView });
  const facts = normalizeDependencyFacts(request.facts);
  const preview = previewAdmission(stateView, set, facts, { plan_id: request.plan_id, task_id: request.task_id });
  return { set, facts, preview, verdict: recheckAdmission(stateView, set, facts, preview) };
}

// Canonical mirror of a recorded admission recheck (T23): one observation on
// the plan, classified `inferred` (the verdict is derived, never caller-
// supplied), provenance pointing at the evidence file. The identity digests
// the whole recorded evidence — including its timestamp — so each recheck is
// its own append-only observation and byte-identical evidence replays
// idempotently. Returns the bridge receipt, or null when the observe action
// is unavailable here (evidence-file-only fallback, the T20b behavior).
async function mirrorAdmissionEvidence(options, actor, request, evidence, relativeEvidencePath) {
  const subjectKey = createHash('sha256').update(`${request.plan_id}\0${request.task_id}`).digest('hex').slice(0, 16);
  const contentDigest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 24);
  const record = {
    id: `admission:${subjectKey}:${contentDigest}`,
    subject: { kind: 'plan', id: request.plan_id },
    classification: 'inferred',
    observed_by: actor,
    observed_at: evidence.recorded_at,
    provenance: { kind: 'file', reference: relativeEvidencePath },
    content_revision: null,
    text: JSON.stringify({ schema_version: 1, store: ADMISSION_STORE, plan_id: request.plan_id,
      task_id: request.task_id, status: evidence.verdict.status, reason: evidence.verdict.reason,
      basis: evidence.basis }),
  };
  try {
    const outcome = await observeProject({ projectRoot: options.projectRoot, projectId: options.projectId,
      actor }, [record]);
    return outcome.receipt ?? null;
  } catch (error) {
    if (observeUnavailable(error)) return null;
    throw error;
  }
}

// POST-shaped admission recheck: the caller supplies the authored graph
// documents and the dependency facts the native runtime reports; the preview
// and the recheck verdict are computed here against the current accepted
// project, and the evidence (preview + graphs + facts + verdict + basis) is
// persisted for the transition-time recheck below.
export async function recheckProjectAdmission(options, actor, request) {
  if (typeof request?.plan_id !== 'string' || !ID_PATTERN.test(request.plan_id)
    || typeof request?.task_id !== 'string' || !ID_PATTERN.test(request.task_id)
    || !Array.isArray(request.graphs) || request.graphs.length === 0 || request.graphs.length > MAX_GRAPHS
    || !Array.isArray(request.facts) || request.facts.length > MAX_FACTS) {
    throw new AdmissionError('INVALID_ADMISSION_REQUEST');
  }
  const paths = storePath(options?.projectRoot, request.plan_id);
  if (!(await initializedProject(options.projectRoot))) throw new AdmissionError('PROJECT_NOT_INITIALIZED');
  const stateView = await currentStateView(options, actor);
  const { preview, verdict } = deriveAdmission(stateView, request);
  const evidence = { schema_version: 1, store: ADMISSION_STORE, plan_id: request.plan_id,
    task_id: request.task_id, preview, graphs: request.graphs, facts: request.facts,
    verdict: { status: verdict.status, reason: verdict.reason }, basis: verdict.basis ?? preview.basis,
    recorded_at: new Date().toISOString(), recorded_by: actor };
  let canonical = null;
  await withStoreLock(paths, async () => {
    await writeEvidence(paths, evidence);
    // Evidence file first (the recheck-time store), then the canonical mirror:
    // an unavailable bridge observe leaves the T20b behavior whole.
    canonical = await mirrorAdmissionEvidence(options, actor, request, evidence,
      `${STORE_DIRECTORY}/${createHash('sha256').update(request.plan_id).digest('hex')}.json`);
  });
  return { status: verdict.status, reason: verdict.reason, plan_id: request.plan_id,
    task_id: request.task_id, basis: verdict.basis, gate: verdict.gate,
    blockers: preview.blockers, preview_status: preview.status, store: ADMISSION_STORE,
    recorded_at: evidence.recorded_at,
    canonical: canonical ? { store: 'lazybuddy/project-observe@1',
      observation_revision: canonical.observation_revision } : null };
}

// Transition-time recheck on the served command route. Called for
// `plan.transition` commands targeting `active`. With no stored admission
// evidence the transition proceeds under the previous bridge semantics; with
// stored evidence the gate and revision bases are recomputed from the CURRENT
// accepted project, and anything less than `admitted` refuses the command with
// the documented blocked reason. Compose/normalize failures while replaying
// stored evidence against current state are typed staleness refusals, never
// silent passes.
export async function assertAdmissionForTransition(options, actor, planId) {
  const paths = storePath(options?.projectRoot, planId);
  if (!(await initializedProject(options.projectRoot))) return;
  const evidence = await readEvidence(paths);
  if (!evidence) return;
  const stateView = await currentStateView(options, actor);
  let verdict;
  try {
    const derived = deriveAdmission(stateView, evidence);
    verdict = recheckAdmission(stateView, derived.set, derived.facts, evidence.preview);
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    throw new AdmissionError('ADMISSION_EVIDENCE_STALE');
  }
  if (verdict.status !== 'admitted') {
    throw new AdmissionError(verdict.reason?.code ?? 'GATE_INVALIDATED', verdict.reason?.detail ?? undefined);
  }
}

export const admissionSelfTest = { storePath, readEvidence, deriveAdmission, withStoreLock, mirrorAdmissionEvidence };
