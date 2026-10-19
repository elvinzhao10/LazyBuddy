// Served observation persistence (T20b). The vendored project model exposes
// `recordObservations` as a pure reducer step, but the native bridge has no
// action that persists its outcome, so nothing on the served route ever landed
// observations durably. This adapter is the service-side accommodation: a
// dashboard-owned append-only JSONL journal under the project root that carries
// the same semantics — inputs validated by the vendored contract, versions
// assigned monotonically from the journal, observations never appended as
// command receipts, and idempotent replay by observation identity. The store is
// deliberately separate from `.lazybuddy/project` (the bridge's journaled
// transactional state) so no service-side write can ever interleave with a
// bridge transaction. The needed canonical-store change (a bridge `observe`
// action persisting `recordObservations` output into `state.json`) is recorded
// as a follow-up for the project-family regen.
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertObservationInput } from '../../project/contract.mjs';
import { readProject } from '../../project/cli.mjs';

export const OBSERVATION_STORE = 'dashboard-service/observation-journal@1';
const JOURNAL_DIRECTORY = '.lazybuddy/project-observations';
const MAX_BATCH = 1000;            // mirrors the vendored recordObservations bound
const MAX_RECORDS = 8192;          // mirrors the contract's state.observations bound
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const LOCK_WAIT_MS = 5000;
const STALE_LOCK_MS = 15000;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class ObservationStoreError extends Error {
  constructor(code, detail = code) { super(detail); this.name = 'ObservationStoreError'; this.code = code; }
}

function storePaths(projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) {
    throw new ObservationStoreError('INVALID_PROJECT_ROOT');
  }
  const directory = join(projectRoot, JOURNAL_DIRECTORY);
  return { directory, journal: join(directory, 'journal.jsonl'), lock: join(directory, 'lock'),
    owner: join(projectRoot, '.lazybuddy/project/owner.json') };
}

