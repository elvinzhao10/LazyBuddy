#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const Ajv2020 = require('ajv/dist/2020');

function reply(status) {
  process.stdout.write(`${JSON.stringify({ status })}\n`);
}

let request;
try {
  request = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  reply('invalid_request');
  process.exit(2);
}

if (request === null || typeof request !== 'object' || Array.isArray(request)) {
  reply('invalid_request');
  process.exit(2);
}

try {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(request.schema);
  if (request.action === 'compile') {
    reply('valid');
  } else if (request.action === 'validate') {
    reply(validate(request.value) ? 'valid' : 'mismatch');
  } else {
    reply('invalid_request');
    process.exitCode = 2;
  }
} catch {
  reply('invalid_schema');
  process.exitCode = 1;
}
