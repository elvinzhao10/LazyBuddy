#!/usr/bin/env node
'use strict';

const { LifecycleError } = require('./lifecycle/errors');
const { createTemplate, ingestObservation } = require('./lifecycle/codebuddy-ide-surfaces');
const { createEvidenceTemplate, ingestEvidenceObservation } = require('./lifecycle/codebuddy-ide-evidence');

const VALUE_FLAGS = new Set([
  '--branch', '--generated-at', '--marketplace', '--now', '--observation', '--output', '--primary-root', '--project-root', '--template',
]);

function parse(argv) {
  const command = argv[0];
  if (!['template', 'observe', 'evidence-template', 'evidence-observe'].includes(command)) {
    throw new LifecycleError('INVALID_ARGUMENT', 'command must be template, observe, evidence-template, or evidence-observe');
  }
  const options = { command, projectRoots: [], json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') {
      if (options.json) throw new LifecycleError('INVALID_ARGUMENT', '--json may be provided only once');
      options.json = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new LifecycleError('INVALID_ARGUMENT', `unknown option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new LifecycleError('INVALID_ARGUMENT', `${flag} requires a value`);
    if (flag === '--project-root') options.projectRoots.push(value);
    else {
      const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (options[key] !== undefined) throw new LifecycleError('INVALID_ARGUMENT', `${flag} may be provided only once`);
      options[key] = value;
    }
    index += 1;
  }
  const required = command === 'template' ? ['branch', 'marketplace', 'output']
    : command === 'evidence-template' ? ['output', 'template']
      : ['observation', 'output', 'template'];
  const missing = required.filter(key => options[key] === undefined);
  if (missing.length > 0 || (command === 'template' && options.projectRoots.length === 0)) {
    throw new LifecycleError('INVALID_ARGUMENT', `${command} is missing required options`);
  }
  if (['template', 'evidence-template'].includes(command) && options.generatedAt === undefined) options.generatedAt = new Date().toISOString();
  if (['observe', 'evidence-observe'].includes(command) && options.now === undefined) options.now = new Date().toISOString();
  return options;
}

function run(argv) {
  try {
    const options = parse(argv);
    const result = options.command === 'template' ? createTemplate(options)
      : options.command === 'observe' ? ingestObservation(options)
        : options.command === 'evidence-template' ? createEvidenceTemplate(options)
          : ingestEvidenceObservation(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof LifecycleError ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${JSON.stringify({ status: 'error', error: { code, message: error.message } })}\n`);
    return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
