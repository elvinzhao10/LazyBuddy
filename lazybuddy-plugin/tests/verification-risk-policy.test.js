'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  RISK_FLAGS,
  TASK_CATEGORIES,
  selectVerificationPolicy,
} = require('../scripts/verification-risk-policy');

const BASE = {
  taskCategory: 'quick',
  changedPaths: ['src/format-label.js'],
  riskFlags: [],
  capabilityFresh: true,
  evidenceFresh: true,
  dirtyTree: false,
  priorOutcomes: [],
};

test('Given each task category, when policy is selected, then its minimum gate boundary and reason are deterministic', () => {
  const table = [
    ['quick', 'direct', 'category-quick', 0],
    ['deep', 'affected', 'category-deep', 0],
    ['ultrabrain', 'comprehensive', 'category-ultrabrain', 2],
    ['visual-engineering', 'affected', 'category-visual-engineering', 0],
    ['writing', 'direct', 'category-writing', 0],
    ['review', 'affected', 'category-review', 0],
  ];
  for (const [taskCategory, level, reason, fullSuiteInvocations] of table) {
    const selected = selectVerificationPolicy({ ...BASE, taskCategory });
    assert.equal(selected.level, level, taskCategory);
    assert.ok(selected.reasonCodes.includes(reason), taskCategory);
    assert.equal(selected.cost.fullSuiteInvocations, fullSuiteInvocations, taskCategory);
    assert.ok(selected.gates.includes('final-assertions'), taskCategory);
  }
  assert.deepEqual(TASK_CATEGORIES, table.map(([category]) => category));
});

test('Given every supported risk flag on every category, when policy is selected, then affected and escalation risks map with reason codes', () => {
  for (const taskCategory of TASK_CATEGORIES) {
    for (const riskFlag of RISK_FLAGS) {
      const selected = selectVerificationPolicy({ ...BASE, taskCategory, riskFlags: [riskFlag] });
      const baseComprehensive = taskCategory === 'ultrabrain';
      const expected = baseComprehensive || !['dependency', 'contract'].includes(riskFlag)
        ? 'comprehensive'
        : 'affected';
      assert.equal(selected.level, expected, `${taskCategory}:${riskFlag}`);
      assert.ok(selected.reasonCodes.includes(riskFlag), `${taskCategory}:${riskFlag}`);
    }
  }
});

test('Given mandatory path classes, when policy is selected, then each escalates to comprehensive', () => {
  const table = [
    ['contracts/public-api.json', 'public-contract-change'],
    ['schemas/run.v2.schema.json', 'public-contract-change'],
    ['package.json', 'version-change'],
    ['scripts/lifecycle/state.js', 'lifecycle-change'],
    ['scripts/security-policy.js', 'security-change'],
    ['scripts/hosts/codebuddy-adapter.js', 'host-adapter-change'],
    ['scripts/host-capability-matrix.js', 'host-adapter-change'],
    ['scripts/state/state-transaction.js', 'shared-state-change'],
  ];
  for (const [changedPath, reason] of table) {
    const selected = selectVerificationPolicy({ ...BASE, changedPaths: [changedPath] });
    assert.equal(selected.level, 'comprehensive', changedPath);
    assert.ok(selected.reasonCodes.includes(reason), changedPath);
  }
});

test('Given outcome and freshness escalations, when policy is selected, then every case is comprehensive', () => {
  const table = [
    [{ priorOutcomes: [{ gateId: 'targeted', outcome: 'failed', assertionId: 'a' }] }, 'prior-gate-failure'],
    [{ priorOutcomes: [
      { gateId: 'targeted', outcome: 'flaky', assertionId: 'same' },
      { gateId: 'targeted', outcome: 'flaky', assertionId: 'same' },
    ] }, 'repeated-flake'],
    [{ capabilityFresh: false }, 'stale-capability'],
    [{ evidenceFresh: false }, 'stale-evidence'],
    [{ dirtyTree: true }, 'dirty-tree'],
  ];
  for (const [override, reason] of table) {
    const selected = selectVerificationPolicy({ ...BASE, ...override });
    assert.equal(selected.level, 'comprehensive', reason);
    assert.ok(selected.reasonCodes.includes(reason), reason);
  }
});

test('Given one flake, when policy is selected, then it does not escalate until the identical assertion repeats', () => {
  const selected = selectVerificationPolicy({
    ...BASE,
    priorOutcomes: [{ gateId: 'targeted', outcome: 'flaky', assertionId: 'once' }],
  });
  assert.equal(selected.level, 'direct');
  assert.ok(selected.reasonCodes.includes('single-flake-retry'));
});

test('Given malformed or misleading outcomes, when policy is selected, then policy fails closed', () => {
  const table = [
    [{ ...BASE, riskFlags: ['not-a-real-risk'] }, 'invalid-risk-flag'],
    [{ ...BASE, capabilityFresh: 'yes' }, 'invalid-input'],
    [{ ...BASE, priorOutcomes: [{ gateId: 'targeted', outcome: 'passed', assertionId: 'a', stale: true }] }, 'stale-outcome'],
    [{ ...BASE, priorOutcomes: [{ gateId: 'targeted', outcome: 'failed', assertionId: 'a' }], reportedCostSuccess: true }, 'prior-gate-failure'],
  ];
  for (const [input, reason] of table) {
    const selected = selectVerificationPolicy(input);
    assert.equal(selected.level, 'comprehensive', reason);
    assert.ok(selected.reasonCodes.includes(reason), reason);
  }
});

test('Given each policy level, when its gate set is emitted, then higher boundaries retain every lower gate', () => {
  const direct = selectVerificationPolicy(BASE);
  const affected = selectVerificationPolicy({ ...BASE, taskCategory: 'deep' });
  const comprehensive = selectVerificationPolicy({ ...BASE, taskCategory: 'ultrabrain' });
  assert.equal(direct.cost.actorCount, 1);
  assert.deepEqual(direct.gates, ['targeted-tests', 'final-assertions']);
  assert.ok(direct.gates.every((gate) => affected.gates.includes(gate)));
  assert.ok(affected.gates.every((gate) => comprehensive.gates.includes(gate)));
  assert.ok(comprehensive.gates.includes('paired-full-suites'));
  assert.ok(comprehensive.gates.includes('independent-review'));
  assert.ok(comprehensive.gates.includes('security-review'));
  assert.ok(comprehensive.gates.includes('real-surface'));
});

test('Given low-risk, affected, and release fixtures, when selected, then cost falls only where final assertions are preserved', () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    'fixtures',
    'verification-risk',
    'policy-fixtures.json',
  ), 'utf8'));
  for (const fixture of fixtures) {
    const selected = selectVerificationPolicy(fixture.input);
    assert.equal(selected.level, fixture.expected.level, fixture.name);
    assert.equal(selected.cost.fullSuiteInvocations, fixture.expected.fullSuiteInvocations, fixture.name);
    assert.equal(fixture.before.finalAssertions, fixture.expected.finalAssertions, fixture.name);
    assert.equal(selected.qualityAssertions, 'preserved', fixture.name);
  }
});
