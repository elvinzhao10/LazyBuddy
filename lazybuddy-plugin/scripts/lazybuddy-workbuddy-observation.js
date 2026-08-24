#!/usr/bin/env node
'use strict';

const { LifecycleError } = require('./lifecycle/errors');
const { observe } = require('./lifecycle/workbuddy-observation');

const FLAGS = new Set(['--release-root', '--marketplace-receipt', '--observation', '--run-events', '--output', '--now']);

function parse(argv) {
  if (argv[0] !== 'observe') throw new LifecycleError('INVALID_ARGUMENT', 'command must be observe');
  const options = { json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') {
      if (options.json) throw new LifecycleError('INVALID_ARGUMENT', '--json may be provided only once');
      options.json = true;
      continue;
    }
    if (!FLAGS.has(flag)) throw new LifecycleError('INVALID_ARGUMENT', `unknown option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new LifecycleError('INVALID_ARGUMENT', `${flag} requires a value`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (options[key] !== undefined) throw new LifecycleError('INVALID_ARGUMENT', `${flag} may be provided only once`);
    options[key] = value;
    index += 1;
  }
  const required = ['releaseRoot', 'marketplaceReceipt', 'observation', 'runEvents', 'output'];
  if (required.some(key => options[key] === undefined)) throw new LifecycleError('INVALID_ARGUMENT', 'observe is missing required options');
  if (options.now === undefined) options.now = new Date().toISOString();
  return options;
}

function run(argv) {
  try {
    const result = observe(parse(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof LifecycleError ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${JSON.stringify({ status: 'error', error: { code, message: error.message } })}\n`);
    return 1;
  }
}

process.exitCode = run(process.argv.slice(2));
