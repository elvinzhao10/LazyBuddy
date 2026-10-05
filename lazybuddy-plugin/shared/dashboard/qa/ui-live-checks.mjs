import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const evidence = process.argv[2]; const node18 = process.argv[3];
if (!evidence || !node18) throw new Error('usage: ui-live-checks.mjs EVIDENCE_DIR NODE18');
const node24 = process.execPath; const python = '/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin';
const env = { ...process.env, PATH: `${new URL('.', `file://${node24}`).pathname}:${python}:/usr/bin:/bin` };
const tests = ['lazybuddy-plugin/shared/dashboard/test/ui-live-bindings.test.mjs', 'lazybuddy-plugin/shared/dashboard/test/ui-components.test.mjs', 'lazybuddy-plugin/shared/dashboard/test/service-live-ui.test.mjs'];
const sources = ['mcp/status-dashboard/server.sh', 'shared/dashboard/SERVICE.md', 'shared/dashboard/service-http.mjs', 'shared/dashboard/service-lifecycle.mjs', 'shared/dashboard/service-snapshot.mjs',
  'shared/dashboard/service.mjs', 'shared/dashboard/qa/port-restart-baseline.mjs', 'shared/dashboard/qa/ui-live-browser.mjs', 'shared/dashboard/qa/ui-live-checks.mjs', 'shared/dashboard/qa/ui-live-focus-browser.mjs',
  'shared/dashboard/test/service-fixture.mjs', 'shared/dashboard/test/service-live-ui.test.mjs', 'shared/dashboard/test/ui-live-bindings.test.mjs',
  'shared/dashboard/ui/asset-manifest.json', 'shared/dashboard/ui/components.mjs', 'shared/dashboard/ui/connection.mjs', 'shared/dashboard/ui/editing.mjs', 'shared/dashboard/ui/index.html',
  'shared/dashboard/ui/index.mjs', 'shared/dashboard/ui/inspector-view.mjs', 'shared/dashboard/ui/live.css', 'shared/dashboard/ui/verification-view.mjs', 'shared/dashboard/ui/work-view.mjs'];
const runs = [];
function run(label, binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', env, timeout: 120000 });
  const record = { label, argv: [binary, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }; runs.push(record);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}
run('node24-focused', node24, ['--test', ...tests]);
for (const file of tests) run(`node18:${file.split('/').at(-1)}`, node18, [file]);
for (const file of sources.filter(file => file.endsWith('.mjs'))) run(`syntax:${file}`, node24, ['--check', `lazybuddy-plugin/${file}`]);
run('shell-syntax', 'bash', ['-n', 'lazybuddy-plugin/mcp/status-dashboard/server.sh']);
run('diff-check', 'git', ['diff', '--check']); run('status', 'git', ['status', '--short']);
const hashes = {};
for (const file of sources) hashes[file] = createHash('sha256').update(await readFile(`lazybuddy-plugin/${file}`)).digest('hex');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
await writeFile(`${evidence}/validation-manifest.json`, `${JSON.stringify({ source_head: head, runs, sha256: hashes }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'pass', source_head: head, runs: runs.length, files: sources.length })}\n`);
