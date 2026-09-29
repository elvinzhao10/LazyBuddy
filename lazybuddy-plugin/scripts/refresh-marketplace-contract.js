#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inventory } = require('./lifecycle/marketplace-routes');

const pluginRoot = path.resolve(__dirname, '..');
const releaseRoot = path.resolve(pluginRoot, '..');
const contractPath = path.join(pluginRoot, 'contracts', 'marketplace-route-contract.v1.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

for (const relative of Object.keys(contract.artifacts)) {
  contract.artifacts[relative] = sha256(fs.readFileSync(path.join(releaseRoot, relative)));
}
const records = inventory(pluginRoot, contract.payload);
contract.payload.file_count = records.length;
contract.payload.inventory_sha256 = sha256(Buffer.from(JSON.stringify(records)));
const bytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);
fs.writeFileSync(contractPath, bytes);
fs.writeFileSync(`${contractPath}.sha256`, `${sha256(bytes)}  marketplace-route-contract.v1.json\n`);
process.stdout.write(`contract refreshed: file_count=${records.length} inventory_sha256=${contract.payload.inventory_sha256}\n`);
