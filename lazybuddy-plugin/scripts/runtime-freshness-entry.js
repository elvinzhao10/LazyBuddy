'use strict';

const fs = require('node:fs');
const {
  recordCriterionOutcome,
  resumeContinuation,
} = require('./runtime-freshness');

try {
  const action = process.argv[2];
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (action === 'resume') {
    process.stdout.write(JSON.stringify(resumeContinuation(input)) + '\n');
  } else if (action === 'criterion') {
    process.stdout.write(JSON.stringify(recordCriterionOutcome(process.argv[3], input)) + '\n');
  } else {
    throw new Error('UNKNOWN_RUNTIME_FRESHNESS_ACTION');
  }
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
