import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { queueFixture } from '../test/queue-fixture.mjs';
import { corruptions, receiptCorruption, savedReceipt } from '../test/queue-receipts.mjs';
import { processCall, plugin } from '../test/command-fixture.mjs';

if (process.argv[2] !== '--evidence-dir' || !process.argv[3] || process.argv.length > 5 || (process.argv[4] && process.argv[4] !== '--baseline')) throw new Error('usage: --evidence-dir PATH [--baseline]');
const baseline = process.argv[4] === '--baseline';
const evidence = resolve(process.argv[3]); await mkdir(evidence, { recursive: true });
const source = await processCall(['git', '-C', resolve(plugin, '..'), 'rev-parse', 'HEAD']);
const sourceStatus = await processCall(['git', '-C', resolve(plugin, '..'), 'status', '--porcelain']);
const variants = baseline ? corruptions.slice(0, 2) : corruptions;
const cases = variants.map(([name, mutate]) => [name, f => receiptCorruption(f, { mutate, baseline })]);
if (!baseline) cases.push(['valid-saved', savedReceipt]);
const outcomes = [];
for (const [name, run] of cases) {
  const f = await queueFixture(`receipt-${name}`, evidence);
  try { await run(f); outcomes.push({ name, status: baseline ? 'defect_reproduced' : 'passed', artifact: f.artifact }); }
  catch (error) { outcomes.push({ name, status: 'failed', error: error.stack, artifact: f.artifact }); throw error; }
  finally {
    await f.cleanup();
    await writeFile(join(evidence, 'receipt-manifest.json'), JSON.stringify({ source, sourceStatus, binary: process.execPath, outcomes }, null, 2));
  }
}
console.log(JSON.stringify({ baseline, scenarios: outcomes.length, outcomes: outcomes.map(item => item.status) }));
