import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseContract, ContractError } from './contracts/parse.mjs';
import { reduceCommand } from './command-reducer.mjs';
import { executeQueueCommand, queueBridge } from './queue.mjs';
import { authorityBinding, captureRevisionCompatibility } from './revision-compatibility.mjs';

const bridge = fileURLToPath(new URL('../../scripts/state/dashboard-bridge.py', import.meta.url));
const limit = 8 * 1024 * 1024;
const completionCaptures = new WeakMap();
function invoke(action, options, value = {}) {
  const argv = [bridge, action, '--project-root', options.projectRoot, '--project-id', options.projectId,
    '--run-id', options.runId, '--actor', options.actor ?? 'reader', '--node', options.node ?? process.execPath];
  if (argv.some(item => typeof item !== 'string' || !item)) return Promise.reject(new ContractError('MISSING_ADAPTER_BINDING'));
  return new Promise((resolve, reject) => {
    const child = spawn(options.python ?? 'python3', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let overflow = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 45000);
    child.stdout.on('data', data => { stdout += data; if (Buffer.byteLength(stdout) > limit) { overflow = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', data => { stderr += data; if (Buffer.byteLength(stderr) > limit) { overflow = true; child.kill('SIGKILL'); } });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || overflow) { reject(new ContractError(overflow ? 'BRIDGE_OUTPUT_LIMIT' : (stderr.trim() || `BRIDGE_EXIT_${code}`))); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new ContractError('INVALID_BRIDGE_OUTPUT')); }
    });
    child.stdin.end(JSON.stringify(value));
  });
}
export function executeCommand(options) {
  const command = parseContract('command', options.command);
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  if (command.target.run_id === null) return executeQueueCommand({ ...options, command });
  return invoke('command', options, command);
}
export async function readInput(options) {
  const input = await queueBridge('snapshot', options);
  const bundle = input._completion_capture;
  delete input._completion_capture;
  completionCaptures.set(input, { bundle, binding: authorityBinding(input), state: input.state });
  captureRevisionCompatibility(input);
  return input;
}
export function capturedCompletion(input) {
  const captured = completionCaptures.get(input);
  return captured && captured.state === input.state && captured.binding === authorityBinding(input)
    ? structuredClone(captured.bundle) : null;
}
export function consumeRevision(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return invoke('consume', options, { expected_revision: options.expectedRevision, plan_revision: options.planRevision });
}
export function publishAttempt(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return invoke('attempt', options, { attempt: options.attempt, invocation: options.invocation });
}
export function publishCompletion(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return invoke('complete', options, options.completion);
}
export function readProducerContext(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return invoke('producer-context', options, options.request);
}
async function stdin() {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; if (length > limit) throw new ContractError('INPUT_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function main(argv) {
  if (argv[0] === '--reduce') return reduceCommand(await stdin());
  const [action, ...args] = argv;
  const names = { '--project-root': 'projectRoot', '--project-id': 'projectId', '--run-id': 'runId', '--actor': 'actor', '--python': 'python' };
  const options = {};
  if (args.length % 2) throw new ContractError('INVALID_ARGV');
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    if (!key || options[key]) throw new ContractError('INVALID_ARGV'); options[key] = args[index + 1];
  }
  switch (action) {
    case 'command': return executeCommand({ ...options, command: await stdin() });
    case 'read': return readInput(options);
    case 'consume': { const value = await stdin(); return consumeRevision({ ...options, expectedRevision: value.expected_revision, planRevision: value.plan_revision }); }
    default: throw new ContractError('UNKNOWN_ACTION');
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 65; });
}
