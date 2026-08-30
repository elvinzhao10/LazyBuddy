'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_VERSION = '1.2.1';
const PREVIOUS_VERSION = '1.2.0';
const HISTORICAL_DIGESTS = {
  'RELEASE_NOTES-v1.1.0.md': 'c16be358bd337351bd4541b9239d5faedc7b3443dcd3e32cc1e98d8aae93ebed',
  'RELEASE_NOTES-v1.2.0.md': '1f669dbdacaceb74782be5a99c56aba270eb58073ba305c0a60524fdbe360786',
};
const VERSION_JSON_PATHS = [
  ['lazybuddy-plugin/.codebuddy-plugin/plugin.json', ['version']],
  ['lazybuddy-plugin/.workbuddy-plugin/plugin.json', ['version']],
  ['.codebuddy-plugin/marketplace.json', ['plugins', 0, 'version']],
  ['lazybuddy-plugin/tooling/package.json', ['version']],
  ['lazybuddy-plugin/tooling/package-lock.json', ['version']],
  ['lazybuddy-plugin/tooling/package-lock.json', ['packages', '', 'version']],
  ['lazybuddy-plugin/tooling/lsp/python/package.json', ['version']],
  ['lazybuddy-plugin/tooling/lsp/python/package-lock.json', ['version']],
  ['lazybuddy-plugin/tooling/lsp/python/package-lock.json', ['packages', '', 'version']],
  ['lazybuddy-plugin/tooling/lsp/typescript/package.json', ['version']],
  ['lazybuddy-plugin/tooling/lsp/typescript/package-lock.json', ['version']],
  ['lazybuddy-plugin/tooling/lsp/typescript/package-lock.json', ['packages', '', 'version']],
];
const REQUIRED_RELEASE_NOTE_SECTIONS = [
  'Eval-driven fixes', 'Measured efficiency', 'Host capability matrix',
  'Migration and upgrade', 'Known risks', 'Rollback',
];

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function nestedValue(value, keys) {
  let current = value;
  for (const key of keys) current = current?.[key];
  return current;
}

function walk(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.omo' || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

function previousVersionClassification(relativePath, line) {
  if (relativePath === 'RELEASE_NOTES-v1.2.0.md' || relativePath.startsWith('docs/v1.2.0-')) return 'historical-release-document';
  if (relativePath === 'RELEASE_NOTES-v1.2.1.md') return 'documented-migration-boundary';
  if (relativePath === 'README.md' && /efficiency improvements/i.test(line)) return 'historical-release-summary';
  if (relativePath === 'lazybuddy-plugin/CHANGELOG.md') return 'historical-release-history';
  if (relativePath.includes('/contracts/fixtures/') || relativePath.includes('/tests/fixtures/')) return 'historical-or-adversarial-fixture';
  if (relativePath.includes('automatic-tooling-contract.v1') || relativePath.includes('v1.0.3-')) return 'schema-independent-contract-history';
  if (relativePath.endsWith('release-version-classifier.js')) return 'classifier-input';
  if (relativePath.endsWith('v120-release-version-classification.test.js')) return 'adversarial-test-input';
  if (relativePath.endsWith('lazybuddy-contract-check.sh')) return 'schema-independent-contract-test';
  if (/(?:^|\/)(?:test|tests)\//.test(relativePath) && /(previous|historical|fixture|wrong|from|upgrade|mutable|prior)/i.test(line)) return 'historical-test-input';
  if (/\bcurrent\b.*\b(?:release|version)\b/i.test(line)) return 'current-version-drift';
  if (/(upgrade|migrat|rollback|previous|historical|prior|old release|from v?1\.2\.0|tag\/v1\.2\.0|release notes)/i.test(line)) return 'historical-migration-reference';
  return null;
}

function classify(root) {
  const failures = [];
  const classifications = [];
  for (const [relativePath, keys] of VERSION_JSON_PATHS) {
    const actual = nestedValue(readJson(root, relativePath), keys);
    if (actual !== RELEASE_VERSION) failures.push(`CURRENT_VERSION_DRIFT ${relativePath}#${keys.join('.')} expected ${RELEASE_VERSION}, got ${JSON.stringify(actual)}`);
  }
  const runtimeVersion = require(path.join(root, 'lazybuddy-plugin/scripts/lifecycle/version.js')).CURRENT_VERSION;
  if (runtimeVersion !== RELEASE_VERSION) failures.push(`PACKAGE_RUNTIME_MISMATCH runtime expected ${RELEASE_VERSION}, got ${runtimeVersion}`);

  const notesPath = path.join(root, `RELEASE_NOTES-v${RELEASE_VERSION}.md`);
  if (!fs.existsSync(notesPath)) failures.push(`MISSING_RELEASE_NOTE RELEASE_NOTES-v${RELEASE_VERSION}.md`);
  else {
    const notes = fs.readFileSync(notesPath, 'utf8');
    for (const section of REQUIRED_RELEASE_NOTE_SECTIONS) {
      if (!notes.includes(`## ${section}`)) failures.push(`MISSING_RELEASE_NOTE_SECTION ${section}`);
    }
  }

  for (const [relativePath, expected] of Object.entries(HISTORICAL_DIGESTS)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');
    if (actual !== expected) failures.push(`CHANGED_HISTORICAL_FIXTURE ${relativePath}`);
  }

  for (const relativePath of walk(root)) {
    let contents;
    try { contents = fs.readFileSync(path.join(root, relativePath), 'utf8'); } catch { continue; }
    if (!contents.includes(PREVIOUS_VERSION)) continue;
    contents.split('\n').forEach((line, index) => {
      if (!line.includes(PREVIOUS_VERSION)) return;
      const classification = previousVersionClassification(relativePath, line);
      if (classification === 'current-version-drift') failures.push(`CURRENT_VERSION_DRIFT_TEXT ${relativePath}:${index + 1}`);
      else if (classification) classifications.push({ path: relativePath, line: index + 1, classification });
      else failures.push(`UNCLASSIFIED_PREVIOUS_VERSION ${relativePath}:${index + 1}`);
    });
  }
  return { product: 'LazyBuddy', release_version: RELEASE_VERSION, status: failures.length ? 'fail' : 'pass', failures, classifications };
}

if (require.main === module) {
  const report = classify(path.resolve(process.argv[2] || path.join(__dirname, '../..')));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

module.exports = { classify };
