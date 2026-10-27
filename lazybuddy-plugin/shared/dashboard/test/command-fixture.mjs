import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const plugin = fileURLToPath(new URL('../../../', import.meta.url));
export const cli = join(plugin, 'shared/dashboard/commands.mjs');
export function processCall(argv, input = '', environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', 'exec "$@"', 'dashboard-test', ...argv], { env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ argv, input, environment, code, signal, stdout, stderr }); });
    child.stdin.end(input);
  });
}
export async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'b1-authority-')));
  const run = join(root, '.lazybuddy/runs/probe');
  const created = await processCall(['bash', join(plugin, 'scripts/state/create-run.sh'), 'probe', 'B1 actual CLI probe'], '', { CWD: root });
  if (created.code !== 0) throw new Error(JSON.stringify(created));
  const state = JSON.parse(await readFile(join(run, 'state.json'), 'utf8'));
  const criterion = { id: 'C1', task_id: 'T1', version: 1, requirement: 'Original requirement', applicability: 'required',
    verification: 'verified', scenarios: [], result_ids: ['original-result'], history: [] };
  state.tasks = [{ id: 'T1', title: 'First task', scope: 'First scope', priority: 0, status: 'done', depends_on: [], criteria: [criterion], evidence: ['proof.txt'] },
    { id: 'T2', title: 'Dependent', scope: 'Dependent scope', priority: 0, status: 'queued', depends_on: ['T1'], criteria: [{ ...criterion, id: 'C2', task_id: 'T2' }] },
    { id: 'T3', title: 'Unrelated', scope: 'Unrelated scope', priority: 0, status: 'done', depends_on: [], criteria: [{ ...criterion, id: 'C3', task_id: 'T3' }] }];
  state.plan_reference = '.lazybuddy/runs/probe/plan.md'; state.plan_revision = 1;
  await writeFile(join(root, 'proof.txt'), 'Original artifact\n');
  await writeFile(join(run, 'state.json'), JSON.stringify(state));
  await writeFile(join(run, 'plan.md'), '## TODOs\n- [x] T1: First task\n- [ ] T2: Dependent\n- [x] T3: Unrelated\n');
  const options = { projectRoot: root, projectId: 'project:b1', runId: 'probe', actor: 'cli:b1' };
  const revision = Number(await readFile(join(run, '.revision'), 'utf8'));
  const calls = [created];
  async function call(action, value = {}, env = {}) {
    const argv = [process.execPath, cli, action, '--project-root', root, '--project-id', options.projectId, '--run-id', 'probe', '--actor', options.actor];
    const result = await processCall(argv, JSON.stringify(value), env); calls.push(result); return result;
  }
  return { root, run, options, revision, calls, call, cleanup: () => rm(root, { recursive: true }) };
}
export function amendment(revision, id = 'edit:1') {
  return { schema_version: 1, command_id: id, target: { project_id: 'project:b1', run_id: 'probe', id: 'T1' }, expected_revision: revision,
    operation: 'amend_criterion', payload: { criterion_id: 'C1', expected_version: 1, requirement: 'New requirement' } };
}
export async function filesBelow(root) {
  const values = {};
  async function visit(path, relative = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), name);
      else if (entry.isFile()) values[name] = await readFile(join(path, entry.name), 'utf8');
    }
  }
  await visit(root); return values;
}
