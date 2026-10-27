import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('../../scripts/check-shared-helper-drift.mjs', import.meta.url));
const products = ['LazyBuddy', 'LazyTrae', 'LazyQoder', 'LazyZCode', 'LazyKimi', 'LazyDeepSeek'];

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-drift-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const roots = Object.fromEntries(products.map(p => [p, path.join(dir, p)]));
  for (const root of Object.values(roots)) {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'helper.js'), 'module.exports = 1;\n');
  }
  const manifest = { schemaVersion: 1, products, groups: [{ id: 'helper', paths: Object.fromEntries(products.map(p => [p, 'helper.js'])) }] };
  const file = path.join(dir, 'manifest.json');
  return { dir, roots, manifest, file };
}

function invoke(f) {
  fs.writeFileSync(f.file, JSON.stringify(f.manifest));
  return spawnSync(process.execPath, [checker, '--manifest', f.file,
    ...Object.entries(f.roots).flatMap(([p, root]) => ['--root', `${p}=${root}`])],
  { cwd: f.dir, encoding: 'utf8', timeout: 10000 });
}

function rejected(result) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).verdict, 'FAIL');
}

test('accepts identical helpers in six independent payload directories', t => {
  // Given payloads without Git metadata, dependencies or sibling checkout discovery.
  const f = fixture(t);
  // When the actual CLI compares the supplied roots.
  const result = invoke(f);
  // Then every product has an observed SHA in the successful result.
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.verdict, 'PASS');
  assert.equal(output.groups[0].members.length, 6);
});

test('rejects modified helper bytes with product, path and differing hashes', t => {
  // Given one changed copy, including misleading success text that must not execute.
  const f = fixture(t);
  fs.writeFileSync(path.join(f.roots.LazyKimi, 'helper.js'), 'console.log("PASS"); process.exit(0);');
  // When comparing actual bytes.
  const result = invoke(f);
  // Then failure names the mismatch and never emits success output.
  rejected(result);
  const members = JSON.parse(result.stderr).mismatches[0].members;
  assert.equal(members.find(m => m.product === 'LazyKimi').path, 'helper.js');
  assert.equal(new Set(members.map(m => m.sha256)).size, 2);
});

for (const [name, prepare] of [
  ['missing root', f => { f.roots.LazyKimi += '-absent'; }],
  ['missing helper', f => fs.unlinkSync(path.join(f.roots.LazyKimi, 'helper.js'))],
  ['escaping symlink', f => {
    const file = path.join(f.roots.LazyKimi, 'helper.js');
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(f.roots.LazyBuddy, 'helper.js'), file);
  }],
  ['aliased roots', f => { f.roots.LazyKimi = f.roots.LazyBuddy; }],
  ['oversized helper', f => fs.truncateSync(path.join(f.roots.LazyKimi, 'helper.js'), 8 * 1024 * 1024 + 1)],
  ['directory helper', f => { const file = path.join(f.roots.LazyKimi, 'helper.js'); fs.unlinkSync(file); fs.mkdirSync(file); }],
]) {
  test(`rejects ${name} without success output`, t => {
    // Given an invalid payload boundary.
    const f = fixture(t);
    prepare(f);
    // When invoking the checker.
    const result = invoke(f);
    // Then the actual process fails closed.
    rejected(result);
  });
}

for (const [name, change] of [
  ['stale version', m => { m.schemaVersion = 0; }],
  ['empty groups', m => { m.groups = []; }],
  ['too many groups', m => { m.groups = Array(129).fill(m.groups[0]); }],
  ['duplicate group', m => { m.groups.push(m.groups[0]); }],
  ['unknown field', m => { m.command = 'echo PASS'; }],
  ['duplicate product', m => { m.products = Array(6).fill('LazyBuddy'); }],
  ['unknown product', m => { m.groups[0].paths.Stranger = 'helper.js'; }],
  ['single member', m => { m.groups[0].paths = { LazyBuddy: 'helper.js' }; }],
  ['uncovered product', m => { delete m.groups[0].paths.LazyTrae; }],
  ['duplicate helper', m => { m.groups.push({ ...m.groups[0], id: 'other' }); }],
  ['traversal', m => { m.groups[0].paths.LazyKimi = '../LazyBuddy/helper.js'; }],
  ['absolute path', m => { m.groups[0].paths.LazyKimi = '/helper.js'; }],
  ['oversized manifest', m => { m.groups[0].id = 'a'.repeat(128 * 1024); }],
]) {
  test(`rejects manifest with ${name}`, t => {
    // Given a malformed or stale manifest.
    const f = fixture(t);
    change(f.manifest);
    // When the CLI parses it.
    const result = invoke(f);
    // Then malformed policy cannot produce a successful comparison.
    rejected(result);
  });
}