// Single-writer discipline across every service binding on the same project:
// an O_EXCL lock file with a bounded wait and stale-lock recovery, so a crashed
// holder can never wedge the route and a live holder is never preempted.
async function withStoreLock(paths, operation) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let handle;
    try {
      handle = await open(paths.lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new ObservationStoreError('OBSERVATION_STORE_BUSY');
      try {
        const held = await stat(paths.lock);
        if (Date.now() - held.mtimeMs > STALE_LOCK_MS) await unlink(paths.lock);
      } catch { /* raced away or already fresh */ }
      await sleep(25);
      continue;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(paths.lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

async function readJournal(paths) {
  let bytes;
  try { bytes = await readFile(paths.journal); }
  catch (error) {
    if (error.code === 'ENOENT') return { records: [], torn: false };
    throw error;
  }
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  const complete = text.endsWith('\n') || text === '';
  const torn = !complete;
  if (torn) lines.pop(); // a crash mid-append leaves a partial tail line; it is dropped
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '') continue;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new ObservationStoreError('OBSERVATION_JOURNAL_CORRUPT');
    let record;
    try { record = JSON.parse(line); } catch { throw new ObservationStoreError('OBSERVATION_JOURNAL_CORRUPT'); }
    if (typeof record?.id !== 'string' || !Number.isSafeInteger(record.version) || record.version !== records.length + 1) {
      throw new ObservationStoreError('OBSERVATION_JOURNAL_CORRUPT');
    }
    records.push(record);
  }
  return { records, torn };
}

async function initializedProject(paths) {
  try { await stat(paths.owner); return true; } catch { return false; }
}

// Referential integrity against the CURRENT accepted project, mirroring the
// canonical route's state-level checks: record-backed subjects must exist
// (run identities are the runs linked to registered plans) and artifact
// references must resolve. Without this the served journal would accept
// references the canonical recordObservations route refuses.
async function assertResolvableSubjects(options, inputs) {
  const snapshot = await readProject({ projectRoot: options.projectRoot, projectId: options.projectId,
    actor: options.actor ?? 'dashboard:observations' });
  const scopes = {
    source: new Set(snapshot.sources.map(entry => entry.id)),
    item: new Set(snapshot.items.map(entry => entry.id)),
    plan: new Set(snapshot.plans.map(entry => entry.id)),
    architecture: new Set((snapshot.architecture ?? []).map(entry => entry.id)),
    artifact: new Set((snapshot.artifacts ?? []).map(entry => entry.id)),
    run: new Set(snapshot.plans.flatMap(plan => plan.native_runs.map(reference => reference.run_id))),
  };
  for (const input of inputs) {
    const scope = scopes[input.subject.kind];
    if (scope && !scope.has(input.subject.id)) throw new ObservationStoreError('UNKNOWN_SUBJECT');
    for (const identity of input.artifact_ids ?? []) {
      if (!scopes.artifact.has(identity)) throw new ObservationStoreError('INVALID_REFERENCE');
    }
  }
}

// Key-order-independent content identity (the assigned version is excluded):
// replaying the same observation with reordered keys is still the same record.
const recordIdentity = record => {
  const canonical = value => value === null || typeof value !== 'object' ? value
    : Array.isArray(value) ? value.map(canonical)
      : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  const { version: _version, ...rest } = record;
  return JSON.stringify(canonical(rest));
};

// Records one batch of observation inputs durably. Validation is delegated to
// the vendored contract (`assertObservationInput`), so the served route accepts
// exactly the shapes the canonical `recordObservations` route accepts; versions
// are then assigned journal-monotonically, matching the reducer's
// observation_revision semantics. Replay of an identical record is idempotent
// (the recorded version is returned again); the same identity with different
// content is a typed refusal, mirroring command-id reuse rules.
export async function recordProjectObservations(options, records) {
  const paths = storePaths(options?.projectRoot);
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_BATCH) {
    throw new ObservationStoreError('INVALID_OBSERVATION_BATCH');
  }
  if (!(await initializedProject(paths))) throw new ObservationStoreError('PROJECT_NOT_INITIALIZED');
  const inputs = records.map(record => assertObservationInput(JSON.parse(JSON.stringify(record ?? null))));
  await assertResolvableSubjects(options, inputs);
  const identities = new Set();
  for (const input of inputs) {
    if (identities.has(input.id)) throw new ObservationStoreError('DUPLICATE_OBSERVATION_ID');
    identities.add(input.id);
  }
  return withStoreLock(paths, async () => {
    const { records: existing, torn } = await readJournal(paths);
    if (existing.length + inputs.length > MAX_RECORDS) throw new ObservationStoreError('OBSERVATION_LIMIT');
    const byIdentity = new Map(existing.map(record => [record.id, record]));
    const appended = [];
    const already = [];
    for (const input of inputs) {
      const previous = byIdentity.get(input.id);
      if (previous) {
        if (recordIdentity(previous) !== recordIdentity(input)) throw new ObservationStoreError('DUPLICATE_OBSERVATION_ID');
        already.push({ id: previous.id, version: previous.version });
        continue;
      }
      const record = { ...input, version: existing.length + appended.length + 1 };
      appended.push(record);
    }
    if (appended.length) {
      await mkdir(paths.directory, { recursive: true, mode: 0o700 });
      const handle = torn
        // Repair a torn tail by truncating back to the last complete line
        // before the new appends land.
        ? await open(paths.journal, 'r+').then(async repair => {
          const whole = (await readFile(paths.journal)).toString('utf8').replace(/\n?[^\n]*$/, '\n');
          await repair.truncate(Buffer.byteLength(whole)); await repair.close();
          return open(paths.journal, 'a');
        })
        : await open(paths.journal, 'a');
      try {
        for (const record of appended) await handle.write(`${JSON.stringify(record)}\n`);
        await handle.sync();
      } finally { await handle.close(); }
    }
    const total = existing.length + appended.length;
    return { status: already.length && !appended.length ? 'already-recorded' : 'recorded',
      recorded: [...already.map(entry => entry.id), ...appended.map(record => record.id)],
      versions: [...already, ...appended.map(record => ({ id: record.id, version: record.version }))],
      observation_revision: total, observation_count: total, store: OBSERVATION_STORE };
  });
}

// Reads the durable observation journal. This is the served read side of the
// persistence residual: the counts and records an operator sees must be
// identical before and after a service restart.
export async function readProjectObservations(options) {
  const paths = storePaths(options?.projectRoot);
  if (!(await initializedProject(paths))) throw new ObservationStoreError('PROJECT_NOT_INITIALIZED');
  const { records } = await readJournal(paths);
  return { observations: records, observation_revision: records.length, observation_count: records.length,
    store: OBSERVATION_STORE };
}

export const observationJournalSelfTest = { storePaths, readJournal, recordIdentity };
