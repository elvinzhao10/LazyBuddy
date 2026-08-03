#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { validateMarketplaceRoutes } = require('./lifecycle/marketplace-routes');

const releaseRoot = process.argv[2] === undefined ? path.resolve(__dirname, '..', '..') : path.resolve(process.argv[2]);
try {
  const result = validateMarketplaceRoutes(releaseRoot);
  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    version: result.version,
    codebuddy: result.codebuddy.plugin,
    workbuddy: result.workbuddy.plugin,
    payload_files: result.codebuddy.payload_inventory.length,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.code || 'MARKETPLACE_ROUTE_INVALID', message: error.message })}\n`);
  process.exitCode = 1;
}
