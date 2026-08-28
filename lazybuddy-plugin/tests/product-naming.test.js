'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const checker = path.resolve(__dirname, '../../scripts/check-product-naming.js');
const formerIde = ['Trae', 'IDE'].join(' ');
const formerCli = ['Trae', 'CLI'].join(' ');
const renamedStableId = ['traecode', 'ide'].join('-');
const misspelledWorkBuddy = ['Work', 'buddy'].join('');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-naming-'));
  fs.writeFileSync(path.join(root, '.product-naming-allowlist.json'), JSON.stringify({
    formerDisplayNames: [{
      path: 'historical.md', text: formerIde, count: 1,
      classification: 'old-release-note', reason: 'A released note is immutable.',
    }],
    stableIdentityFiles: [{ path: 'contract.json', ids: { 'trae-ide': 1, 'trae-cli': 1, 'trae-work': 1 } }],
    currentCliPages: ['cli.md'],
  }));
  fs.writeFileSync(path.join(root, 'historical.md'), `Released with ${formerIde}.\n`);
  fs.writeFileSync(path.join(root, 'contract.json'), '["trae-ide","trae-cli","trae-work"]\n');
  fs.writeFileSync(path.join(root, 'cli.md'), 'TraeCode CLI uses the `traecli` executable.\n');
  fs.writeFileSync(path.join(root, 'current.md'), 'TraeCode and WorkBuddy are current names.\n');
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PRODUCT_NAMING_ROOT: root },
  });
}

test('semantic naming checker accepts current names and rejects protected regressions', async t => {
  const clean = fixture();
  t.after(() => fs.rmSync(clean, { recursive: true, force: true }));
  assert.equal(run(clean).status, 0);

  const scenarios = [
    ['former current name', root => fs.appendFileSync(path.join(root, 'current.md'), `${formerCli}\n`), /unallowlisted former display-name/],
    ['stable ID rename', root => fs.writeFileSync(path.join(root, 'contract.json'), `["${renamedStableId}","trae-cli","trae-work"]\n`), /stable Trae machine ID/],
    ['WorkBuddy spelling', root => fs.writeFileSync(path.join(root, 'current.md'), `${misspelledWorkBuddy}\n`), /non-canonical WorkBuddy spelling/],
    ['missing allowlist reason', root => {
      const file = path.join(root, '.product-naming-allowlist.json');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('A released note is immutable.', ''));
    }, /requires path, text, positive count, approved classification, and reason/],
  ];
  for (const [name, seed, expected] of scenarios) await t.test(name, () => {
    const root = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    seed(root);
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  });
});
