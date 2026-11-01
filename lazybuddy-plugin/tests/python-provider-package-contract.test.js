'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const capabilities = require('../tooling/capabilities.json');
const manifest = require('../tooling/lsp/python/package.json');
const lock = require('../tooling/lsp/python/package-lock.json');

test('Python fallback provider matches the locked installation package', () => {
  const provider = capabilities.capabilities.semantic_navigation.find(entry => entry.languages.includes('python'));
  const packages = Object.entries(manifest.dependencies).map(([name, version]) => `${name}@${version}`);

  assert.deepEqual(provider.fallback_packages, packages);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.equal(lock.packages['node_modules/basedpyright'].version, manifest.dependencies.basedpyright);
  assert.ok(Object.hasOwn(lock.packages['node_modules/basedpyright'].bin, provider.command));
});
