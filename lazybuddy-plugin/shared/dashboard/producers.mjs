#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
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
  '--artifact-path', '--executor-id', '--executor-attempt-id', '--cancel-file', '--python', '--timeout']);

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
async function createContext(value) {
  for (const name of ['--parent-task-id', '--task-id', '--criterion-id', '--attempt-id', '--worker-id', '--plan-commands-file', '--command-index'])
    if (!value[name]) throw new ContractError('MISSING_CONTEXT_ARGUMENT');
  const resolved = await readProducerContext(bridgeOptions(value, { request: { parent_task_id: value['--parent-task-id'],
    task_id: value['--task-id'], criterion_id: value['--criterion-id'], plan_commands_file: value['--plan-commands-file'],
    command_index: Number(value['--command-index']) } }));
  const commandIndex = Number(value['--command-index']);
  const argv = resolved.argv;
  const errors = commandErrors([{ argv }]);
  if (errors.length) throw new ContractError('COMMAND_NOT_DISPATCHABLE');
  return { schema_version: 'lazybuddy.producer-context.v1', project_id: resolved.project_id, run_id: resolved.run_id,
    parent_task_id: resolved.parent_task_id, task_id: resolved.task_id, criterion_id: resolved.criterion_id,
    criterion_version: resolved.criterion_version, attempt_id: value['--attempt-id'], worker_id: value['--worker-id'], revision: resolved.revision,
    plan_revision: resolved.plan_revision, plan_digest: resolved.plan_digest, source_revision: resolved.source_revision,
    plan_commands_file: value['--plan-commands-file'], plan_commands_sha256: resolved.plan_commands_sha256,
    command_index: commandIndex, argv, argv_sha256: hash(stableJSON(argv)) };
}
async function contextFromFile(value) {
  if (!value['--context-file']) throw new ContractError('CONTEXT_FILE_REQUIRED');
  const bytes = await readFile(value['--context-file']);
  if (bytes.length > 1024 * 1024) throw new ContractError('CONTEXT_SIZE');
  const context = JSON.parse(bytes);
  const fresh = await createContext({ ...value, '--parent-task-id': context.parent_task_id, '--task-id': context.task_id,
    '--criterion-id': context.criterion_id, '--attempt-id': context.attempt_id, '--worker-id': context.worker_id,
    '--plan-commands-file': context.plan_commands_file ?? value['--plan-commands-file'], '--command-index': String(context.command_index) });
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
  await consumeRevision(bridgeOptions(value, { expectedRevision: context.revision, planRevision: context.plan_revision }));
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
  const startInvocation = { attempt_id: context.attempt_id, worker_id: context.worker_id, context_sha256: contextSha256,
    task_id: context.task_id, criterion_id: context.criterion_id, criterion_version: context.criterion_version,
    plan_revision: context.plan_revision, source_revision: context.source_revision, runner_pid: child.pid,
    argv: context.argv, argv_sha256: context.argv_sha256, started_at: startedAt, input_sha256: hash('') };
  try {
    await publishAttempt(bridgeOptions(value, { attempt: { id: context.attempt_id, task_id: context.task_id, criterion_id: context.criterion_id,
      criterion_version: context.criterion_version, plan_revision: context.plan_revision, consumed_plan_revision: context.plan_revision,
      worker_id: context.worker_id, parent_task_id: context.parent_task_id, source_revision: context.source_revision,
      execution: 'running', verification: mode === 'verify' ? 'verifying' : 'unverified', started_at: startedAt,
      finished_at: null, evidence: [] }, invocation: startInvocation }));
  } catch (error) { child.kill('SIGTERM'); throw error; }
  const ended = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
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
  return { context, published, terminal, successful, stdout: stdoutBytes.toString('utf8') };
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
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch(error => { process.stderr.write(`${error.message ?? error.code}\n`); process.exitCode = 65; });
}
