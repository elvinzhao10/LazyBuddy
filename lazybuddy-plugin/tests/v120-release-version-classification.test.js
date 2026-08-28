'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { classify } = require('../scripts/release-version-classifier');

const ROOT = path.resolve(__dirname, '../..');

function fixture() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-v120-classifier-'));
  fs.cpSync(ROOT, target, { recursive: true, filter: source => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}node_modules`) });
  return target;
}

function mutate(relativePath, transform) {
  const root = fixture();
  const file = path.join(root, relativePath);
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
  return root;
}

test('v1.2.0 release versions are classified and historical v1.1.0 references are explicit', () => {
  assert.deepEqual(classify(ROOT).failures, []);
});

test('classifier rejects a current 1.1 claim even when migration wording is present', () => {
  const root = mutate('README.md', text => `${text}\nCurrent supported release is 1.1.0 for migration compatibility.\n`);
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/release-version-classifier.js'), root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).failures.some(item => item.includes('CURRENT_VERSION_DRIFT_TEXT README.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, relativePath, transform, failure] of [
  ['current 1.1 drift', 'README.md', text => text.replace('v1.2.0', 'v1.1.0'), 'CURRENT_VERSION_DRIFT_TEXT'],
  ['missing release-note section', 'RELEASE_NOTES-v1.2.0.md', text => text.replace('## Rollback', '## Recovery'), 'MISSING_RELEASE_NOTE_SECTION'],
  ['package/runtime mismatch', 'lazybuddy-plugin/.codebuddy-plugin/plugin.json', text => text.replace('"version": "1.2.0"', '"version": "1.1.0"'), 'CURRENT_VERSION_DRIFT'],
  ['changed historical fixture', 'RELEASE_NOTES-v1.1.0.md', text => `${text}\nchanged\n`, 'CHANGED_HISTORICAL_FIXTURE'],
]) {
  test(`classifier rejects ${name} in a copy`, () => {
    const root = mutate(relativePath, transform);
    try { assert.ok(classify(root).failures.some(item => item.includes(failure))); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
