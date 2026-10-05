import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContractError, parseContract } from './contracts/parse.mjs';
import { reduceQueue } from './queue-reducer.mjs';

const bridge = fileURLToPath(new URL('../../scripts/state/queue-bridge.py', import.meta.url));
const limit = 8 * 1024 * 1024;
export function queueBridge(action, options, request = {}) {
  const argv = [bridge, action, '--project-root', options.projectRoot, '--project-id', options.projectId,
    '--actor', options.actor ?? 'reader', '--node', options.node ?? process.execPath];
  if (options.runId) argv.push('--run-id', options.runId);
  if (argv.some(value => typeof value !== 'string' || !value)) throw new ContractError('MISSING_ADAPTER_BINDING');
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > limit) throw new ContractError('INPUT_TOO_LARGE');
  return new Promise((resolve, reject) => {
    const child = spawn(options.python ?? 'python3', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let overflow = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    const capture = (field, data) => {
      if (field === 'out') stdout += data; else stderr += data;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > limit) { overflow = true; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', data => capture('out', data)); child.stderr.on('data', data => capture('err', data));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || overflow) { reject(new ContractError(overflow ? 'BRIDGE_OUTPUT_LIMIT' : stderr.trim() || `BRIDGE_EXIT_${code}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new ContractError('INVALID_BRIDGE_OUTPUT')); }
    });
    child.stdin.end(input);
  });
}
export function executeQueueCommand(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return queueBridge('command', options, parseContract('command', options.command));
}
export function readQueue(options) { return queueBridge('read', options); }
export function activateQueuedPlan(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return queueBridge('activate', options, parseContract('activation', options.activation));
}
export function recoverActivation(options) {
  if (!options.actor) throw new ContractError('TRUSTED_ACTOR_REQUIRED');
  return queueBridge('recover', options, { activation_id: options.activationId });
}
async function stdin() {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; if (length > limit) throw new ContractError('INPUT_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function main(argv) {
  const [action, ...args] = argv;
  if (action === '--reduce') return reduceQueue(await stdin());
  const names = { '--project-root': 'projectRoot', '--project-id': 'projectId', '--actor': 'actor', '--python': 'python', '--run-id': 'runId' };
  const options = {};
  if (args.length % 2) throw new ContractError('INVALID_ARGV');
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]];
    if (!key || options[key]) throw new ContractError('INVALID_ARGV'); options[key] = args[i + 1];
  }
  switch (action) {
    case 'read': return readQueue(options);
    case 'command': return executeQueueCommand({ ...options, command: await stdin() });
    case 'activate': return activateQueuedPlan({ ...options, activation: await stdin() });
    case 'recover': { const request = await stdin(); if (Object.keys(request).join() !== 'activation_id') throw new ContractError('INVALID_RECOVERY'); return recoverActivation({ ...options, activationId: request.activation_id }); }
    default: throw new ContractError('UNKNOWN_ACTION');
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 65; });
}
