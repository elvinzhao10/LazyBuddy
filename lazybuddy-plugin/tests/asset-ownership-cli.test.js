'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const CLI = path.resolve(__dirname, '..', 'scripts', 'assets', 'asset-ownership-cli.js');

test('CLI generates, checks, and refuses all uninstall mutation after caller modification', (t) => {
  // Given: a neutral one-file source and empty destination.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-assets-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  const manifest = path.join(source, 'assets.json');
  const receipt = path.join(destination, '.receipt.json');
  fs.mkdirSync(path.join(source, 'neutral'), { recursive: true });
  const sourceFile = path.join(source, 'neutral', 'guide.md');
  const target = path.join(destination, '.host', 'guide.md');
  fs.writeFileSync(sourceFile, 'base\n');
  fs.writeFileSync(manifest, JSON.stringify({
    schema_version: 1, owner: 'cli-test-assets',
    roots: [{ source: 'neutral', destination: '.host', default_format: 'text', format_by_extension: {} }],
  }));
  const args = ['--source-root', source, '--manifest', manifest, '--destination-root', destination, '--receipt', receipt];
  // When: the real CLI generates and checks the destination.
  assert.equal(spawnSync(process.execPath, [CLI, 'generate', ...args]).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, 'check', ...args]).status, 0);
  fs.writeFileSync(target, 'caller\n');
  fs.writeFileSync(sourceFile, 'source\n');
  const before = fs.readFileSync(target);
  const receiptBefore = fs.readFileSync(receipt);
  const conflict = spawnSync(process.execPath, [CLI, 'generate', ...args], { encoding: 'utf8' });
  // Then: conflict and receipt-aware uninstall both refuse without changing caller or receipt bytes.
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /merge conflict/i);
  assert.deepEqual(fs.readFileSync(target), before);
  const uninstall = spawnSync(process.execPath, [CLI, 'uninstall', ...args], { encoding: 'utf8' });
  assert.notEqual(uninstall.status, 0);
  assert.match(uninstall.stderr, /modified.*refus/i);
  assert.deepEqual(fs.readFileSync(target), before);
  assert.deepEqual(fs.readFileSync(receipt), receiptBefore);
});
