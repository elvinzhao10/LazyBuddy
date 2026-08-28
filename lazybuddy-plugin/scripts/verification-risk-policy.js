'use strict';

const TASK_CATEGORIES = ['quick', 'deep', 'ultrabrain', 'visual-engineering', 'writing', 'review'];
const RISK_FLAGS = [
  'dependency',
  'contract',
  'public-contract',
  'security',
  'release',
  'cross-repo',
  'concurrency',
  'dirty',
];

const LEVELS = ['direct', 'affected', 'comprehensive'];
const GATES = {
  direct: ['targeted-tests', 'final-assertions'],
  affected: ['targeted-tests', 'dependency-tests', 'contract-tests', 'final-assertions'],
  comprehensive: [
    'targeted-tests',
    'dependency-tests',
    'contract-tests',
    'paired-full-suites',
    'independent-review',
    'security-review',
    'real-surface',
    'final-assertions',
  ],
};

const PATH_ESCALATIONS = [
  ['public-contract-change', /(^|\/)(contracts?|schemas?)(\/|$)|\.schema\.json$/],
  ['version-change', /(^|\/)(package(?:-lock)?\.json|pyproject\.toml|cargo\.toml|version(?:\.txt)?)(\/|$)/],
  ['lifecycle-change', /(^|\/)(lifecycle|launcher|onboard|offboard|update|rollback)([./_-]|$)/],
  ['security-change', /(^|\/)(security|auth|permission|credential)([./_-]|$)/],
  ['host-adapter-change', /(^|\/)(hosts?|adapters?)(\/|$)|(^|\/)(?:host|trae|codebuddy|workbuddy)[^/]*\.(?:js|py|json)$|(?:traecode|codebuddy|workbuddy|traework).*adapter/],
  ['shared-state-change', /(^|\/)(state|transaction|execution-isolation|lease)([./_-]|$)/],
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escalate(current, candidate) {
  return LEVELS.indexOf(candidate) > LEVELS.indexOf(current) ? candidate : current;
}

function costFor(level, gates) {
  return {
    actorCount: level === 'comprehensive' ? 2 : 1,
    targetedInvocations: 1,
    dependencyContractInvocations: level === 'direct' ? 0 : 2,
    fullSuiteInvocations: level === 'comprehensive' ? 2 : 0,
    gateInvocations: gates.length,
  };
}

function comprehensive(reasonCodes) {
  const gates = [...GATES.comprehensive];
  return {
    level: 'comprehensive',
    reasonCodes: [...new Set(reasonCodes)],
    gates,
    cost: costFor('comprehensive', gates),
    qualityAssertions: 'preserved',
  };
}

function parseInput(input) {
  if (!isObject(input)) return { ok: false, reasons: ['invalid-input'] };
  const reasons = [];
  if (!TASK_CATEGORIES.includes(input.taskCategory)) reasons.push('invalid-task-category');
  if (!Array.isArray(input.changedPaths) || input.changedPaths.some((item) => typeof item !== 'string')) reasons.push('invalid-input');
  if (!Array.isArray(input.riskFlags)) reasons.push('invalid-input');
  const invalidRisk = Array.isArray(input.riskFlags)
    && input.riskFlags.some((item) => typeof item !== 'string' || !RISK_FLAGS.includes(item));
  if (invalidRisk) reasons.push('invalid-risk-flag');
  if (typeof input.capabilityFresh !== 'boolean'
    || typeof input.evidenceFresh !== 'boolean'
    || typeof input.dirtyTree !== 'boolean') reasons.push('invalid-input');
  if (!Array.isArray(input.priorOutcomes)) reasons.push('invalid-input');
  const outcomesValid = Array.isArray(input.priorOutcomes) && input.priorOutcomes.every((outcome) => (
    isObject(outcome)
    && typeof outcome.gateId === 'string'
    && ['passed', 'failed', 'flaky'].includes(outcome.outcome)
    && (outcome.assertionId === undefined || typeof outcome.assertionId === 'string')
    && (outcome.stale === undefined || typeof outcome.stale === 'boolean')
  ));
  if (!outcomesValid) reasons.push('invalid-input');
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, input };
}

function selectVerificationPolicy(untrustedInput) {
  const parsed = parseInput(untrustedInput);
  if (!parsed.ok) return comprehensive(parsed.reasons);
  const input = parsed.input;
  const categoryLevel = {
    quick: 'direct',
    deep: 'affected',
    ultrabrain: 'comprehensive',
    'visual-engineering': 'affected',
    writing: 'direct',
    review: 'affected',
  };
  let level = categoryLevel[input.taskCategory];
  const reasonCodes = [`category-${input.taskCategory}`];

  for (const riskFlag of input.riskFlags) {
    reasonCodes.push(riskFlag);
    level = escalate(level, ['dependency', 'contract'].includes(riskFlag) ? 'affected' : 'comprehensive');
  }

  for (const changedPath of input.changedPaths) {
    const normalized = changedPath.replaceAll('\\', '/').toLowerCase();
    for (const [reason, pattern] of PATH_ESCALATIONS) {
      if (pattern.test(normalized)) {
        reasonCodes.push(reason);
        level = 'comprehensive';
      }
    }
  }

  if (!input.capabilityFresh) {
    reasonCodes.push('stale-capability');
    level = 'comprehensive';
  }
  if (!input.evidenceFresh) {
    reasonCodes.push('stale-evidence');
    level = 'comprehensive';
  }
  if (input.dirtyTree) {
    reasonCodes.push('dirty-tree');
    level = 'comprehensive';
  }

  const flakyCounts = new Map();
  for (const outcome of input.priorOutcomes) {
    if (outcome.stale === true) {
      reasonCodes.push('stale-outcome');
      level = 'comprehensive';
    }
    if (outcome.outcome === 'failed') {
      reasonCodes.push('prior-gate-failure');
      level = 'comprehensive';
    }
    if (outcome.outcome === 'flaky' && outcome.assertionId) {
      flakyCounts.set(outcome.assertionId, (flakyCounts.get(outcome.assertionId) || 0) + 1);
    }
  }
  if ([...flakyCounts.values()].some((count) => count >= 2)) {
    reasonCodes.push('repeated-flake');
    level = 'comprehensive';
  } else if ([...flakyCounts.values()].some((count) => count === 1)) {
    reasonCodes.push('single-flake-retry');
  }

  const gates = [...GATES[level]];
  return {
    level,
    reasonCodes: [...new Set(reasonCodes)],
    gates,
    cost: costFor(level, gates),
    qualityAssertions: 'preserved',
  };
}

module.exports = { RISK_FLAGS, TASK_CATEGORIES, selectVerificationPolicy };
