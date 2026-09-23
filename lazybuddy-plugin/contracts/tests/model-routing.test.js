'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const contracts = path.resolve(__dirname, '..');
const routing = require(path.join(contracts, 'model-routing.js'));
const cli = path.join(contracts, 'model-routing.js');
const selectWithPlannedSwitch = (input) => routing.selectModel({ ...input, allowSwitch: true });

function catalog(t, host, models, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyseries-model-routing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, host, models, ...extra }));
  return file;
}

function model(id, tier, capabilities = ['tools', 'code'], options = {}) {
  return { id, origin: 'custom', tier, available: true, capabilities, ...options };
}

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('selects an available custom model from a caller-declared catalog', (t) => {
  // Given
  const file = catalog(t, 'codebuddy-cli', [
    model('balanced-expensive', 'balanced', undefined, { costRank: 8 }),
    model('balanced-efficient', 'balanced', undefined, { costRank: 2 }),
  ]);
  // When
  const result = selectWithPlannedSwitch({ host: 'codebuddy-cli', task: 'implementation', catalogPath: file });
  // Then
  assert.equal(result.chosenModel, 'balanced-efficient');
  assert.equal(result.availability, 'caller-declared');
  assert.deepEqual(result.dispatch, { kind: 'agent-tool-model-field', value: 'balanced-efficient' });
});

test('rejects catalogs with unknown secret-bearing fields without echoing values', (t) => {
  // Given
  const secret = 'sk-private-should-never-appear';
  const file = catalog(t, 'qoder-cli', [model('safe-model', 'balanced')], { apiKey: secret });
  // When
  const result = run('--host', 'qoder-cli', '--task', 'implementation', '--catalog', file);
  // Then
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown field/);
  assert.doesNotMatch(result.stderr + result.stdout, new RegExp(secret));
});

test('rejects invalid payloads, duplicates, host mismatches, and unsafe identifiers', (t) => {
  // Given
  const cases = [
    catalog(t, 'qoder-cli', [model('same', 'balanced'), model('same', 'strong')]),
    catalog(t, 'qoder-ide', [model('valid', 'balanced')]),
    catalog(t, 'qoder-cli', [model('bad\nmodel', 'balanced')]),
    catalog(t, 'qoder-cli', [model(123, 'balanced')]),
  ];
  // When
  const actions = cases.map((catalogPath) => () => selectWithPlannedSwitch({ host: 'qoder-cli', task: 'implementation', catalogPath }));
  // Then
  for (const action of actions) assert.throws(action, /catalog/i);
});

test('rejects inherited object-property names as hosts and tasks', () => {
  // Given
  const inheritedNames = ['constructor', 'toString', '__proto__'];
  // When
  const hostActions = inheritedNames.map((host) => () => selectWithPlannedSwitch({ host, task: 'mechanical' }));
  const taskActions = inheritedNames.map((task) => () => selectWithPlannedSwitch({ host: 'qoder-cli', task }));
  // Then
  for (const action of [...hostActions, ...taskActions]) assert.throws(action, /unsupported --(host|task)/);
});

test('does not choose a model missing a required capability', (t) => {
  // Given
  const file = catalog(t, 'codebuddy-ide', [model('text-only', 'balanced', ['code'])]);
  // When / Then
  assert.throws(
    () => selectWithPlannedSwitch({ host: 'codebuddy-ide', task: 'implementation', catalogPath: file }),
    /qualified model/,
  );
});

test('never lowers a strong task to an economical model', (t) => {
  // Given
  const file = catalog(t, 'qoder-ide', [
    model('cheap', 'economy', undefined, { costRank: 1 }),
    model('reviewer', 'strong', undefined, { costRank: 9 }),
  ]);
  // When
  const result = selectWithPlannedSwitch({ host: 'qoder-ide', task: 'review', catalogPath: file });
  // Then
  assert.equal(result.chosenModel, 'reviewer');
  assert.equal(result.tier, 'strong');
});

test('escalates high risk and failed attempts to strong', () => {
  // Given / When
  const highRisk = selectWithPlannedSwitch({ host: 'codebuddy-cli', task: 'mechanical', risk: 'high' });
  const retried = selectWithPlannedSwitch({ host: 'qoder-cli', task: 'implementation', failedAttempts: 1 });
  // Then
  assert.equal(highRisk.tier, 'strong');
  assert.equal(highRisk.chosenModel, 'reasoning');
  assert.equal(retried.tier, 'strong');
  assert.equal(retried.chosenModel, 'performance');
});

test('uses input order when candidate costs are not all caller-declared', (t) => {
  // Given
  const file = catalog(t, 'qoder-cli', [
    model('first-balanced', 'balanced'),
    model('ranked-balanced', 'balanced', undefined, { costRank: 0 }),
  ]);
  // When
  const result = selectWithPlannedSwitch({ host: 'qoder-cli', task: 'implementation', catalogPath: file });
  // Then
  assert.equal(result.chosenModel, 'first-balanced');
  assert.match(result.reason, /cost rank is unknown/);
});

test('chooses a cheaper strong model over a costlier balanced model when every cost rank is declared', (t) => {
  // Given
  const file = catalog(t, 'qoder-cli', [
    model('balanced-costlier', 'balanced', undefined, { costRank: 8 }),
    model('strong-cheaper', 'strong', undefined, { costRank: 1 }),
  ]);
  // When
  const result = selectWithPlannedSwitch({ host: 'qoder-cli', task: 'implementation', catalogPath: file });
  // Then
  assert.equal(result.chosenModel, 'strong-cheaper');
  assert.equal(result.tier, 'balanced');
  assert.match(result.reason, /relative cost rank among all qualified models/);
});

