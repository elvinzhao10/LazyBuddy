#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildMachineStatus, validateMachineStatus } = require('./lifecycle/machine-status');
const { CURRENT_VERSION } = require('./lifecycle/version');

function invalid(code) {
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
}

// T6 — Material verification status (additive surface).
//
// The default package-readiness status (buildMachineStatus) is unchanged and
// still validates against the v2 schema. This separate projection answers the
// runtime question "what actually needs attention?": outcome, current milestone,
// blockers/decisions, next action, and ONLY material verification state (the
// failing checks plus an aggregate green count) — never per-command noise.
const TIER_ORDER = Object.freeze({ V0: 0, V1: 1, V2: 2, V3: 3 });

function highestTier(tiers) {
  let best = null;
  for (const tier of tiers) {
    if (best === null || (TIER_ORDER[tier] ?? -1) > (TIER_ORDER[best] ?? -1)) best = tier;
  }
  return best;
}

function materialVerificationStatus(receipts) {
  const list = Array.isArray(receipts) ? receipts : [];
  if (list.length === 0) {
    return { outcome: 'none', highest_tier: null, material_checks: [], green_count: 0, total: 0 };
  }
  const failures = list.filter((receipt) => receipt && receipt.result !== 'pass');
  const material = failures.map((receipt) => ({
    tier: receipt.tier,
    surface: receipt.surface,
    covered_behavior: receipt.covered_behavior,
    result: receipt.result,
  }));
  return {
    outcome: failures.length > 0 ? 'fail' : 'pass',
    highest_tier: highestTier(list.map((receipt) => receipt.tier)),
    material_checks: material,
    green_count: list.length - failures.length,
    total: list.length,
  };
}

function buildMaterialVerificationStatus(pluginRoot, receiptsPath) {
  const releaseRoot = pluginRoot || path.resolve(__dirname, '..', '..');
  let receipts = [];
  if (receiptsPath) {
    try {
      receipts = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
    } catch {
      receipts = [];
    }
  }
  const verification = materialVerificationStatus(receipts);
  // Outcome, current milestone, blockers/decisions, next action, and material
  // verification state only. Status stays actionable, never a command log.
  return {
    product: 'LazyBuddy',
    version: CURRENT_VERSION,
    status: verification.outcome === 'fail' ? 'action-required' : 'ready',
    current_milestone: null,
    blockers_decisions: [],
    next_action: verification.outcome === 'fail'
      ? 'rerun the failed check(s) and any directly affected integration check'
      : 'none pending',
    verification,
  };
}

function run(argv) {
  try {
    if (argv.length === 1 && argv[0] === '--json') {
      const releaseRoot = path.resolve(__dirname, '..', '..');
      process.stdout.write(`${JSON.stringify(buildMachineStatus(releaseRoot))}\n`);
      return 0;
    }
    if (argv.length === 2 && argv[0] === '--validate') {
      const value = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
      validateMachineStatus(value);
      process.stdout.write(`${JSON.stringify(value)}\n`);
      return 0;
    }
    // T6 additive surface: --material [--receipts <file>]
    if (argv.length >= 1 && argv[0] === '--material') {
      let receiptsPath = null;
      for (let index = 1; index < argv.length; index += 1) {
        if (argv[index] === '--receipts') {
          receiptsPath = argv[index + 1];
          index += 1;
        }
      }
      const releaseRoot = path.resolve(__dirname, '..', '..');
      process.stdout.write(`${JSON.stringify(buildMaterialVerificationStatus(releaseRoot, receiptsPath))}\n`);
      return 0;
    }
    return invalid('INVALID_ARGUMENT');
  } catch {
    return invalid('MACHINE_STATUS_INVALID');
  }
}

process.exitCode = run(process.argv.slice(2));

module.exports = { run, buildMaterialVerificationStatus, materialVerificationStatus };
