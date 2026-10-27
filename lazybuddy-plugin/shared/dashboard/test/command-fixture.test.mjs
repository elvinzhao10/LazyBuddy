import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processCall } from './command-fixture.mjs';

test('processCall preserves quoted script paths, arguments, input and environment as data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'quotes \'" \\ $(exit 91) `exit 92`');
  await mkdir(directory);
  const script = join(directory, 'fixture \'" \\.sh');
  await writeFile(script, 'printf "%s\\n" "$1" "$FIXTURE_VALUE"; cat; printf "%s" "$2" >&2; exit 7\n');
  const value = 'literal \'" \\ $(exit 93); `exit 94`';

  const result = await processCall(['bash', script, value, 'stderr'], 'stdin\n', { FIXTURE_VALUE: value });

  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, `${value}\n${value}\nstdin\n`);
  assert.equal(result.stderr, 'stderr');
});

test('processCall preserves direct executable argv and signal termination', async () => {
  const value = 'literal \'" \\ $(exit 95); `exit 96`';

  const result = await processCall([process.execPath, '-e',
    'process.stdout.write(process.argv[1]); process.kill(process.pid, "SIGTERM");', value]);

  assert.equal(result.stdout, value);
  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('processCall timeout terminates the executed child without leaving it alive', async () => {
  const result = await processCall([process.execPath, '-e',
    'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);']);

  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGKILL');
  const pid = Number(result.stdout);
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
