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
  if (!['completion', 'cost'].includes(kind) || !file) {
    throw new Error('usage: validate-lazyseries-record.js completion|cost [options] RECORD.json');
  }
  return { kind, file, options };
}

function main(argv) {
  try {
    const { kind, file, options } = parseArguments(argv);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = kind === 'completion'
      ? validateCompletionEvidence(record, options)
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

module.exports = { main, validateCompletionEvidence, validateCostOutcome };
