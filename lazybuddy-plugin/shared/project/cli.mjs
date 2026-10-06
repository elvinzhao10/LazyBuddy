#!/usr/bin/env node
/** Native Buddy entry point for the persistent, run-independent project record. */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProject, applyProjectCommand } from './model.mjs';
import { assertProjectRegistry } from './contract.mjs';
import { projectSnapshot } from './projection.mjs';

const LIMIT = 8 * 1024 * 1024;
const bridge = fileURLToPath(new URL('../../scripts/state/project-dashboard-bridge.py', import.meta.url));

export class ProjectBridgeError extends Error {
  constructor(code) { super(code); this.name = 'ProjectBridgeError'; this.code = code; }
}

async function inputBytes() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMIT) throw new ProjectBridgeError('INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function inputJSON() {
  try { return JSON.parse((await inputBytes()).toString('utf8')); }
  catch { throw new ProjectBridgeError('INVALID_JSON'); }
}

function invoke(action, options, request) {
  const { projectRoot, projectId, actor } = options;
  if (![projectRoot, projectId, actor].every(value => typeof value === 'string' && value.length > 0)) {
    throw new ProjectBridgeError('INVALID_OPTIONS');
  }
  const input = request === undefined ? '' : Buffer.isBuffer(request) ? request : JSON.stringify(request);
  if (Buffer.byteLength(input) > LIMIT) throw new ProjectBridgeError('INPUT_TOO_LARGE');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [bridge, action, '--project-root', projectRoot, '--project-id', projectId,
      '--actor', actor, '--node', process.execPath], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
    const output = []; const errors = []; let size = 0; let errorSize = 0; let overflow = false;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > LIMIT) { overflow = true; child.kill(); } else output.push(chunk);
    });
    child.stderr.on('data', chunk => { errorSize += chunk.length; if (errorSize <= 4096) errors.push(chunk); });
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => {
      if (overflow) return reject(new ProjectBridgeError('OUTPUT_TOO_LARGE'));
      if (signal) return reject(new ProjectBridgeError('BRIDGE_INTERRUPTED'));
      if (code !== 0) {
        const message = Buffer.concat(errors).toString('utf8').trim();
        return reject(new ProjectBridgeError(/^[A-Z][A-Z0-9_]{0,127}$/.test(message) ? message : 'BRIDGE_FAILED'));
      }
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); }
      catch { reject(new ProjectBridgeError('INVALID_BRIDGE_OUTPUT')); }
    });
    child.stdin.end(input);
  });
}

export const initProject = options => invoke('init', options);
export const readProject = options => invoke('read', options);
export const executeProjectCommand = (options, command) => invoke('command', options, command);

async function main(argv) {
  // Pure reducer entry point. It has no filesystem or native verification authority.
  if (argv.length === 1 && argv[0] === '--reduce') {
    const input = await inputJSON(); let result;
    if (input.action === 'create') result = createProject(input.options);
    else if (input.action === 'command') result = applyProjectCommand(input.state, input.command, input.context);
    else if (input.action === 'snapshot') result = projectSnapshot(input.state, input.context);
    else if (input.action === 'registry') result = assertProjectRegistry(input.registry);
    else throw new ProjectBridgeError('INVALID_REDUCER_ACTION');
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > LIMIT) throw new ProjectBridgeError('OUTPUT_TOO_LARGE');
    process.stdout.write(output + '\n'); return;
  }
  const [action, ...arguments_] = argv;
  if (!['init', 'read', 'command'].includes(action) || arguments_.length !== 6) {
    throw new ProjectBridgeError('USAGE_INIT_READ_COMMAND_PROJECT_ROOT_PROJECT_ID_ACTOR');
  }
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    if (!['--project-root', '--project-id', '--actor'].includes(arguments_[index]) || values.has(arguments_[index])) {
      throw new ProjectBridgeError('INVALID_OPTIONS');
    }
    values.set(arguments_[index], arguments_[index + 1]);
  }
  const options = { projectRoot: values.get('--project-root'), projectId: values.get('--project-id'), actor: values.get('--actor') };
  // Preserve command bytes until the native strict parser can reject duplicate keys.
  const result = await invoke(action, options, action === 'command' ? await inputBytes() : undefined);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code) ? error.code : 'PROJECT_COMMAND_FAILED';
    process.stderr.write(code + '\n'); process.exitCode = 65;
  });
}
