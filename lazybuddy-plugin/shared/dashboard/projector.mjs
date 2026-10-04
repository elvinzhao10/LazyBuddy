#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSnapshot, stableJSON, ContractError } from './projection.mjs';
import { requireRevision } from './contracts/parse.mjs';
import { readBuddyCompletion } from './adapters/completion.mjs';
const LIMIT = 8 * 1024 * 1024;
function read(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMIT) throw new ContractError('FILE_SIZE_OR_TYPE');
  return fs.readFileSync(file, 'utf8');
}
function optional(file) {
  try { return read(file); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
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
function readRun(args) {
  const root = fs.realpathSync(args['--project-root']); const runDir = fs.realpathSync(args['--run-dir']);
  if (!runDir.startsWith(`${root}${path.sep}`)) throw new ContractError('RUN_OUTSIDE_PROJECT');
  const journal = path.join(runDir, '.transaction-journal');
  if (fs.existsSync(journal)) throw new ContractError('TRANSACTION_PENDING');
  const revisionText = read(path.join(runDir, '.revision')).trim();
  if (!/^\d+$/.test(revisionText)) throw new ContractError('INVALID_COMMITTED_REVISION');
  const revision = requireRevision(Number(revisionText));
  const state = JSON.parse(read(path.join(runDir, 'state.json')));
  const sources = [ ['runtime', 'canonical-events.jsonl'], ['legacy', 'events.jsonl'] ].map(([kind, file]) => ({
    kind, id: kind, generation: '1', text: optional(path.join(runDir, file)),
  }));
  for (const [flag, kind] of [['--host-events', 'host'], ['--hook-events', 'hook']]) {
    if (args[flag]) sources.push({ kind, id: kind, generation: '1', text: read(args[flag]) });
  }
  const authorityPath = path.relative(root, path.join(runDir, 'completion-authority.json'));
  const packageVersion = JSON.parse(read(fileURLToPath(new URL('../../tooling/package.json', import.meta.url)))).version;
  const proof = readBuddyCompletion(root, { authorityPath, packageVersion });
  const authorityText = optional(path.join(root, authorityPath));
  const authority = authorityText ? JSON.parse(authorityText) : null;
  if (fs.existsSync(journal) || read(path.join(runDir, '.revision')).trim() !== revisionText) throw new ContractError('STATE_CHANGED_DURING_READ');
  return { input: { project_id: args['--project-id'] || `project:${Buffer.from(root).toString('hex').slice(-64)}`,
    run_id: state.run_id, revision, plan_revision: state.plan_revision ?? 0,
    source_revision: authority?.repo_head ?? null, plan_digest: authority?.plan?.sha256 ?? null, state, sources }, proof };
}
export function main(argv) {
  try {
    const args = options(argv);
    const { input, proof } = args['--input'] ? { input: JSON.parse(read(args['--input'])), proof: undefined } : readRun(args);
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
