/** Exercise a real existing queue activation, then link it without rewriting native authority. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { queueFixture, accepted, digest } from '../../dashboard/test/queue-fixture.mjs';
import { filesBelow } from '../../dashboard/test/command-fixture.mjs';
import { initProject, executeProjectCommand, readProject } from '../cli.mjs';

const fixture = await queueFixture('project-native-identity');
try {
  accepted(await fixture.create());
  accepted(await fixture.call('activate', fixture.activation));
  const beforeRuns = await filesBelow(join(fixture.root, '.lazybuddy/runs'));
  const beforeQueue = await filesBelow(join(fixture.root, '.lazybuddy/dashboard-queue'));
  const options = { projectRoot: fixture.root, projectId: 'project:durable', actor: 'local:project-test' };
  let snapshot = await initProject(options);
  const apply = async (operation, payload) => {
    const command = { schema_version: 1, command_id: `cmd:${snapshot.revision + 1}`, project_id: options.projectId,
      expected_revision: snapshot.revision, operation, payload };
    const result = await executeProjectCommand(options, command);
    assert.equal(result.receipt.status, 'saved'); snapshot = result.snapshot;
  };
  await apply('register_source', { id: 'source:one', path: '.omo/plans/one.md', role: 'plan' });
  await apply('register_plan', { id: 'plan:one', source: { source_id: 'source:one', sha256: digest(fixture.source), anchor_id: 'document' },
    declared_lifecycle: 'active', baseline_refs: [] });
  await apply('link_native_run', { plan_id: 'plan:one', native_project_id: 'project:b2', run_id: 'run-one' });
  snapshot = await readProject(options);
  assert.equal(snapshot.plans[0].native_runs[0].native_project_id, 'project:b2');
  assert.equal(snapshot.plans[0].native_runs[0].run_id, 'run-one');
  assert.deepEqual(snapshot.plans[0].native_observations, []);
  assert.deepEqual(await filesBelow(join(fixture.root, '.lazybuddy/runs')), beforeRuns);
  assert.deepEqual(await filesBelow(join(fixture.root, '.lazybuddy/dashboard-queue')), beforeQueue);
  process.stdout.write(JSON.stringify({ result: 'passed', nativeRunCreatedBy: 'queue activation CLI',
    projectId: snapshot.project_id, nativeProjectId: 'project:b2', nativeRunId: 'run-one', revision: snapshot.revision,
    nativeRunFileCount: Object.keys(beforeRuns).length, nativeQueueFileCount: Object.keys(beforeQueue).length,
    nativeBytesUnchanged: true, executionObserved: false, verificationGranted: false }) + '\n');
} finally {
  await fixture.cleanup();
}