test('requires explicit choices to satisfy catalog availability, capabilities, and tier', (t) => {
  // Given
  const file = catalog(t, 'codebuddy-cli', [
    model('unavailable', 'strong', undefined, { available: false }),
    model('weak', 'economy'),
    model('capability-gap', 'strong', ['code']),
    model('chosen-strong', 'strong', ['tools', 'code', 'vision']),
  ]);
  // When / Then
  for (const id of ['missing', 'unavailable', 'weak', 'capability-gap']) {
    assert.throws(
      () => selectWithPlannedSwitch({ host: 'codebuddy-cli', task: 'security', catalogPath: file, model: id }),
      /explicit model/,
    );
  }
  assert.equal(
    selectWithPlannedSwitch({ host: 'codebuddy-cli', task: 'security', catalogPath: file, model: 'chosen-strong' }).chosenModel,
    'chosen-strong',
  );
});

test('requires catalog-proven vision for visual tasks or an explicit vision requirement', (t) => {
  // Given
  const withoutVision = catalog(t, 'qoder-ide', [model('strong-text', 'strong')]);
  const withVision = catalog(t, 'qoder-ide', [model('strong-vision', 'strong', ['tools', 'code', 'vision'])]);
  // When / Then
  assert.throws(() => selectWithPlannedSwitch({ host: 'qoder-ide', task: 'visual', catalogPath: withoutVision }), /qualified model/);
  assert.equal(selectWithPlannedSwitch({ host: 'qoder-ide', task: 'visual', catalogPath: withVision }).chosenModel, 'strong-vision');
});

test('keeps manual hosts manual and does not native-bind Trae custom models', (t) => {
  // Given
  const traeCatalog = catalog(t, 'trae-ide', [
    model('custom-strong', 'strong'),
    { ...model('builtin-strong', 'strong'), origin: 'builtin', subagentSupported: true },
    { ...model('builtin-manual', 'strong'), origin: 'builtin' },
  ]);
  // When
  const work = selectWithPlannedSwitch({ host: 'workbuddy', task: 'implementation' });
  const qoderIde = selectWithPlannedSwitch({ host: 'qoder-ide', task: 'implementation' });
  const codeBuddyIde = selectWithPlannedSwitch({ host: 'codebuddy-ide', task: 'implementation' });
  const trae = selectWithPlannedSwitch({ host: 'trae-ide', task: 'security', catalogPath: traeCatalog });
  // Then
  assert.deepEqual(work.dispatch, { kind: 'manual-only', value: null });
  assert.equal(qoderIde.chosenModel, null);
  assert.deepEqual(qoderIde.dispatch, { kind: 'manual-only', value: null });
  assert.equal(codeBuddyIde.chosenModel, null);
  assert.deepEqual(codeBuddyIde.dispatch, { kind: 'manual-only', value: null });
  assert.deepEqual(trae.dispatch, { kind: 'agent-frontmatter', value: 'builtin-strong' });
  assert.equal(
    selectWithPlannedSwitch({ host: 'trae-ide', task: 'security', catalogPath: traeCatalog, model: 'builtin-strong' }).chosenModel,
    'builtin-strong',
  );
  assert.throws(
    () => selectWithPlannedSwitch({ host: 'trae-ide', task: 'security', catalogPath: traeCatalog, model: 'custom-strong' }),
    /custom models cannot be bound/,
  );
  assert.deepEqual(
    selectWithPlannedSwitch({ host: 'trae-ide', task: 'security', catalogPath: traeCatalog, model: 'builtin-manual' }).dispatch,
    { kind: 'manual-only', value: null },
  );
});

test('real CLI reports recommendations, lists honest scope, and rejects unsupported aliases', (t) => {
  // Given
  const file = catalog(t, 'trae-work', [{ ...model('declared', 'balanced'), origin: 'builtin' }]);
  // When
  const selected = run('--host', 'qoder-cli', '--task', 'mechanical');
  const aliases = run('--list', '--host', 'qoder-cli');
  const declared = run('--list', '--host', 'trae-work', '--catalog', file);
  const unsupported = run('--host', 'qoder-cli', '--task', 'security', '--allow-switch', '--model', 'efficient');
  // Then
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).nativeExecution, 'not-observed');
  assert.equal(JSON.parse(aliases.stdout).listScope, 'documented-aliases');
  assert.equal(JSON.parse(declared.stdout).listScope, 'caller-declared-catalog');
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /does not meet required tier/);
});

test('defaults to inherited parent model until the plan explicitly permits switching', (t) => {
  const file = catalog(t, 'qoder-cli', [model('cheap', 'economy', undefined, { costRank: 0 })]);
  const inherited = routing.selectModel({ host: 'qoder-cli', task: 'mechanical', catalogPath: file });
  assert.equal(inherited.chosenModel, null);
  assert.deepEqual(inherited.dispatch, { kind: 'inherit', value: null });
  assert.match(inherited.reason, /plan/i);
  assert.throws(() => routing.selectModel({ host: 'qoder-cli', task: 'mechanical', model: 'efficient' }), /plan|switch/i);
  const optedIn = selectWithPlannedSwitch({ host: 'qoder-cli', task: 'mechanical', catalogPath: file });
  assert.equal(optedIn.chosenModel, 'cheap');
});
