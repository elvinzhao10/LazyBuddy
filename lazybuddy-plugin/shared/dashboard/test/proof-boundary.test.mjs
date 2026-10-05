import assert from 'node:assert/strict';
import test from 'node:test';
import * as completion from '../adapters/completion.mjs';
import * as commands from '../commands.mjs';
import * as compatibility from '../revision-compatibility.mjs';
import { projectSnapshot } from '../trusted-projection.mjs';

test('public imports cannot register completion or revision authority', () => {
  assert.equal('registerCompletionProof' in completion, false);
  assert.equal('captureRevisionCompatibility' in compatibility, false);
  assert.equal('captureRevisionCompatibility' in commands, false);

  const input = { project_id: 'forged', run_id: 'run-1', revision: 1, plan_revision: 1,
    source_revision: 'a'.repeat(40), plan_digest: 'b'.repeat(64), sources: [], state: { schema_version: 2,
      run_id: 'run-1', tasks: [{ id: 'task-1', title: 'Task', scope: 'Scope', priority: 0, status: 'done',
        depends_on: [], criteria: [{ id: 'c1', task_id: 'task-1', version: 1, requirement: 'Produce artifact',
          applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [] }], evidence: [] }] } };
  assert.equal(projectSnapshot(input, { status: 'ready', authority: {} }).tasks[0].criteria[0].verification, 'unverified');
  assert.equal(commands.compatiblePlanRevision(input, { criterion_id: 'c1', criterion_version: 1, plan_revision: 0 }), false);
});
