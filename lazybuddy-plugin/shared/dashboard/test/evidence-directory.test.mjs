import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvidenceDirectory } from './evidence-directory.mjs';

test('default evidence captures are isolated and removed after their test', async t => {
  let first;
  let second;
  await t.test('capture', child => {
    first = createEvidenceDirectory(child);
    second = createEvidenceDirectory(child);
    assert.notEqual(first, second);
    writeFileSync(join(first, 'fixture.json'), '{}');
    assert.equal(existsSync(second), true);
  });
  assert.equal(existsSync(first), false);
  assert.equal(existsSync(second), false);
});

test('explicit evidence capture preserves caller-owned output after the test', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-capture-owner-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await t.test('capture', child => {
    assert.equal(createEvidenceDirectory(child, directory), directory);
    writeFileSync(join(directory, 'fixture.json'), '{"captured":true}');
  });
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8')), { captured: true });
});
