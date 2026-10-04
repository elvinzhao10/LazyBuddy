#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSnapshot, stableJSON, ContractError } from './projection.mjs';
import { readBuddyCompletion } from './adapters/completion.mjs';
import { readInput } from './commands.mjs';
const LIMIT = 8 * 1024 * 1024;
function read(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMIT) throw new ContractError('FILE_SIZE_OR_TYPE');
  return fs.readFileSync(file, 'utf8');
}
function options(argv) {
  const allowed = new Set(['--project-root', '--run-dir', '--project-id', '--host-events', '--hook-events', '--input', '--previous-cursor', '--output', '--cursor-output']);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('--') || Object.hasOwn(result, key)) throw new ContractError('INVALID_ARGUMENTS');
    result[key] = value;
  }
  if (!result['--input'] && (!result['--project-root'] || !result['--run-dir'])) throw new ContractError('PROJECT_AND_RUN_REQUIRED');
  if (result['--input'] && (result['--project-root'] || result['--run-dir'] || result['--host-events'] || result['--hook-events'])) throw new ContractError('AMBIGUOUS_INPUT');
  return result;
}
async function readRun(args) {
  const root = fs.realpathSync(args['--project-root']); const runDir = fs.realpathSync(args['--run-dir']);
  if (path.dirname(runDir) !== path.join(root, '.lazybuddy/runs')) throw new ContractError('RUN_OUTSIDE_PROJECT');
  const input = await readInput({ projectRoot: root, projectId: args['--project-id'] || `project:${Buffer.from(root).toString('hex').slice(-64)}`, runId: path.basename(runDir) });
  for (const [flag, kind] of [['--host-events', 'host'], ['--hook-events', 'hook']]) {
    if (args[flag]) input.sources.push({ kind, id: kind, generation: '1', text: read(args[flag]) });
  }
  const authorityPath = path.relative(root, path.join(runDir, 'completion-authority.json'));
  const packageVersion = JSON.parse(read(fileURLToPath(new URL('../../tooling/package.json', import.meta.url)))).version;
  const proof = readBuddyCompletion(root, { authorityPath, packageVersion });
  return { input, proof };
}
export async function main(argv) {
  try {
    const args = options(argv);
    const { input, proof } = args['--input'] ? { input: JSON.parse(read(args['--input'])), proof: undefined } : await readRun(args);
    if (args['--previous-cursor']) input.previous_cursor = JSON.parse(read(args['--previous-cursor']));
    const snapshot = projectSnapshot(input, proof);
    const output = `${stableJSON(snapshot)}\n`;
    if (args['--output']) fs.writeFileSync(args['--output'], output); else process.stdout.write(output);
    if (args['--cursor-output']) fs.writeFileSync(args['--cursor-output'], `${stableJSON(snapshot.cursor)}\n`);
    if (snapshot.freshness !== 'snapshot') {
      process.stderr.write(`${JSON.stringify({ status: 'rejected', code: 'RESYNC_REQUIRED', issues: snapshot.issues })}\n`); return 65;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'rejected', code: error instanceof ContractError ? error.code : 'INPUT_READ_ERROR' })}\n`);
    return 65;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
