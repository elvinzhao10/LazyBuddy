import test from 'node:test';
import { queueFixture } from './queue-fixture.mjs';
import { cases } from './queue-cases.mjs';

for (const [name, run] of cases) {
  test(`${name} preserves the queue contract through actual processes`, async () => {
    const f = await queueFixture(name);
    try { await run(f); } finally { await f.cleanup(); }
  });
}
