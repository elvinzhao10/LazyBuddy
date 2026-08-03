'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  checkAssets, compileAssets, installAssets, uninstallAssets,
} = require('../scripts/assets/asset-ownership');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const destinationRoot = path.join(root, 'destination');
  const manifestPath = path.join(sourceRoot, 'assets.json');
  const receiptPath = path.join(destinationRoot, '.lazyseries-assets.json');
  fs.mkdirSync(path.join(sourceRoot, 'neutral'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'neutral', 'guide.md'), 'alpha\nbeta\ngamma\n');
  fs.writeFileSync(path.join(sourceRoot, 'neutral', 'settings.json'), '{"alpha":1,"beta":2}\n');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schema_version: 1,
    owner: 'lazyseries-test-assets',
    roots: [{
      source: 'neutral', destination: '.host', default_format: 'text',
      format_by_extension: { '.json': 'json' },
    }],
  }, null, 2)}\n`);
  return { root, sourceRoot, destinationRoot, manifestPath, receiptPath };
}

function digestTree(root) {
  const hash = crypto.createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) visit(absolute);
      else hash.update(relative).update('\0').update(fs.readFileSync(absolute)).update('\0');
    }
  };
  visit(root);
  return hash.digest('hex');
}

test('compiles the same neutral inventory to byte-identical temporary trees', (t) => {
  // Given: one canonical neutral source manifest.
  const input = fixture(t);
  // When: it is compiled twice.
  const first = compileAssets(input);
  const second = compileAssets(input);
  t.after(() => fs.rmSync(first.treeRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(second.treeRoot, { recursive: true, force: true }));
  // Then: inventory order, manifest digest, and emitted bytes are identical.
  assert.deepEqual(first.entries, second.entries);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(digestTree(first.treeRoot), digestTree(second.treeRoot));
  installAssets(input);
  const installedDigest = digestTree(input.destinationRoot);
  installAssets(input);
  assert.equal(digestTree(input.destinationRoot), installedDigest);
});

test('preserves caller-only changes and merges disjoint text and JSON changes', (t) => {
  // Given: a receipt-owned generation with caller changes on separate text/JSON keys.
  const input = fixture(t);
  installAssets(input);
  const guide = path.join(input.destinationRoot, '.host', 'guide.md');
  const settings = path.join(input.destinationRoot, '.host', 'settings.json');
  fs.writeFileSync(guide, 'alpha\nbeta\ncaller\n');
  fs.writeFileSync(settings, '{"alpha":1,"beta":2,"caller":true}\n');
  installAssets(input);
  assert.equal(fs.readFileSync(guide, 'utf8'), 'alpha\nbeta\ncaller\n');
  // When: canonical source changes a disjoint text line and JSON key.
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'guide.md'), 'source\nbeta\ngamma\n');
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'settings.json'), '{"alpha":9,"beta":2}\n');
  installAssets(input);
  // Then: both parties' disjoint edits are present.
  assert.equal(fs.readFileSync(guide, 'utf8'), 'source\nbeta\ncaller\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { alpha: 9, beta: 2, caller: true });
});

test('applies a clean source update and leaves unrelated caller files unchanged', (t) => {
  // Given: a clean receipt-owned tree beside an unrelated caller file.
  const input = fixture(t);
  installAssets(input);
  const target = path.join(input.destinationRoot, '.host', 'guide.md');
  const unrelated = path.join(input.destinationRoot, 'caller.txt');
  fs.writeFileSync(unrelated, 'dirty worktree sentinel\n');
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'guide.md'), 'updated\nbeta\ngamma\n');
  // When: the new canonical inventory is generated.
  installAssets(input);
  // Then: the clean output updates and unrelated caller state is untouched.
  assert.equal(fs.readFileSync(target, 'utf8'), 'updated\nbeta\ngamma\n');
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'dirty worktree sentinel\n');
});

test('refuses same-line conflicts without changing caller bytes', (t) => {
  // Given: caller and source changed the same line from the receipted base.
  const input = fixture(t);
  installAssets(input);
  const target = path.join(input.destinationRoot, '.host', 'guide.md');
  fs.writeFileSync(target, 'caller\nbeta\ngamma\n');
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'guide.md'), 'source\nbeta\ngamma\n');
  const before = fs.readFileSync(target);
  // When/Then: generation fails and the original bytes remain.
  assert.throws(() => installAssets(input), /merge conflict/i);
  assert.deepEqual(fs.readFileSync(target), before);
});

test('refuses unreceipted adoption, traversal, linked targets, and orphaned receipts', (t) => {
  // Given: independent unsafe filesystem states.
  const adoption = fixture(t);
  fs.mkdirSync(path.join(adoption.destinationRoot, '.host'), { recursive: true });
  fs.writeFileSync(path.join(adoption.destinationRoot, '.host', 'guide.md'), 'unknown\n');
  // When/Then: an existing unreceipted destination is never adopted.
  assert.throws(() => installAssets(adoption), /unreceipted/i);

  const traversal = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(traversal.manifestPath, 'utf8'));
  manifest.roots[0].destination = '../escape';
  fs.writeFileSync(traversal.manifestPath, JSON.stringify(manifest));
  assert.throws(() => compileAssets(traversal), /normalized relative path/i);
  const malformed = fixture(t);
  fs.writeFileSync(malformed.manifestPath, '{');
  assert.throws(() => compileAssets(malformed), /malformed/i);

  const linked = fixture(t);
  installAssets(linked);
  const target = path.join(linked.destinationRoot, '.host', 'guide.md');
  const original = fs.readFileSync(target);
  fs.rmSync(target);
  fs.symlinkSync(path.join(linked.root, 'outside'), target);
  assert.throws(() => installAssets(linked), /symlink|linked/i);
  fs.rmSync(target);
  fs.writeFileSync(target, original);
  fs.linkSync(target, path.join(linked.root, 'hardlink'));
  assert.throws(() => installAssets(linked), /hard-linked|linked/i);

  const orphan = fixture(t);
  installAssets(orphan);
  fs.rmSync(path.join(orphan.sourceRoot, 'neutral', 'guide.md'));
  assert.throws(() => installAssets(orphan), /orphan/i);
});

test('reports stale files and rolls back every target after an atomic rename failure', (t) => {
  // Given: a missing receipted target and a separate two-file update with injected rename failure.
  const stale = fixture(t);
  installAssets(stale);
  fs.rmSync(path.join(stale.destinationRoot, '.host', 'guide.md'));
  assert.match(checkAssets(stale).issues.join('\n'), /missing/i);
  const staleSource = fixture(t);
  installAssets(staleSource);
  fs.writeFileSync(path.join(staleSource.sourceRoot, 'neutral', 'guide.md'), 'new source\n');
  assert.match(checkAssets(staleSource).issues.join('\n'), /stale manifest/i);

  const input = fixture(t);
  installAssets(input);
  const guide = path.join(input.destinationRoot, '.host', 'guide.md');
  const settings = path.join(input.destinationRoot, '.host', 'settings.json');
  const beforeGuide = fs.readFileSync(guide);
  const beforeSettings = fs.readFileSync(settings);
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'guide.md'), 'new\nbeta\ngamma\n');
  fs.writeFileSync(path.join(input.sourceRoot, 'neutral', 'settings.json'), '{"alpha":7,"beta":2}\n');
  let promotions = 0;
  const rename = (from, to) => {
    if (from.endsWith('.asset-tmp') && ++promotions === 2) {
      const error = new Error('injected rename failure');
      error.code = 'EIO';
      throw error;
    }
    fs.renameSync(from, to);
  };
  // When/Then: no target keeps a partial update.
  assert.throws(() => installAssets({ ...input, rename }), /injected rename failure/);
  assert.deepEqual(fs.readFileSync(guide), beforeGuide);
  assert.deepEqual(fs.readFileSync(settings), beforeSettings);
});

test('uninstall removes exact owned outputs only and preserves modified files', (t) => {
  // Given: one exact receipt-owned file and one caller-modified output.
  const input = fixture(t);
  installAssets(input);
  const guide = path.join(input.destinationRoot, '.host', 'guide.md');
  const settings = path.join(input.destinationRoot, '.host', 'settings.json');
  fs.writeFileSync(guide, 'caller\n');
  // When: receipt-owned assets are uninstalled.
  const result = uninstallAssets(input);
  // Then: only the exact output and receipt are deleted.
  assert.deepEqual(result.removed, ['.host/settings.json']);
  assert.deepEqual(result.preserved, ['.host/guide.md']);
  assert.equal(fs.existsSync(settings), false);
  assert.equal(fs.readFileSync(guide, 'utf8'), 'caller\n');
  assert.equal(fs.existsSync(input.receiptPath), false);
});

test('uninstall restores every owned file and receipt when the second unlink fails', (t) => {
  // Given: two exact receipt-owned outputs and an injected second-unlink I/O failure.
  const input = fixture(t);
  installAssets(input);
  const targets = [
    path.join(input.destinationRoot, '.host', 'guide.md'),
    path.join(input.destinationRoot, '.host', 'settings.json'),
  ];
  const before = new Map([...targets, input.receiptPath].map((target) => [target, fs.readFileSync(target)]));
  const originalUnlink = fs.unlinkSync;
  let ownedUnlinks = 0;
  fs.unlinkSync = (target) => {
    if (targets.includes(target) && ++ownedUnlinks === 2) throw Object.assign(new Error('injected unlink failure'), { code: 'EIO' });
    return originalUnlink(target);
  };
  // When: uninstall reaches the injected failure.
  try {
    assert.throws(() => uninstallAssets(input), /injected unlink failure/);
  } finally {
    fs.unlinkSync = originalUnlink;
  }
  // Then: every original payload and receipt byte is restored.
  for (const [target, bytes] of before) assert.deepEqual(fs.readFileSync(target), bytes);
});

test('derives the packaged Buddy inventory only from canonical Skill roots', (t) => {
  // Given: the packaged neutral manifest and canonical plugin root.
  const sourceRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(sourceRoot, 'asset-source-manifest.v1.json');
  // When: the real package inventory is compiled.
  const compiled = compileAssets({ sourceRoot, manifestPath });
  t.after(() => fs.rmSync(compiled.treeRoot, { recursive: true, force: true }));
  // Then: it has a unique, sorted, non-empty destination inventory.
  assert.ok(compiled.entries.length > 10);
  assert.deepEqual(compiled.entries.map((entry) => entry.path), [...new Set(compiled.entries.map((entry) => entry.path))].sort());
});
