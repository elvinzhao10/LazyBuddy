import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = fileURLToPath(new URL('../../../', import.meta.url));

test('inactivity harness executes literal script paths and cleans up when checkout names contain shell syntax', t => {
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'inactivity-argv-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const checkout = join(temporary, 'source space \' " $(exit 91) `exit 92`');
  const project = join(checkout, 'lazybuddy-plugin/shared/project');
  mkdirSync(join(project, 'qa'), { recursive: true });
  cpSync(join(plugin, 'shared'), join(checkout, 'lazybuddy-plugin/shared'), { recursive: true });
  symlinkSync(join(plugin, 'scripts'), join(checkout, 'lazybuddy-plugin/scripts'));
  symlinkSync(join(plugin, 'tooling'), join(checkout, 'lazybuddy-plugin/tooling'));
  const baseline = join(temporary, 'baseline.json');
  writeFileSync(baseline, '{}\n');

  const result = spawnSync(process.execPath, [join(project, 'qa/inactivity-baseline.mjs'),
    '--compare', '--baseline', baseline, '--artifacts', temporary],
  { encoding: 'utf8', timeout: 30000 });

  assert.equal(result.status, 70, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.run_created, 't01run');
  assert.equal(report.unauthenticated_snapshot_status, '401');
  assert.equal(report.io2.no_project_registry_created, true);
  assert.equal(report.stop_receipt.status, 'stopped');
  assert.equal(report.listener_after_stop, true);
  assert.equal(report.fixture_removed, true);
  assert.equal(existsSync(report.fixture_root), false);
  assert.ok(readFileSync(join(temporary, 'inactivity-normalized.json'), 'utf8').length > 0);
  t.diagnostic(JSON.stringify(report));
});
