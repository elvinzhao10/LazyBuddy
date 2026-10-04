import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = process.argv[2];
if (!evidenceDir) throw new Error('Usage: node ui-components-checks.mjs EVIDENCE_DIR');
const dashboard = dirname(dirname(fileURLToPath(import.meta.url)));
const worktree = dirname(dirname(dirname(dashboard)));
const node24 = process.execPath;
const node18 = process.argv[3];
if (!node18) throw new Error('Node 18 executable path is required as argument 3');
const testFile = join(dashboard, 'test/ui-components.test.mjs');
const modules = ['graph-layout.mjs', 'work-view.mjs', 'verification-view.mjs', 'inspector-view.mjs', 'component-demo.mjs'].map(name => join(dashboard, 'ui', name));
const checks = [];
await mkdir(evidenceDir, { recursive: true });
function run({ name, executable, args }) {
  const result = spawnSync(executable, args, { cwd: worktree, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  checks.push({ name, executable, args, exit: result.status, signal: result.signal, error: result.error?.code ?? null, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, `${name}\n${result.stderr}`);
}
run({ name: 'node24 component tests', executable: node24, args: ['--test', testFile] });
run({ name: 'node18 direct component tests', executable: node18, args: [testFile] });
for (const file of [...modules, fileURLToPath(import.meta.url)]) run({ name: `node18 syntax ${file.split('/').at(-1)}`, executable: node18, args: ['--check', file] });
run({ name: 'git diff check', executable: 'git', args: ['diff', '--check', 'HEAD'] });
run({ name: 'source head', executable: 'git', args: ['rev-parse', 'HEAD'] });
await writeFile(join(evidenceDir, 'component-checks.json'), `${JSON.stringify({ checks }, null, 2)}\n`);
