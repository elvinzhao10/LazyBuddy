'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateCostOutcome } = require('../contracts/validate-lazyseries-record');

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const writer = path.join(__dirname, 'state', 'cost_outcome_telemetry.py');

function buildCostOutcome(result, runId, elapsedMs) {
  if (typeof runId !== 'string' || !IDENTITY.test(runId)) {
    throw new Error('Telemetry run_id must be a bounded identity.');
  }
  const route = result.scenario === 'direct' ? 'direct' : 'comprehensive';
  return {
    schema_version: 'lazyseries.cost-outcome.v1',
    run_id: runId,
    project_identity: `${result.product}/project`,
    route,
    risk_reason: route === 'direct' ? 'baseline-direct' : 'baseline-six-module',
    elapsed_ms: Math.max(0, Math.floor(elapsedMs)),
    tool_invocations: result.cost.invocation_count,
    agent_invocations: result.route.actor_count,
    evidence_bytes: result.cost.evidence_bytes,
    reruns: result.cost.reruns,
    rework_count: result.cost.rework,
    gate_outcomes: result.outcome.gate_outcomes.map(({ gate, outcome }) => ({ gate_id: gate, outcome })),
    tokens: {
      source: 'unavailable', input_tokens: null, output_tokens: null,
      unavailable_reason: 'native token telemetry unavailable from host',
    },
  };
}

function recordCostOutcome(projectRoot, record) {
  const validation = validateCostOutcome(record);
  if (!validation.ok) throw new Error(`Invalid cost outcome: ${validation.errors.join('; ')}`);
  const result = spawnSync(process.env.LAZYBUDDY_PYTHON || 'python3', [writer, projectRoot], {
    encoding: 'utf8',
    input: JSON.stringify(record),
    env: process.env,
  });
  if (result.status !== 0) {
    if (result.status === 86) process.exit(86);
    throw new Error(`Cost outcome telemetry write failed: ${result.stderr.trim()}`);
  }
}

module.exports = { buildCostOutcome, recordCostOutcome };
