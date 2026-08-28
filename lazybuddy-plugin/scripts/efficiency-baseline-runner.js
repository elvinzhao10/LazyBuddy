#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const CONTRACT_VERSION = 'lazyseries-efficiency-baseline.v1';
const REQUIRED_GATES = ['completion-classification', 'exact-test-assertions', 'required-evidence'];

class BaselineContractError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'BaselineContractError';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) throw new BaselineContractError(field, 'must be an object');
  return value;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BaselineContractError(field, 'must be a non-empty string');
  }
  return value;
}

function requireInteger(value, field, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new BaselineContractError(field, `must be an integer >= ${minimum}`);
  }
  return value;
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BaselineContractError(field, 'must be a non-empty array');
  }
  const entries = value.map((entry, index) => requireString(entry, `${field}[${index}]`));
  if (new Set(entries).size !== entries.length) {
    throw new BaselineContractError(field, 'must not contain duplicates');
  }
  return entries;
}

function parseTokens(value, field) {
  const tokens = requireRecord(value, field);
  if (tokens.available !== false) {
    throw new BaselineContractError(`${field}.available`, 'must be false for these host baselines');
  }
  if (tokens.total !== null) {
    throw new BaselineContractError(`${field}.total`, 'must be null when unavailable');
  }
  return {
    available: false,
    total: null,
    reason: requireString(tokens.reason, `${field}.reason`),
  };
}

function parseCost(value, field) {
  const cost = requireRecord(value, field);
  const elapsed = cost.elapsed_ms;
  if (elapsed !== null) requireInteger(elapsed, `${field}.elapsed_ms`);
  if (elapsed === null) {
    requireString(cost.elapsed_unavailable_reason, `${field}.elapsed_unavailable_reason`);
  }
  return {
    elapsed_ms: elapsed,
    ...(elapsed === null ? { elapsed_unavailable_reason: cost.elapsed_unavailable_reason } : {}),
    invocation_count: requireInteger(cost.invocation_count, `${field}.invocation_count`, 1),
    evidence_bytes: requireInteger(cost.evidence_bytes, `${field}.evidence_bytes`),
    reruns: requireInteger(cost.reruns, `${field}.reruns`),
    rework: requireInteger(cost.rework, `${field}.rework`),
    concurrency: requireInteger(cost.concurrency, `${field}.concurrency`, 1),
    tokens: parseTokens(cost.tokens, `${field}.tokens`),
  };
}

function parseGates(value, field) {
  if (!Array.isArray(value) || value.length !== REQUIRED_GATES.length) {
    throw new BaselineContractError(field, `must contain exactly ${REQUIRED_GATES.length} outcomes`);
  }
  const gates = value.map((entry, index) => {
    const gate = requireRecord(entry, `${field}[${index}]`);
    const name = requireString(gate.gate, `${field}[${index}].gate`);
    if (gate.outcome !== 'passed') {
      throw new BaselineContractError(`${field}[${index}].outcome`, 'must be passed');
    }
    return { gate: name, outcome: 'passed' };
  });
  const names = gates.map(({ gate }) => gate).sort();
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_GATES)) {
    throw new BaselineContractError(field, `must contain ${REQUIRED_GATES.join(', ')}`);
  }
  return gates;
}

