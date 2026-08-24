#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildMachineStatus, validateMachineStatus } = require('./lifecycle/machine-status');

function invalid(code) {
  process.stderr.write(`${JSON.stringify({ error: code })}\n`);
  return 1;
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
    return invalid('INVALID_ARGUMENT');
  } catch {
    return invalid('MACHINE_STATUS_INVALID');
  }
}

process.exitCode = run(process.argv.slice(2));

module.exports = { run };
