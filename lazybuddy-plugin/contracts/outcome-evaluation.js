'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateCompletionEvidence, validateCostOutcome } = require('./validate-lazyseries-record');

const CONDITIONS = ['host-only', 'minimal', 'full-lazy'];
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(field, message) {
  throw new Error(`${field}: ${message}`);
}

function identity(value, field) {
  if (typeof value !== 'string' || !IDENTITY.test(value)) fail(field, 'must be a bounded identity');
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(field, 'must be a sha256 digest');
  return value;
}

function commit(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) fail(field, 'must be a Git commit digest');
  return value;
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(field, 'has unexpected or missing fields');
  }
}

function readCheckedFile(evidenceRoot, reference, field) {
  exactKeys(reference, ['path', 'sha256'], field);
  const evidencePath = identity(reference.path, `${field}.path`);
  const root = fs.realpathSync(evidenceRoot);
  const target = path.resolve(root, evidencePath);
  if (!target.startsWith(`${root}${path.sep}`)) fail(`${field}.path`, 'must remain below evidence root');
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail(`${field}.path`, 'must name an existing regular file');
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${field}.path`, 'must name a regular file');
  const resolved = fs.realpathSync(target);
  if (!resolved.startsWith(`${root}${path.sep}`)) fail(`${field}.path`, 'must remain below evidence root after resolving links');
  const content = fs.readFileSync(resolved);
  const expected = digest(reference.sha256, `${field}.sha256`);
  if (crypto.createHash('sha256').update(content).digest('hex') !== expected) {
    fail(`${field}.sha256`, 'does not match referenced bytes');
  }
  return { content, sha256: expected };
}

function cohortKey(cohort, evidenceRoot) {
  exactKeys(cohort, [
    'task_id', 'repo_head', 'package_version', 'criterion_id', 'task_snapshot',
    'budget_snapshot', 'permissions_snapshot', 'host_id', 'host_build', 'model_id',
  ], 'cohort');
  const taskSnapshot = readCheckedFile(evidenceRoot, cohort.task_snapshot, 'cohort.task_snapshot');
  const budgetSnapshot = readCheckedFile(evidenceRoot, cohort.budget_snapshot, 'cohort.budget_snapshot');
  const permissionsSnapshot = readCheckedFile(evidenceRoot, cohort.permissions_snapshot, 'cohort.permissions_snapshot');
  let task;
  try {
    task = JSON.parse(taskSnapshot.content.toString('utf8'));
  } catch {
    fail('cohort.task_snapshot', 'must contain valid JSON');
  }
  if (!task || typeof task !== 'object' || Array.isArray(task)) fail('cohort.task_snapshot', 'must contain an object');
  if (task.task_id !== cohort.task_id) fail('cohort.task_snapshot.task_id', 'must match cohort.task_id');
  if (task.criterion_id !== cohort.criterion_id) fail('cohort.task_snapshot.criterion_id', 'must match cohort.criterion_id');
  return [
    identity(cohort.task_id, 'cohort.task_id'), commit(cohort.repo_head, 'cohort.repo_head'),
    identity(cohort.package_version, 'cohort.package_version'), identity(cohort.criterion_id, 'cohort.criterion_id'),
    taskSnapshot.sha256, budgetSnapshot.sha256, permissionsSnapshot.sha256,
    identity(cohort.host_id, 'cohort.host_id'), identity(cohort.host_build, 'cohort.host_build'),
    identity(cohort.model_id, 'cohort.model_id'),
  ].join('\n');
}

function readEvidence(evidenceRoot, outcome, cohort, runId) {
  exactKeys(outcome, ['state', 'evidence'], 'outcome');
  if (outcome.state !== 'verified') fail('outcome.state', 'must be verified when evidence is supplied');
  exactKeys(outcome.evidence, ['path', 'sha256'], 'outcome.evidence');
  const root = fs.realpathSync(evidenceRoot);
  const { content } = readCheckedFile(root, outcome.evidence, 'outcome.evidence');
  const evidence = JSON.parse(content.toString('utf8'));
  const validation = validateCompletionEvidence(evidence, {
    projectRoot: root,
    repoHead: cohort.repo_head,
    packageVersion: cohort.package_version,
    criterionId: cohort.criterion_id,
  });
  if (!validation.ok) fail('outcome.evidence', validation.errors.join('; '));
  if (evidence.task_id !== cohort.task_id) fail('outcome.evidence.task_id', 'must match cohort.task_id');
  if (evidence.run_id !== runId) fail('outcome.evidence.run_id', 'must match cost_outcome.run_id');
}

function evaluateRun(run, evidenceRoot, expectedCohort) {
  exactKeys(run, ['condition', 'cohort', 'cost_outcome', 'billing', 'outcome'], 'run');
  if (!CONDITIONS.includes(run.condition)) fail('run.condition', 'must name a supported condition');
  const key = cohortKey(run.cohort, evidenceRoot);
  if (expectedCohort && key !== expectedCohort) fail('cohort', 'must match host, model, task, budget, and permissions snapshots');
  const costValidation = validateCostOutcome(run.cost_outcome);
  if (!costValidation.ok) fail('cost_outcome', costValidation.errors.join('; '));
  if (run.cost_outcome.measurement_scope !== 'execution') {
    fail('cost_outcome.measurement_scope', 'must be execution for a matched outcome evaluation');
  }
  const runId = run.cost_outcome.run_id;
  exactKeys(run.billing, ['source', 'billed_cost_microusd', 'unavailable_reason'], 'billing');
  let billedCost = null;
  let costUnknown = null;
  if (run.billing.source === 'native' && Number.isSafeInteger(run.billing.billed_cost_microusd) && run.billing.billed_cost_microusd >= 0 && run.billing.unavailable_reason === null) {
    billedCost = run.billing.billed_cost_microusd;
  } else if (run.billing.source === 'unavailable' && run.billing.billed_cost_microusd === null && typeof run.billing.unavailable_reason === 'string' && run.billing.unavailable_reason.length > 0) {
    costUnknown = run.billing.unavailable_reason;
  } else {
    fail('billing', 'must contain native billed cost or an unavailable reason');
  }
  let verified = false;
  if (run.outcome && run.outcome.state === 'verified') {
    readEvidence(evidenceRoot, run.outcome, run.cohort, runId);
    verified = true;
  } else {
    exactKeys(run.outcome, ['state', 'unavailable_reason'], 'outcome');
    if (run.outcome.state !== 'unverified' || typeof run.outcome.unavailable_reason !== 'string' || run.outcome.unavailable_reason.length === 0) {
      fail('outcome', 'must contain verified evidence or an unverified reason');
    }
  }
  return { condition: run.condition, key, verified, tokens: run.cost_outcome.tokens, billedCost, costUnknown };
}

function summarize(records) {
  const summary = {};
  for (const condition of CONDITIONS) {
    const runs = records.filter((record) => record.condition === condition);
    const verified = runs.filter((record) => record.verified).length;
    const unknowns = [];
    const tokenUnknown = runs.find((record) => record.tokens.source === 'unavailable');
    const costUnknown = runs.find((record) => record.costUnknown !== null);
    if (tokenUnknown) unknowns.push(`tokens: ${tokenUnknown.tokens.unavailable_reason}`);
    if (costUnknown) unknowns.push(`cost: ${costUnknown.costUnknown}`);
    const nativeTokens = runs.filter((record) => record.tokens.source === 'native');
    const allCostsKnown = !costUnknown;
    let totalCost = null;
    if (allCostsKnown) {
      totalCost = 0;
      for (const record of runs) {
        totalCost += record.billedCost;
        if (!Number.isSafeInteger(totalCost)) fail('billing.billed_cost_microusd', 'total exceeds safe integer range');
      }
    }
    summary[condition] = {
      run_count: runs.length,
      verified_completions: verified,
      native_input_tokens: tokenUnknown ? null : nativeTokens.reduce((total, record) => total + record.tokens.input_tokens, 0),
      native_output_tokens: tokenUnknown ? null : nativeTokens.reduce((total, record) => total + record.tokens.output_tokens, 0),
      total_native_cost_microusd: totalCost,
      cost_per_verified_completion_microusd: totalCost === null || verified === 0 ? null : totalCost / verified,
      unknowns,
    };
  }
  return summary;
}

function evaluateManifest(manifest, evidenceRoot) {
  exactKeys(manifest, ['schema_version', 'runs'], 'manifest');
  if (manifest.schema_version !== 'lazyseries.outcome-evaluation.v1') fail('manifest.schema_version', 'is unsupported');
  if (!Array.isArray(manifest.runs) || manifest.runs.length < CONDITIONS.length) fail('manifest.runs', 'must contain the three comparison conditions');
  const records = [];
  const runIds = new Set();
  let key = null;
  for (const run of manifest.runs) {
    const record = evaluateRun(run, evidenceRoot, key);
    if (runIds.has(run.cost_outcome.run_id)) fail('cost_outcome.run_id', 'must not be replayed in one evaluation');
    runIds.add(run.cost_outcome.run_id);
    key ||= record.key;
    records.push(record);
  }
  for (const condition of CONDITIONS) {
    if (!records.some((record) => record.condition === condition)) fail('manifest.runs', `is missing ${condition}`);
  }
  const verified = records.filter((record) => record.verified).length;
  const integrity = verified === 0 ? 'absent' : verified === records.length ? 'validated' : 'partial';
  return { schema_version: 'lazyseries.outcome-evaluation-report.v1', outcome_evidence_integrity: integrity, conditions: summarize(records) };
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('usage: outcome-evaluation.js --evidence-root ABSOLUTE_ROOT MANIFEST.json\n');
    return;
  }
  if (argv.length !== 3 || argv[0] !== '--evidence-root' || !path.isAbsolute(argv[1])) {
    fail('arguments', 'usage: outcome-evaluation.js --evidence-root ABSOLUTE_ROOT MANIFEST.json');
  }
  const manifest = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
  process.stdout.write(`${JSON.stringify(evaluateManifest(manifest, argv[1]))}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { evaluateManifest, main };
