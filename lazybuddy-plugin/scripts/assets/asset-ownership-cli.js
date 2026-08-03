#!/usr/bin/env node
'use strict';

const {
  checkAssets, installAssets, uninstallAssets,
} = require('./asset-ownership');

function parse(argv) {
  const command = argv[0];
  if (!['check', 'generate', 'uninstall'].includes(command)) throw new Error('command must be check, generate, or uninstall');
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--source-root', '--manifest', '--destination-root', '--receipt'].includes(flag) || value === undefined) {
      throw new Error('required flags: --source-root PATH --manifest PATH --destination-root PATH --receipt PATH');
    }
    values[flag.slice(2).replaceAll('-', '_')] = value;
  }
  const options = {
    sourceRoot: values.source_root,
    manifestPath: values.manifest,
    destinationRoot: values.destination_root,
    receiptPath: values.receipt,
  };
  if (Object.values(options).some((value) => typeof value !== 'string')) {
    throw new Error('required flags: --source-root PATH --manifest PATH --destination-root PATH --receipt PATH');
  }
  return { command, options };
}

function main(argv) {
  const request = parse(argv);
  const result = request.command === 'generate'
    ? installAssets(request.options)
    : request.command === 'check' ? checkAssets(request.options) : uninstallAssets(request.options);
  if (request.command === 'check' && result.issues.length) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
