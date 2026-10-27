import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processCall, plugin, filesBelow } from './command-fixture.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
export const plan = (id = 'one', extra = {}) => ({ id, project_id: 'project:b2', title: `Plan ${id}`, priority: 0,
  readiness: 'ready', prerequisites: [], decision_id: null, revision: 0, ...extra });
export const command = (operation, revision, payload, id = 'one', commandId = `${operation}:${revision}`) => ({
  schema_version: 1, command_id: commandId, target: { project_id: 'project:b2', run_id: null, id }, expected_revision: revision, operation, payload,
});
export function accepted(result) { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout); }
export async function queueFixture(name, evidenceDir) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'b2-queue-')));
  const calls = []; const observations = []; const resources = { root, status: 'active' };
  const artifact = evidenceDir && join(evidenceDir, `${name}.json`);
  const save = async () => { if (artifact) await writeFile(artifact, JSON.stringify({ resources, calls, observations }, null, 2)); };
  await save();
  await mkdir(join(root, '.omo/plans'), { recursive: true });
  const source = '## TODOs\n- [ ] T1: Frozen source plan\n';
  await writeFile(join(root, '.omo/plans/one.md'), source);
  const binding = { projectRoot: root, projectId: 'project:b2', actor: 'chat:b2' };
  async function call(action, request = {}, env = {}, entry = 'queue.mjs', runId = null) {
    const argv = [process.execPath, join(plugin, 'shared/dashboard', entry), action, '--project-root', root,
      '--project-id', binding.projectId, '--actor', binding.actor];
    if (runId) argv.push('--run-id', runId);
    const result = await processCall(argv, JSON.stringify(request), env); calls.push(result); await save(); return result;
  }
  async function capture(label) { const files = await filesBelow(root); observations.push({ label, files }); await save(); return files; }
  const activation = { schema_version: 1, activation_id: 'activation:one', project_id: binding.projectId, plan_id: 'one',
    expected_revision: 1, expected_plan_revision: 0, run_id: 'run-one', source_path: '.omo/plans/one.md', source_sha256: digest(source), objective: 'Frozen objective' };
  async function cleanup() {
    await rm(root, { recursive: true });
    await assert.rejects(access(root)); resources.status = 'removed'; await save();
  }
  return { name, root, binding, source, calls, call, capture, activation, cleanup, artifact,
    queue: join(root, '.lazybuddy/dashboard-queue'),
    create: (id = 'one', revision = 0, extra = {}) => call('command', command('create_queued_plan', revision, { plan: plan(id, extra) }, id)),
    read: async () => accepted(await call('read')),
    persisted: async () => JSON.parse(await readFile(join(root, '.lazybuddy/dashboard-queue/queue.json'), 'utf8')),
  };
}
