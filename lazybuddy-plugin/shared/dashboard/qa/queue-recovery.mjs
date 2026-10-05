import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { queueFixture } from '../test/queue-fixture.mjs';
import { cases } from '../test/queue-cases.mjs';
import { processCall, plugin } from '../test/command-fixture.mjs';

if (process.argv.length !== 4 || process.argv[2] !== '--evidence-dir') throw new Error('usage: --evidence-dir PATH');
const evidence = resolve(process.argv[3]); await mkdir(evidence, { recursive: true });
const source = await processCall(['git', '-C', resolve(plugin, '..'), 'rev-parse', 'HEAD']);
const sourceStatus = await processCall(['git', '-C', resolve(plugin, '..'), 'status', '--porcelain']);
const outcomes = [];
for (const [name, run] of cases) {
  const f = await queueFixture(name, evidence);
  try { await run(f); outcomes.push({ name, status: 'passed', artifact: f.artifact }); }
  catch (error) { outcomes.push({ name, status: 'failed', error: error.stack, artifact: f.artifact }); throw error; }
  finally {
    await f.cleanup();
    await writeFile(join(evidence, 'manual-queue.json'), JSON.stringify({ source, sourceStatus, binary: process.execPath, outcomes }, null, 2));
  }
}
console.log(JSON.stringify({ scenarios: outcomes.length, failed: outcomes.filter(item => item.status !== 'passed').length }));
