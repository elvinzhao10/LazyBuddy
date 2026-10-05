import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture, amendment, processCall, plugin, filesBelow } from '../test/command-fixture.mjs';
import { projectSnapshot } from '../trusted-projection.mjs';
import { readInput } from '../commands.mjs';
const destination = resolve(process.argv[2]);
const f = await fixture();
const records = { source: await processCall(['git', 'rev-parse', 'HEAD']), root: f.root };
await writeFile(destination, JSON.stringify({ ...records, cleanup: 'pending' }, null, 2));
try {
  const attempt = { id: 'attempt:unrelated', task_id: 'T3', criterion_id: 'C3', criterion_version: 1,
    plan_revision: 1, consumed_plan_revision: 1, worker_id: 'worker:3', parent_task_id: 'T3', source_revision: 'source:1',
    execution: 'finished', verification: 'failed', started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T10:01:00Z', evidence: [] };
  records.producer = await processCall(['bash', join(plugin, 'scripts/state/append-event.sh'), 'probe', 'attempt_result', JSON.stringify(attempt)], '', { CWD: f.root });
  const before = await readInput(f.options);
  records.before = projectSnapshot(before);
  records.command = await f.call('command', amendment(before.revision));
  const after = await readInput(f.options);
  records.after = projectSnapshot(after);
  records.plain = projectSnapshot(JSON.parse(JSON.stringify(after)));
  records.persisted = await filesBelow(f.run);
  records.observable = { before: records.before.tasks[2].criteria[0].verification, after: records.after.tasks[2].criteria[0].verification,
    plain: records.plain.tasks[2].criteria[0].verification };
  console.log(JSON.stringify(records.observable));
} finally {
  await f.cleanup(); records.cleanup = 'owned temporary project removed';
  await writeFile(destination, JSON.stringify(records, null, 2));
}
