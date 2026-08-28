#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  BaselineContractError,
  parseFixture,
  validateResult,
} = require('./efficiency-baseline-contract');
const { verifyFixtureEvidence } = require('./efficiency-baseline-evidence');

function buildResult(fixture, evidenceRoot) {
  const integrity = verifyFixtureEvidence(evidenceRoot, fixture);
  const expected = fixture.quality.assertions_expected;
  if (integrity.assertionsRepresented !== expected) {
    throw new BaselineContractError(
      'quality.assertion_manifest',
      `derived ${integrity.assertionsRepresented}, expected ${expected}`,
    );
  }
  if (integrity.assertionsPassed !== expected) {
    throw new BaselineContractError(
      'quality.assertion_output',
      `derived ${integrity.assertionsPassed}, expected ${expected}`,
    );
  }
  const requiredEvidencePresent = fixture.quality.required_evidence.length > 0;
  const qualityEquivalent =
    integrity.assertionsRepresented === expected && integrity.assertionsPassed === expected;
  return validateResult({
    contract_version: fixture.contract_version,
    product: fixture.product,
    scenario: fixture.scenario,
    route: fixture.route,
    outcome: {
      assertions_expected: expected,
      assertions_passed: integrity.assertionsPassed,
      completion: fixture.quality.completion,
      assertion_manifest: fixture.quality.assertion_manifest,
      required_evidence: fixture.quality.required_evidence,
      required_evidence_present: requiredEvidencePresent,
      gate_outcomes: fixture.gate_outcomes,
      quality_equivalent: qualityEquivalent,
    },
    cost: fixture.cost,
  });
}

function main(argv) {
  if (argv.length !== 3 || argv[1] !== '--eval-root') {
    throw new BaselineContractError(
      'arguments',
      'expected <fixture-json> --eval-root <absolute-eval-root>',
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
  } catch (error) {
    throw new BaselineContractError('fixture', `must be valid JSON: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify(buildResult(parseFixture(raw), argv[2]))}\n`);
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
