#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const evidence = process.argv[2]; const node18 = process.argv[3];
if (!evidence || !node18) throw new Error('usage: ui-queue-edit-checks.mjs EVIDENCE_DIR NODE18');
const root = new URL('../../../', import.meta.url).pathname; const node24 = process.execPath;
const sources = ['shared/dashboard/ui/editing.mjs', 'shared/dashboard/test/ui-live-bindings.test.mjs', 'shared/dashboard/qa/ui-live-browser.mjs',
  'shared/dashboard/qa/ui-queue-edit-browser.mjs', 'shared/dashboard/qa/ui-queue-edit-checks.mjs'];
const runs = [];
function run(label, argv) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: join(root, '..'), encoding: 'utf8', timeout: 30000 });
  runs.push({ label, argv, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error(`${label} failed`);
}
run('node24-focused', [node24, '--test', 'lazybuddy-plugin/shared/dashboard/test/ui-live-bindings.test.mjs']);
run('node18-focused', [node18, 'lazybuddy-plugin/shared/dashboard/test/ui-live-bindings.test.mjs']);
for (const source of sources.filter(path => path.endsWith('.mjs'))) run(`syntax:${source}`, [node24, '--check', `lazybuddy-plugin/${source}`]);
run('diff-check', ['git', 'diff', '--check']);
const sha256 = {};
for (const source of sources) sha256[source] = createHash('sha256').update(await readFile(join(root, source))).digest('hex');
await writeFile(join(evidence, 'validation-manifest.json'), `${JSON.stringify({ source_base: '907785f7597d5e4b368fd63bb695a99e45f84879', runs, sha256 }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'pass', runs: runs.length, files: sources.length })}\n`);
