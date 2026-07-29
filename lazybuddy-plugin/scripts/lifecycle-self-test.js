'use strict';

const { verifyStagedPackage } = require('./lifecycle/bootstrap');

const result = verifyStagedPackage(process.cwd(), 'LazyBuddy');
process.stdout.write(`${JSON.stringify({ product: 'LazyBuddy', status: 'passed', version: result.version })}\n`);
