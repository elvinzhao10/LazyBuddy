#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, lstat, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { consumeRevision, publishAttempt, publishCompletion, readProducerContext } from './commands.mjs';
import { stableJSON, ContractError } from './projection.mjs';

const require = createRequire(import.meta.url);
const { commandErrors } = require('../../contracts/execution-context-security.js');
const packageVersion = require('../../tooling/package.json').version;
const runner = fileURLToPath(new URL('../../scripts/lazybuddy-bounded-run.py', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = new Set(['--project-root', '--project-id', '--run-id', '--actor', '--parent-task-id', '--task-id',
  '--criterion-id', '--attempt-id', '--worker-id', '--plan-commands-file', '--command-index', '--context-file',
  '--role', '--artifact-path', '--executor-id', '--executor-attempt-id', '--cancel-file', '--python', '--timeout']);

function options(argv) {
  const result = { action: argv[0] };
  if (!['context', 'execute', 'verify'].includes(result.action) || (argv.length - 1) % 2) throw new ContractError('INVALID_ARGUMENTS');
  for (let index = 1; index < argv.length; index += 2) {
    if (!keys.has(argv[index]) || !argv[index + 1] || Object.hasOwn(result, argv[index])) throw new ContractError('INVALID_ARGUMENTS');
    result[argv[index]] = argv[index + 1];
  }
  for (const name of ['--project-root', '--project-id', '--run-id', '--actor']) if (!result[name]) throw new ContractError('MISSING_BINDING');
  return result;
}

const binding = value => ({ projectRoot: value['--project-root'], projectId: value['--project-id'], runId: value['--run-id'],
  actor: value['--actor'], python: value['--python'] });
async function createContext(value, expectedReview = null) {
  for (const name of ['--parent-task-id', '--task-id', '--criterion-id', '--attempt-id', '--worker-id', '--plan-commands-file', '--command-index'])
    if (!value[name]) throw new ContractError('MISSING_CONTEXT_ARGUMENT');
  const role = value['--role'] ?? (value.action === 'verify' ? 'verifier' : 'worker');
  if (!['worker', 'verifier'].includes(role)) throw new ContractError('INVALID_REVIEW_ROLE');
  const resolved = await readProducerContext(bridgeOptions(value, { request: { parent_task_id: value['--parent-task-id'],
    task_id: value['--task-id'], criterion_id: value['--criterion-id'], plan_commands_file: value['--plan-commands-file'],
    command_index: Number(value['--command-index']), attempt_id: value['--attempt-id'], worker_id: value['--worker-id'],
    role, executor_attempt_id: value['--executor-attempt-id'] ?? null,
    ...(expectedReview ? { review_id: expectedReview.review_id, review_subject: expectedReview.subject } : {}) } }));
  const commandIndex = Number(value['--command-index']);
  const argv = resolved.argv;
  const errors = commandErrors([{ argv }]);
  if (errors.length) throw new ContractError('COMMAND_NOT_DISPATCHABLE');
  return { schema_version: 'lazybuddy.producer-context.v1', project_id: resolved.project_id, run_id: resolved.run_id,
    parent_task_id: resolved.parent_task_id, task_id: resolved.task_id, criterion_id: resolved.criterion_id,
    criterion_version: resolved.criterion_version, attempt_id: value['--attempt-id'], worker_id: value['--worker-id'], revision: resolved.revision,
    plan_revision: resolved.plan_revision, plan_digest: resolved.plan_digest, source_revision: resolved.source_revision,
    plan_commands_file: value['--plan-commands-file'], plan_commands_sha256: resolved.plan_commands_sha256,
    ...(resolved.review ? { review: resolved.review } : {}), command_index: commandIndex, argv, argv_sha256: hash(stableJSON(argv)) };
}
async function contextFromFile(value) {
  if (!value['--context-file']) throw new ContractError('CONTEXT_FILE_REQUIRED');
  const bytes = await readFile(value['--context-file']);
  if (bytes.length > 1024 * 1024) throw new ContractError('CONTEXT_SIZE');
  const context = JSON.parse(bytes);
  const fresh = await createContext({ ...value, '--parent-task-id': context.parent_task_id, '--task-id': context.task_id,
    '--criterion-id': context.criterion_id, '--attempt-id': context.attempt_id, '--worker-id': context.worker_id,
    '--plan-commands-file': context.plan_commands_file ?? value['--plan-commands-file'], '--command-index': String(context.command_index), '--role': context.review?.role ?? value['--role'] }, context.review);
  if (stableJSON(context) !== stableJSON(fresh)) throw new ContractError('DISPATCH_CONTEXT_STALE');
  return context;
}
async function artifactEvidence(root, relative) {
  if (!relative) return [];
  const target = path.resolve(root, relative); const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ContractError('ARTIFACT_OUTSIDE_PROJECT');
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) throw new ContractError('ARTIFACT_UNSAFE');
  return [{ path: rel.split(path.sep).join('/'), sha256: hash(await readFile(target)), provenance: 'actual process artifact' }];
}
function bridgeOptions(value, extra = {}) { return { ...binding(value), ...extra }; }
async function runBounded(value, context, mode) {
  if (context.review && context.review.role !== (mode === 'verify' ? 'verifier' : 'worker')) throw new ContractError('REVIEW_ROLE_MISMATCH');
  await consumeRevision(bridgeOptions(value, { expectedRevision: context.revision, planRevision: context.plan_revision,
    ...(context.review ? { review: { review_id: context.review.review_id, subject: context.review.subject,
      task_id: context.task_id, criterion_id: context.criterion_id, attempt_id: context.attempt_id,
      worker_id: context.worker_id, role: context.review.role, executor_attempt_id: context.review.executor_attempt_id } } : {}) }));
  const contextSha256 = hash(stableJSON(context));
  const work = path.join(value['--project-root'], '.lazybuddy', 'runs', value['--run-id'], 'producer-work', hash(context.attempt_id));
  await mkdir(work, { recursive: true });
  const stdout = path.join(work, 'stdout'); const stderr = path.join(work, 'stderr');
  const resultFile = path.join(work, 'result.json'); const input = path.join(work, 'stdin'); const cwdFile = path.join(work, 'cwd');
  await writeFile(input, '');
  const args = [runner, '--label', context.attempt_id, '--timeout', value['--timeout'] ?? '30', '--result-file', resultFile,
    '--cwd', value['--project-root'], '--cwd-file', cwdFile, '--stdin-file', input, '--stdout-file', stdout, '--stderr-file', stderr];
  if (value['--cancel-file']) args.push('--cancel-file', value['--cancel-file']);
  args.push('--', ...context.argv);
  const startedAt = new Date().toISOString();
  const child = spawn(value['--python'] ?? 'python3', args, { cwd: value['--project-root'], stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const startInvocation = { ...(context.review ? { review: context.review } : {}), attempt_id: context.attempt_id, worker_id: context.worker_id, context_sha256: contextSha256,
    task_id: context.task_id, criterion_id: context.criterion_id, criterion_version: context.criterion_version,
    plan_revision: context.plan_revision, source_revision: context.source_revision, runner_pid: child.pid,
    argv: context.argv, argv_sha256: context.argv_sha256, started_at: startedAt, input_sha256: hash(''),
    role: mode === 'verify' ? 'verifier' : 'worker', session_id: `producer-session:${process.pid}`,
    session_basis: 'process', session_pid: process.pid, command_index: context.command_index };
  let dispatched;
  try {
    dispatched = await publishAttempt(bridgeOptions(value, { attempt: { id: context.attempt_id, task_id: context.task_id, criterion_id: context.criterion_id,
      criterion_version: context.criterion_version, plan_revision: context.plan_revision, consumed_plan_revision: context.plan_revision,
      worker_id: context.worker_id, parent_task_id: context.parent_task_id, source_revision: context.source_revision,
      execution: 'running', verification: mode === 'verify' ? 'verifying' : 'unverified', started_at: startedAt,
      finished_at: null, evidence: [] }, invocation: startInvocation }));
  } catch (error) { child.kill('SIGTERM'); await exited; throw error; }
  const ended = await exited;
  if (ended.error) throw ended.error;
  const finishedAt = new Date().toISOString();
  const [result, stdoutBytes, stderrBytes] = await Promise.all([readFile(resultFile, 'utf8').then(JSON.parse), readFile(stdout), readFile(stderr)]);
  let approved = mode !== 'verify';
  if (mode === 'verify' && ended.code === 0) {
    try { const verdict = JSON.parse(stdoutBytes); approved = verdict?.verdict === 'approved' && Object.keys(verdict).length === 1; } catch { approved = false; }
  }
  const successful = ended.code === 0 && result.status === 'pass' && approved;
  const execution = successful ? 'finished' : (result.status === 'cancelled' ? 'cancelled' : 'failed');
  const trackedPids = result.cleanup?.tracked_pids ?? [];
  const terminal = { ...startInvocation, finished_at: finishedAt, stdout_sha256: hash(stdoutBytes), stderr_sha256: hash(stderrBytes),
    result, tracked_pids: trackedPids, process_exit_code: ended.code, process_signal: ended.signal };
  const evidence = successful ? await artifactEvidence(value['--project-root'], value['--artifact-path']) : [];
  const published = await publishAttempt(bridgeOptions(value, { attempt: { id: context.attempt_id, task_id: context.task_id,
    criterion_id: context.criterion_id, criterion_version: context.criterion_version, plan_revision: context.plan_revision,
    consumed_plan_revision: context.plan_revision, worker_id: context.worker_id, parent_task_id: context.parent_task_id,
    source_revision: context.source_revision, execution, verification: successful ? 'unverified' : 'failed',
    started_at: startedAt, finished_at: finishedAt, evidence }, invocation: terminal }));
  return { context, dispatched, published, terminal, successful, stdout: stdoutBytes.toString('utf8') };
}
async function main(argv) {
  const value = options(argv);
  if (value.action === 'context') {
    return createContext(value);
  }
  const context = await contextFromFile(value);
  const observed = await runBounded(value, context, value.action);
  if (value.action === 'verify' && observed.successful) {
    for (const name of ['--artifact-path', '--executor-id', '--executor-attempt-id']) if (!value[name]) throw new ContractError('MISSING_COMPLETION_ARGUMENT');
    observed.completion = await publishCompletion(bridgeOptions(value, { completion: { task_id: context.task_id,
      criterion_id: context.criterion_id, criterion_version: context.criterion_version, plan_revision: context.plan_revision,
      source_revision: context.source_revision, artifact_path: value['--artifact-path'], executor_id: value['--executor-id'],
      executor_attempt_id: value['--executor-attempt-id'], verifier_id: context.worker_id,
      verifier_attempt_id: context.attempt_id, package_version: packageVersion } }));
  }
  if (!observed.successful) process.exitCode = observed.terminal.process_exit_code || 1;
  return observed;
}

// Native activity observations for the persistent project record. Every fact is
// read back from recorded native evidence (immutable attempt manifests plus the
// run event ledger); this surface schedules nothing and never fabricates
// liveness. An attempt whose dispatch is acknowledged but which has no terminal
// record renders stale once its last observed heartbeat exceeds the caller's
// threshold — never running, never a terminal outcome. Durations come from
// session boundaries and are labeled recorded-session-duration, and
// conversational telemetry this producer does not report stays typed-unavailable.
export const ACTIVITY_OBSERVER = 'dashboard-producer/activity@1';
export const CONVERSATIONAL_TELEMETRY_UNAVAILABLE =
  Object.freeze({ status: 'unavailable', reason: 'NOT_REPORTED_BY_PRODUCER' });
const DURATION_BASIS = 'recorded-session-duration';
const ACTIVITY_SCHEMA = 'lazybuddy.producer-attempt-activity.v1';

async function readOptionalJSON(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function attemptEvents(runRoot) {
  let ledger;
  try { ledger = await readFile(path.join(runRoot, 'canonical-events.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const events = new Map();
  for (const line of ledger.split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line);
    const identity = event.event_id;
    if (typeof identity !== 'string' || !identity.startsWith('producer:')) continue;
    const phase = identity.endsWith(':terminal') ? 'terminal' : identity.endsWith(':start') ? 'start' : null;
    if (!phase) continue;
    const attemptId = identity.slice('producer:'.length, identity.length - (phase === 'start' ? 6 : 9));
    const entry = events.get(attemptId) ?? {};
    entry[phase] = event;
    events.set(attemptId, entry);
  }
  return events;
}

function activityObservation(options, attemptId, payload, contentRevision, reference) {
  return { id: `observation:attempt:${options.runId}:${attemptId}`,
    subject: { kind: 'run', id: options.runId }, classification: 'observed',
    observed_by: ACTIVITY_OBSERVER, observed_at: options.observedAt,
    provenance: { kind: 'native_event', reference }, content_revision: contentRevision ?? null,
    text: JSON.stringify(payload) };
}

async function attemptActivityRecord(options, runRoot, events, attempt, staleAfterMs, asOf) {
  const directory = path.join(runRoot, 'producer-attempts', hash(attempt.attemptId));
  const start = await readOptionalJSON(path.join(directory, 'start.json'));
  const started = events.get(attempt.attemptId)?.start;
  if (!start || !started) throw new ContractError('ACTIVITY_NOT_OBSERVED');
  const terminal = await readOptionalJSON(path.join(directory, 'terminal.json'));
  const terminalEvent = events.get(attempt.attemptId)?.terminal ?? null;
  if (terminal && !terminalEvent) throw new ContractError('ACTIVITY_EVIDENCE_INCONSISTENT');
  const role = start.role ?? 'unreported';
  const interval = { start: start.started_at ?? null, end: terminal?.finished_at ?? null, end_observed: Boolean(terminal) };
  let waiting = null;
  if (attempt.waitingMarker) {
    try {
      const marker = await stat(attempt.waitingMarker);
      waiting = { from: marker.mtime.toISOString(), to: interval.end,
        to_basis: terminal ? 'session-end' : 'unobserved', basis: 'step-marker-file' };
    } catch { waiting = null; }
  }
  const heartbeat = Math.max(Date.parse(started.ts), waiting ? Date.parse(waiting.from) : 0);
  let liveness; let state;
  if (terminal) { liveness = 'terminated'; state = terminalEvent.event_payload.execution; }
  else if (asOf - heartbeat > staleAfterMs) { liveness = 'unknown'; state = 'stale'; }
  else { liveness = 'observed'; state = waiting ? 'waiting' : 'executing'; }
  const commandIndex = Number.isSafeInteger(start.command_index) ? start.command_index : null;
  const payload = { schema_version: ACTIVITY_SCHEMA, role,
    agent: { id: start.worker_id, role },
    session: { id: start.session_id ?? null, basis: start.session_basis ?? 'unreported', pid: start.session_pid ?? null },
    attempt: { id: attempt.attemptId, task_id: start.task_id ?? null, criterion_id: start.criterion_id ?? null,
      criterion_version: start.criterion_version ?? null, plan_revision: start.plan_revision ?? null,
      consumed_plan_revision: start.plan_revision ?? null, resumes_attempt: attempt.resumesAttemptId ?? null,
      resume_relation: attempt.resumesAttemptId ? 'resumed-after' : null,
      resume_basis: attempt.resumesAttemptId ? 'declared-by-dispatcher' : null },
    step: { id: commandIndex === null ? null : `step:${attempt.attemptId}:${commandIndex}`,
      command_index: commandIndex, argv_sha256: start.argv_sha256 ?? null },
    activity: { state, liveness, interval, waiting, duration_basis: DURATION_BASIS,
      live_conversational_agent: false },
    delivery: {
      dispatch: { status: 'published', event_id: started.event_id, published_at: new Date(started.ts).toISOString(),
        manifest: `.lazybuddy/runs/${options.runId}/producer-attempts/${hash(attempt.attemptId)}/start.json` },
      ack: { status: 'observed', runner_pid: start.runner_pid ?? null, acked_at: start.started_at ?? null },
      consumption: terminal ? { status: 'observed', event_id: terminalEvent.event_id,
        result_status: terminal.result?.status ?? null, process_exit_code: terminal.process_exit_code ?? null,
        process_signal: terminal.process_signal ?? null, finished_at: terminal.finished_at ?? null }
        : { status: 'unobserved' },
    },
    conversational_telemetry: CONVERSATIONAL_TELEMETRY_UNAVAILABLE };
  const reference = `run:${options.runId}#producer-attempts/${hash(attempt.attemptId)}` +
    `/${terminal ? 'start+terminal' : 'start'}@${started.event_id}`;
  return activityObservation(options, attempt.attemptId, payload, start.source_revision, reference);
}

function refusalActivityRecord(options, refusal) {
  for (const name of ['attemptId', 'workerId', 'reason', 'refusedAt', 'sessionId']) {
    if (typeof refusal?.[name] !== 'string' || !refusal[name]) throw new ContractError('INVALID_ARGUMENTS');
  }
  if (!['worker', 'verifier'].includes(refusal.role)) throw new ContractError('INVALID_ARGUMENTS');
  const payload = { schema_version: ACTIVITY_SCHEMA, role: refusal.role,
    agent: { id: refusal.workerId, role: refusal.role },
    session: { id: refusal.sessionId, basis: 'process', pid: refusal.sessionPid ?? null },
    attempt: { id: refusal.attemptId, task_id: refusal.taskId ?? null, criterion_id: null,
      criterion_version: null, plan_revision: null, consumed_plan_revision: null,
      resumes_attempt: null, resume_relation: null, resume_basis: null },
    step: { id: null, command_index: null, argv_sha256: null },
    activity: { state: 'blocked', liveness: 'unobserved',
      interval: { start: refusal.refusedAt, end: refusal.refusedAt, end_observed: true },
      waiting: null, duration_basis: DURATION_BASIS, live_conversational_agent: false },
    delivery: { dispatch: { status: 'refused', reason: refusal.reason, refused_at: refusal.refusedAt },
      ack: { status: 'unobserved' }, consumption: { status: 'unobserved' } },
    conversational_telemetry: CONVERSATIONAL_TELEMETRY_UNAVAILABLE };
  return activityObservation(options, refusal.attemptId, payload, null,
    `run:${options.runId}#refusal:${refusal.attemptId}:${refusal.reason}`);
}

// Maps recorded producer activity onto observation inputs for the existing T02
// `recordObservations` route. `attempts` carry the attempt identities whose
// manifests exist; `refusals` carry dispatches the native route refused.
export async function producerAttemptObservations(options) {
  for (const name of ['projectRoot', 'runId', 'observedAt']) {
    if (typeof options?.[name] !== 'string' || !options[name]) throw new ContractError('INVALID_ARGUMENTS');
  }
  if (!Number.isFinite(Date.parse(options.observedAt))) throw new ContractError('INVALID_ARGUMENTS');
  const asOf = Date.parse(options.asOf ?? options.observedAt);
  if (!Number.isFinite(asOf)) throw new ContractError('INVALID_ARGUMENTS');
  const runRoot = path.join(options.projectRoot, '.lazybuddy', 'runs', options.runId);
  const events = await attemptEvents(runRoot);
  const staleAfterMs = options.staleAfterMs ?? 60000;
  const records = [];
  for (const attempt of options.attempts ?? []) {
    if (typeof attempt?.attemptId !== 'string' || !attempt.attemptId) throw new ContractError('INVALID_ARGUMENTS');
    records.push(await attemptActivityRecord(options, runRoot, events, attempt, staleAfterMs, asOf));
  }
  for (const refusal of options.refusals ?? []) records.push(refusalActivityRecord(options, refusal));
  if (!records.length) throw new ContractError('INVALID_ARGUMENTS');
  return records;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch(error => { process.stderr.write(`${error.message ?? error.code}\n`); process.exitCode = 65; });
}
