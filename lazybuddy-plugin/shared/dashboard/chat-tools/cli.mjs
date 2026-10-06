#!/usr/bin/env node
/** MCP host entry for the shared project chat tool surface (T20). Reads the
 * typed tool request JSON (command_id/expected_revision/payload) from stdin and
 * prints one JSON line. Typed results (ok/valid/invalid/conflict/
 * not_initialized) exit 0; usage failures exit 65 with an UPPER_SNAKE code. */
import { pathToFileURL } from 'node:url';
import { executeProjectTool, CHAT_TOOL_ACTIONS } from './tools.mjs';
import { ProjectBridgeError } from '../../project/cli.mjs';

const LIMIT = 1024 * 1024;

async function stdinJSON() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > LIMIT) throw new ProjectBridgeError('INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new ProjectBridgeError('INVALID_JSON'); }
}

async function main(argv) {
  const names = { '--project-root': 'projectRoot', '--project-id': 'projectId', '--actor': 'actor', '--action': 'action' };
  if (argv.length % 2) throw new ProjectBridgeError('INVALID_OPTIONS');
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    if (!key || options[key]) throw new ProjectBridgeError('INVALID_OPTIONS');
    options[key] = argv[index + 1];
  }
  for (const key of ['projectRoot', 'projectId', 'actor', 'action']) {
    if (typeof options[key] !== 'string' || !options[key]) throw new ProjectBridgeError('INVALID_OPTIONS');
  }
  if (!CHAT_TOOL_ACTIONS.includes(options.action)) throw new ProjectBridgeError('UNKNOWN_CHAT_TOOL_ACTION');
  const request = await stdinJSON();
  const response = await executeProjectTool({ ...options, request });
  const output = JSON.stringify(response);
  if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new ProjectBridgeError('OUTPUT_TOO_LARGE');
  process.stdout.write(output + '\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code) ? error.code : 'CHAT_TOOL_FAILED';
    process.stderr.write(code + '\n'); process.exitCode = 65;
  });
}
