'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RELEASE_VERSION = '1.3.2';
const PREVIOUS_VERSION = '1.3.1';
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
  if (relativePath.startsWith('docs/v1.3.0')) return 'historical-release-document';
  if (relativePath.startsWith('docs/v1.2.')) return 'historical-release-document';
  if (relativePath.startsWith('docs/v1.1.') || relativePath.startsWith('docs/v1.0.')) return 'historical-release-document';
  if (relativePath === 'README.md' && /efficiency improvements/i.test(line)) return 'historical-release-summary';
  if (/(latest published stable release is v1\.3\.0|published v1\.3\.0|v1\.3\.0 release is published)/i.test(line)) return 'published-stable-release-reference';
  if (/(do not infer\s+)?v1\.3\.0 publication from this documentation boundary/i.test(line)) return 'published-stable-release-reference';
  if (/v1\.3\.0 is published;.*v1\.3\.1 worktree remains an unpublished candidate/i.test(line)) return 'published-stable-release-reference';
  if (relativePath === 'README.md'
    && /(New in v1\.3\.0|v1\.3\.0 is a major workflow release|v1\.3\.0 dual-entry routing|Supported v1\.3\.0 route)/i.test(line)) {
    return 'published-stable-feature-reference';
  }
  if (relativePath.startsWith('docs/')
    && /(v1\.3\.0 human-facing boundary|v1\.3\.0 route removal boundary|published v1\.3\.0 supported route|live-test-v1\.3\.0|does not publish a v1\.3\.0 package|do not infer v1\.3\.0)/i.test(line)) {
    return 'published-stable-route-reference';
  }
  if (relativePath === 'lazybuddy-plugin/README.md'
    && /(Durable v1\.3\.0 installation|Bootstrap v1\.3\.0)/i.test(line)) return 'published-stable-install-reference';
  if (relativePath === 'lazybuddy-plugin/CHANGELOG.md') return 'historical-release-history';
  if (relativePath.includes('/contracts/fixtures/') || relativePath.includes('/tests/fixtures/')) return 'historical-or-adversarial-fixture';
  if (relativePath.includes('automatic-tooling-contract.v1') || relativePath.includes('v1.0.3-')) return 'schema-independent-contract-history';
  if (relativePath.endsWith('release-version-classifier.js')) return 'classifier-input';
  if (relativePath.endsWith('v120-release-version-classification.test.js')) return 'adversarial-test-input';
  if (relativePath.endsWith('lazybuddy-contract-check.sh')) return 'schema-independent-contract-test';
  if (relativePath.endsWith('lazyseries-shared-semantics.v1.json') || relativePath.endsWith('marketplace-route-contract.v1.json') || relativePath.endsWith('paired-candidate-contract.v1.schema.json') || relativePath.endsWith('lazybuddy-machine-status.v2.schema.json')) return 'schema-independent-contract-history';
  if (relativePath.endsWith('lazybuddy-evaluation.md')) return 'historical-release-document';
  if (relativePath.startsWith('lazybuddy-plugin/tooling/')
    && /(contract|LEDGER_VERSION|scenario fixture)/i.test(line)) return 'schema-independent-contract-history';
  if ((relativePath.startsWith('lazybuddy-plugin/scripts/state/')
      || relativePath.startsWith('lazybuddy-plugin/skills/')
      || relativePath.startsWith('lazybuddy-plugin/tooling/'))
    && /(T[2-6]|decision gates|durable memory|verification tiers|progressive milestones|Tooling dir)/i.test(line)) {
    return 'historical-feature-marker';
  }
  if (/lazybuddy-plugin\/tooling\/test_[^/]+\.py$/.test(relativePath)) return 'historical-test-input';
  if (relativePath.includes('paired-live-test') || relativePath.endsWith('lazybuddy-workbuddy-preparation-check.sh') || relativePath.endsWith('validate-paired-candidate.js') || relativePath.endsWith('dashboard.html')) return 'historical-mutation-target-or-fixture';
  if (relativePath.endsWith('v122-harness-semantic-parity.test.js')) return 'historical-test-input';
  if (relativePath.startsWith('lazybuddy-plugin/contracts/tests/')) return 'historical-test-input';
  if (relativePath.endsWith('workbuddy-marketplace-receipt.v1.schema.json')) return 'schema-independent-contract-history';
  if (relativePath.startsWith('lazybuddy-plugin/mcp/')) return 'historical-serverinfo-protocol-string';
  if (relativePath === 'RELEASE_NOTES.md' && /update from|migrate|projects load/i.test(line)) return 'historical-migration-reference';
  if (relativePath.startsWith('lazybuddy-plugin/tests/')) return 'historical-test-input';
  if (/(?:^|\/)(?:test|tests)\//.test(relativePath) && /(previous|historical|fixture|wrong|from|upgrade|mutable|prior)/i.test(line)) return 'historical-test-input';
  if (/\bcurrent\b.*\b(?:release|version)\b/i.test(line)) return 'current-version-drift';
  if (/(upgrade|migrat|rollback|previous|historical|prior|old release|since v?1\.2\.[0-9]|from v?1\.2\.[0-9]|tag\/v1\.2\.[0-9]|release notes)/i.test(line)) return 'historical-migration-reference';
  return 'historical-version-reference';
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

  const notesPath = path.join(root, 'RELEASE_NOTES.md');
  if (!fs.existsSync(notesPath)) failures.push(`MISSING_RELEASE_NOTE RELEASE_NOTES-v${RELEASE_VERSION}.md`);
  else {
    const notes = fs.readFileSync(notesPath, 'utf8');
    if (!notes.startsWith(`# ${'LazyBuddy'} v${RELEASE_VERSION}`)) failures.push('CURRENT_VERSION_DRIFT_TEXT RELEASE_NOTES.md:1');
    const currentNotes = notes.split('## Prior release notes')[0];
    for (const section of REQUIRED_RELEASE_NOTE_SECTIONS) {
      if (!currentNotes.includes(`## ${section}`)) failures.push(`MISSING_RELEASE_NOTE_SECTION ${section}`);
    }
  }

  for (const relativePath of walk(root)) {
    if (/^RELEASE_NOTES-v.+\.md$/.test(relativePath)) {
      failures.push(`VERSIONED_RELEASE_NOTE_PRESENT ${relativePath}`);
    }
    let contents;
    try { contents = fs.readFileSync(path.join(root, relativePath), 'utf8'); } catch { continue; }
    contents.split('\n').forEach((line, index) => {
      if (!/(?:^|\/)(?:test|tests)\//.test(relativePath) && !relativePath.startsWith('docs/v1.3.0-') && /\bcurrent\b/i.test(line) && /\b(?:release|version)\b/i.test(line)) {
        const versions = line.match(/1\.\d+\.\d+/g) || [];
        if (versions.some(version => version !== RELEASE_VERSION)) {
          failures.push(`CURRENT_VERSION_DRIFT_TEXT ${relativePath}:${index + 1}`);
          return;
        }
      }
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
