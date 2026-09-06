'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadAjv2020() {
  const candidates = [
    path.resolve(__dirname, '../tooling/node_modules/ajv/dist/2020'),
    path.resolve(__dirname, '../node_modules/ajv/dist/2020'),
  ];
  const candidate = candidates.find((entry) => fs.existsSync(`${entry}.js`));
  if (candidate) return require(candidate);
  try {
    return require('ajv/dist/2020');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error('AJV dependency is not installed for contract validation');
    }
    throw error;
  }
}

const Ajv2020 = loadAjv2020();
const ajv = new Ajv2020({ allErrors: true, strict: false });

function compile(name) {
  const file = path.join(__dirname, name);
  return ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const validateCompletionSchema = compile('lazyseries-completion-evidence.v1.schema.json');
const validateCostSchema = compile('lazyseries-cost-outcome.v1.schema.json');
const validateExecutionSchema = compile('lazyseries-execution-context.v1.schema.json');
const REVIEW_LANES = [
  'goal-verification', 'manual-qa', 'code-quality', 'security', 'context-mining',
];
const UNSAFE_ARGV = new Set([';', '&&', '||', '|', '>', '>>', '<', '<<']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);

function fieldPath(error) {
  const base = error.instancePath.replaceAll('/', '.').replace(/^\./, '');
  if (error.keyword === 'required') return [base, error.params.missingProperty].filter(Boolean).join('.');
  if (error.keyword === 'additionalProperties') {
    return [base, error.params.additionalProperty].filter(Boolean).join('.');
  }
  return base || 'record';
}

function schemaErrors(validate) {
  return (validate.errors || []).map((error) => {
    const field = fieldPath(error);
    return error.keyword === 'additionalProperties'
      ? `${field}: unexpected key`
      : `${field}: ${error.message}`;
  });
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateCompletionEvidence(record, context) {
  if (!validateCompletionSchema(record)) return { ok: false, errors: schemaErrors(validateCompletionSchema) };
  const errors = [];
  const expected = [
    ['repo_head', context.repoHead],
    ['package_version', context.packageVersion],
    ['criterion_id', context.criterionId],
  ];
  for (const [field, value] of expected) {
    if (record[field] !== value) errors.push(`${field}: expected ${value}`);
  }
  if (record.executor.identity === record.verifier.identity) {
    errors.push('verifier.identity: must differ from executor.identity');
  }
  if (Date.parse(record.finished_at) < Date.parse(record.started_at)) {
    errors.push('finished_at: must not precede started_at');
  }
  const root = fs.realpathSync(context.projectRoot);
  const target = path.resolve(root, record.artifact.path);
  if (!target.startsWith(`${root}${path.sep}`)) {
    errors.push('artifact.path: must remain below project root');
  } else {
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push('artifact.path: must name a regular project file');
      } else if (digest(target) !== record.artifact.sha256) {
        errors.push('artifact.sha256: does not match artifact bytes');
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') errors.push('artifact.path: file does not exist');
      else throw error;
    }
  }
  return { ok: errors.length === 0, errors };
}

function findSensitiveValue(value, location = 'record') {
  if (typeof value === 'string') {
    if (/(?:^|[/\\])(?:Users|home)(?:[/\\])|^~|(?:sk-|api[_-]?key[=:]|password[=:]|secret[=:])/i.test(value)) {
      return location;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveValue(value[index], `${location}.${index}`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findSensitiveValue(child, location === 'record' ? key : `${location}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

function validateCostOutcome(record) {
  if (!validateCostSchema(record)) return { ok: false, errors: schemaErrors(validateCostSchema) };
  const sensitive = findSensitiveValue(record);
  const errors = sensitive ? [`${sensitive}: contains a secret or home path`] : [];
  return { ok: errors.length === 0, errors };
}

function sameMembers(left, right) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function validateExecutionContext(record, context) {
  if (!validateExecutionSchema(record)) return { ok: false, errors: schemaErrors(validateExecutionSchema) };
  const errors = [];
  if (!sameMembers(record.delta.owned_paths, record.pre_task.owned_paths.map(({ path: ownedPath }) => ownedPath))) {
    errors.push('pre_task.owned_paths: must cover exactly the task-owned paths');
  }
  for (const command of record.command_validation.commands) {
    const executable = path.basename(command.argv[0]).toLowerCase();
    const evaluatesCode = SHELLS.has(executable)
      && command.argv.slice(1).some((part) => ['-c', '/c', '-command'].includes(part.toLowerCase()));
    if (evaluatesCode || command.argv.some((part) => UNSAFE_ARGV.has(part) || /[\r\n]/.test(part))) {
      errors.push('command_validation.commands.argv: unsafe shell token');
    }
  }
  if (!sameMembers(record.task.criterion_ids, record.criteria.map(({ criterion_id: id }) => id))) {
    errors.push('criteria: must cover exactly task.criterion_ids');
  }
  for (const criterion of record.criteria) {
    if (['runtime', 'stateful'].includes(criterion.kind)
      && !criterion.observations.includes('real-entry')) {
      errors.push(`${criterion.criterion_id}: runtime evidence requires real-entry`);
    }
    if (criterion.kind === 'stateful' && !criterion.observations.includes('state-transition')) {
      errors.push(`${criterion.criterion_id}: stateful evidence requires state-transition`);
    }
  }
  const terminal = record.recovery.terminal_report;
  if (record.recovery.accepted) {
    if (!record.recovery.attempted || !terminal) {
      errors.push('recovery.terminal_report: accepted recovery requires a complete report');
    } else {
      for (const field of ['run_id', 'task_id', 'repo_head']) {
        if (terminal[field] !== record.task[field]) {
          errors.push(`terminal_report.${field}: must match current task identity`);
        }
      }
      if (!sameMembers(terminal.criterion_ids, record.task.criterion_ids)) {
        errors.push('terminal_report.criterion_ids: must cover exactly current criteria');
      }
      const root = fs.realpathSync(context.projectRoot);
      for (const artifact of terminal.artifact_refs) {
        const target = path.resolve(root, artifact);
        if (!target.startsWith(`${root}${path.sep}`)) {
          errors.push(`terminal_report.artifact_refs: ${artifact} escapes project root`);
          continue;
        }
        try {
          const stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            errors.push(`terminal_report.artifact_refs: ${artifact} is not a regular file`);
          }
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            errors.push(`terminal_report.artifact_refs: ${artifact} is missing`);
          } else throw error;
        }
      }
    }
  }
  if ((record.memory_update === 'accepted') !== record.recovery.accepted) {
    errors.push('memory_update: accepted only with accepted terminal recovery');
  }
  if (record.review.lanes.map(({ lane_id: id }) => id).some((id, index) => id !== REVIEW_LANES[index])) {
    errors.push('review.lanes: must contain the five lanes in canonical order');
  }
  for (const lane of record.review.lanes) {
    const affected = lane.previous !== 'PASS' || lane.stale || lane.input_affected;
    if (lane.rerun !== affected) {
      errors.push(`review.${lane.lane_id}.rerun: must equal failed, missing, stale, or input-affected status`);
    }
  }
  if (record.review.complete && record.review.lanes.some(({ current }) => current !== 'PASS')) {
    errors.push('review.complete: requires all five current PASS verdicts');
  }
  return { ok: errors.length === 0, errors };
}

function parseArguments(argv) {
  const [kind, ...rest] = argv;
  const options = {};
  let file = null;
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (current.startsWith('--')) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${current}: requires a value`);
      options[current.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (file === null) file = current;
    else throw new Error(`unexpected argument: ${current}`);
  }
  if (!['completion', 'cost', 'execution'].includes(kind) || !file) {
    throw new Error('usage: validate-lazyseries-record.js completion|cost|execution [options] RECORD.json');
  }
  return { kind, file, options };
}

function main(argv) {
  try {
    const { kind, file, options } = parseArguments(argv);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = kind === 'completion'
      ? validateCompletionEvidence(record, options)
      : kind === 'execution'
        ? validateExecutionContext(record, options)
        : validateCostOutcome(record);
    if (!result.ok) {
      process.stderr.write(`${result.errors.join('\n')}\n`);
      return 1;
    }
    process.stdout.write(`PASS: ${kind} record valid\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`record: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  main, validateCompletionEvidence, validateCostOutcome, validateExecutionContext,
};