function parseManifest(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BaselineContractError(field, 'must be a non-empty array');
  }
  return value.map((entry, index) => {
    const item = requireRecord(entry, `${field}[${index}]`);
    const sha256 = requireString(item.sha256, `${field}[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new BaselineContractError(`${field}[${index}].sha256`, 'must be lowercase SHA-256');
    }
    return {
      file: requireString(item.file, `${field}[${index}].file`),
      count: requireInteger(item.count, `${field}[${index}].count`, 1),
      sha256,
    };
  });
}

function parseFixture(value) {
  const fixture = requireRecord(value, 'fixture');
  if (fixture.contract_version !== CONTRACT_VERSION) {
    throw new BaselineContractError('contract_version', `must be ${CONTRACT_VERSION}`);
  }
  if (!['direct', 'six-module'].includes(fixture.scenario)) {
    throw new BaselineContractError('scenario', 'must be direct or six-module');
  }
  const route = requireRecord(fixture.route, 'route');
  const actorCount = requireInteger(route.actor_count, 'route.actor_count', 1);
  if (fixture.scenario === 'direct' && actorCount !== 1) {
    throw new BaselineContractError('route.actor_count', 'direct route must use exactly one actor');
  }
  const quality = requireRecord(fixture.quality, 'quality');
  const expected = requireInteger(quality.assertions_expected, 'quality.assertions_expected', 1);
  const passed = requireInteger(quality.assertions_passed, 'quality.assertions_passed');
  const manifest = parseManifest(quality.assertion_manifest, 'quality.assertion_manifest');
  const represented = manifest.reduce((total, item) => total + item.count, 0);
  if (represented !== expected) {
    throw new BaselineContractError('quality.assertion_manifest', 'counts must equal assertions_expected');
  }
  if (passed !== expected) {
    throw new BaselineContractError('quality.assertions_passed', 'must equal assertions_expected');
  }
  if (quality.completion !== 'complete') {
    throw new BaselineContractError('quality.completion', 'must be complete');
  }
  return {
    contract_version: CONTRACT_VERSION,
    product: requireString(fixture.product, 'product'),
    scenario: fixture.scenario,
    route: {
      classification: requireString(route.classification, 'route.classification'),
      actor_count: actorCount,
    },
    quality: {
      assertions_expected: expected,
      assertions_passed: passed,
      completion: 'complete',
      assertion_manifest: manifest,
      required_evidence: requireStringArray(quality.required_evidence, 'quality.required_evidence'),
    },
    gate_outcomes: parseGates(fixture.gate_outcomes, 'gate_outcomes'),
    cost: parseCost(fixture.cost, 'cost'),
  };
}

function validateResult(value) {
  const result = requireRecord(value, 'result');
  if (result.contract_version !== CONTRACT_VERSION) {
    throw new BaselineContractError('result.contract_version', `must be ${CONTRACT_VERSION}`);
  }
  requireString(result.product, 'result.product');
  if (!['direct', 'six-module'].includes(result.scenario)) {
    throw new BaselineContractError('result.scenario', 'must be direct or six-module');
  }
  const route = requireRecord(result.route, 'result.route');
  const actorCount = requireInteger(route.actor_count, 'result.route.actor_count', 1);
  if (result.scenario === 'direct' && actorCount !== 1) {
    throw new BaselineContractError('result.route.actor_count', 'direct route must use exactly one actor');
  }
  requireString(route.classification, 'result.route.classification');
  const outcome = requireRecord(result.outcome, 'result.outcome');
  const expected = requireInteger(outcome.assertions_expected, 'result.outcome.assertions_expected', 1);
  const passed = requireInteger(outcome.assertions_passed, 'result.outcome.assertions_passed');
  if (passed !== expected || outcome.quality_equivalent !== true) {
    throw new BaselineContractError('result.outcome.quality_equivalent', 'requires all exact assertions');
  }
  if (outcome.completion !== 'complete' || outcome.required_evidence_present !== true) {
    throw new BaselineContractError('result.outcome', 'requires completion and evidence');
  }
  const manifest = parseManifest(outcome.assertion_manifest, 'result.outcome.assertion_manifest');
  const represented = manifest.reduce((total, item) => total + item.count, 0);
  if (represented !== expected) {
    throw new BaselineContractError(
      'result.outcome.assertion_manifest',
      'counts must equal assertions_expected',
    );
  }
  requireStringArray(outcome.required_evidence, 'result.outcome.required_evidence');
  parseGates(outcome.gate_outcomes, 'result.outcome.gate_outcomes');
  parseCost(result.cost, 'result.cost');
  return value;
}

function buildResult(fixture) {
  return validateResult({
    contract_version: fixture.contract_version,
    product: fixture.product,
    scenario: fixture.scenario,
    route: fixture.route,
    outcome: {
      assertions_expected: fixture.quality.assertions_expected,
      assertions_passed: fixture.quality.assertions_passed,
      completion: fixture.quality.completion,
      assertion_manifest: fixture.quality.assertion_manifest,
      required_evidence: fixture.quality.required_evidence,
      required_evidence_present: true,
      gate_outcomes: fixture.gate_outcomes,
      quality_equivalent: true,
    },
    cost: fixture.cost,
  });
}

function main(argv) {
  if (argv.length !== 1) throw new BaselineContractError('arguments', 'expected one fixture JSON path');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
  } catch (error) {
    throw new BaselineContractError('fixture', `must be valid JSON: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify(buildResult(parseFixture(raw)))}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { BaselineContractError, buildResult, parseFixture, validateResult };
