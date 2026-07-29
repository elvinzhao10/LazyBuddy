#!/usr/bin/env node
'use strict';

const { run } = require('./lifecycle/cli');

process.exitCode = run(process.argv.slice(2));
