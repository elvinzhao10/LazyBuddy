#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HOSTS = Object.freeze(['codebuddy-cli', 'codebuddy-ide', 'workbuddy', 'trae-cli', 'trae-ide', 'trae-work']);
const PRODUCTS = Object.freeze(['lazybuddy', 'lazytrae']);
const EXCLUDED_SEGMENTS = new Set(['.git', '.cache', 'cache', 'caches', 'secrets', 'runtime', 'state', 'manifests', 'receipts']);
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;

class ContractError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

function refuse(condition, code, detail) {
  if (condition) throw new ContractError(code, detail);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, code) {
  refuse(value === null || typeof value !== 'object' || Array.isArray(value), code, 'expected object');
  const actual = Object.keys(value).sort();
  refuse(stableJson(actual) !== stableJson([...expected].sort()), code, `fields ${actual.join(',')}`);
}

function safeRelative(relativePath, code = 'UNSAFE_PATH') {
  refuse(typeof relativePath !== 'string' || relativePath.length === 0, code, 'path is empty');
  refuse(relativePath.includes('\\') || path.posix.isAbsolute(relativePath), code, relativePath);
  const segments = relativePath.split('/');
  refuse(segments.some((segment) => segment === '' || segment === '.' || segment === '..'), code, relativePath);
  return segments;
}

function isExcluded(relativePath) {
  const segments = safeRelative(relativePath);
  return segments.some((segment) => EXCLUDED_SEGMENTS.has(segment)) || segments.at(-1) === 'manifest.json';
}

function fileRecord(root, relativePath) {
  const target = path.join(root, ...safeRelative(relativePath));
  const stat = fs.lstatSync(target);
  refuse(stat.isSymbolicLink() || stat.nlink !== 1, 'LINKED_FILE', relativePath);
  refuse(!stat.isFile(), 'NONREGULAR_FILE', relativePath);
  const mode = stat.mode & 0o777;
  refuse(mode !== 0o644 && mode !== 0o755, 'FILE_MODE', `${relativePath}:${mode.toString(8)}`);
  const bytes = fs.readFileSync(target);
  return { path: relativePath, mode: mode.toString(8).padStart(4, '0'), size: bytes.length, sha256: digest(bytes) };
}

function buildInventory(root) {
  const records = [];
  function visit(directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      refuse(stat.isSymbolicLink(), 'LINKED_FILE', relativePath);
      if (stat.isDirectory()) {
        visit(target, relativePath);
      } else {
        records.push(fileRecord(root, relativePath));
      }
    }
  }
  visit(root, '');
  return records.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

function computeTreeDigest(records, domain = 'tree-v1') {
  return digest(`${domain}\n${records.map((entry) => `${entry.path}\0${entry.mode}\0${entry.size}\0${entry.sha256}`).join('\n')}\n`);
}

function digestProjection(candidate) {
  return {
    schema_version: candidate.schema_version,
    release_version: candidate.release_version,
    products: candidate.products,
    shared_contract_digests: candidate.shared_contract_digests,
    detached_metadata: candidate.detached_metadata,
    host_rows: candidate.host_rows,
    onboarding_sibling: candidate.onboarding_sibling,
  };
}

function computeCombinedDigest(candidate) {
  return digest(`lazyseries-paired-candidate-v1\n${stableJson(digestProjection(candidate))}\n`);
}

function validateHostRows(rows, status, receiptKey) {
  refuse(!Array.isArray(rows) || rows.length !== HOSTS.length, 'HOST_INVENTORY', 'expected six rows');
  rows.forEach((row, index) => {
    exactKeys(row, receiptKey ? ['host_id', 'status', receiptKey] : ['host_id', 'status'], 'HOST_ROW_SCHEMA');
    refuse(row.host_id !== HOSTS[index], 'HOST_INVENTORY', `row ${index}`);
    refuse(row.status !== status, 'NONPENDING_HOST_ROW', row.host_id);
  });
}

function validateProducts(products, inventory) {
  refuse(!Array.isArray(products) || products.length !== PRODUCTS.length, 'PRODUCT_INVENTORY', 'expected two products');
  products.forEach((product, index) => {
    refuse(!SOURCE_SHA.test(product.source_sha || ''), 'MISSING_SOURCE_SHA', product.product_id || `product ${index}`);
    exactKeys(product, ['product_id', 'source_sha', 'source_clean', 'archive_path', 'archive_sha256', 'tree_sha256', 'payload_sha256', 'command', 'runtime'], 'PRODUCT_SCHEMA');
    refuse(product.product_id !== PRODUCTS[index], 'PRODUCT_INVENTORY', `product ${index}`);
    refuse(product.source_clean !== true, 'DIRTY_SOURCE', product.product_id);
    for (const field of ['archive_sha256', 'tree_sha256', 'payload_sha256']) {
      refuse(!SHA256.test(product[field] || ''), 'PRODUCT_SCHEMA', `${product.product_id}.${field}`);
    }
    refuse(typeof product.command !== 'string' || product.command.length === 0, 'PRODUCT_SCHEMA', 'command');
    refuse(typeof product.runtime !== 'string' || product.runtime.length === 0, 'PRODUCT_SCHEMA', 'runtime');
    const prefix = product.product_id === 'lazybuddy' ? 'LazyBuddy/' : 'LazyTrae/';
    const records = inventory.filter((entry) => entry.path.startsWith(prefix));
    refuse(records.length === 0, 'PRODUCT_INVENTORY', product.product_id);
    const archive = records.find((entry) => entry.path === product.archive_path);
    refuse(!archive || archive.sha256 !== product.archive_sha256, 'ARCHIVE_DIGEST_MISMATCH', product.product_id);
    refuse(computeTreeDigest(records) !== product.tree_sha256, 'TREE_DIGEST_MISMATCH', product.product_id);
    refuse(computeTreeDigest(records, 'payload-v1') !== product.payload_sha256, 'PAYLOAD_DIGEST_MISMATCH', product.product_id);
  });
}

function destinationExists(destination) {
  try {
    fs.lstatSync(destination);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function validateCandidate(candidate, options) {
  exactKeys(candidate, ['schema_version', 'release_version', 'products', 'shared_contract_digests', 'payload_inventory', 'detached_metadata', 'host_rows', 'onboarding_sibling', 'combined_digest'], 'CANDIDATE_SCHEMA');
  refuse(candidate.schema_version !== 'lazyseries.paired-candidate.v1', 'CANDIDATE_SCHEMA', 'schema version');
  refuse(candidate.release_version !== '1.1.0', 'CANDIDATE_SCHEMA', 'release version');
  refuse(destinationExists(options.destination), 'DESTINATION_EXISTS', options.destination);
  const inventory = candidate.payload_inventory;
  refuse(!Array.isArray(inventory) || inventory.length === 0, 'PAYLOAD_INVENTORY', 'empty');
  inventory.forEach((entry, index) => {
    exactKeys(entry, ['path', 'mode', 'size', 'sha256'], 'PAYLOAD_RECORD');
    refuse(index > 0 && Buffer.compare(Buffer.from(inventory[index - 1].path), Buffer.from(entry.path)) >= 0, 'PAYLOAD_ORDER', entry.path);
    refuse(entry.path === 'manifest.json' || entry.path === candidate.detached_metadata.path, 'SELF_REFERENCE', entry.path);
    refuse(isExcluded(entry.path), 'EXCLUDED_PAYLOAD', entry.path);
  });
  const actual = buildInventory(options.payloadRoot);
  exactKeys(candidate.detached_metadata, ['path', 'sha256'], 'DETACHED_METADATA');
  refuse(isExcluded(candidate.detached_metadata.path), 'DETACHED_METADATA', candidate.detached_metadata.path);
  const metadata = actual.find((entry) => entry.path === candidate.detached_metadata.path);
  refuse(!metadata || metadata.sha256 !== candidate.detached_metadata.sha256, 'DETACHED_METADATA_MISMATCH', candidate.detached_metadata.path);
  const actualPayload = actual.filter((entry) => entry.path !== candidate.detached_metadata.path);
  refuse(actualPayload.some((entry) => isExcluded(entry.path)), 'EXCLUDED_PAYLOAD', 'unbound excluded file');
  refuse(stableJson(actualPayload) !== stableJson(inventory), 'FILE_DIGEST_MISMATCH', 'ordered inventory differs');
  validateProducts(candidate.products, inventory);
  refuse(!Array.isArray(candidate.shared_contract_digests) || candidate.shared_contract_digests.length === 0, 'SHARED_CONTRACTS', 'empty');
  candidate.shared_contract_digests.forEach((entry, index) => {
    exactKeys(entry, ['name', 'sha256'], 'SHARED_CONTRACTS');
    refuse(!SHA256.test(entry.sha256 || '') || typeof entry.name !== 'string' || entry.name.length === 0, 'SHARED_CONTRACTS', `entry ${index}`);
    refuse(index > 0 && candidate.shared_contract_digests[index - 1].name >= entry.name, 'SHARED_CONTRACTS', 'not ordered');
  });
  validateHostRows(candidate.host_rows, 'pending');
  refuse(candidate.onboarding_sibling !== 'live-test-v1.1.0-<combined-digest>-onboarding', 'CANDIDATE_SCHEMA', 'onboarding sibling');
  refuse(computeCombinedDigest(candidate) !== candidate.combined_digest, 'COMBINED_DIGEST_MISMATCH', 'candidate projection');
  return candidate.combined_digest;
}

function validateOnboarding(onboarding, candidate) {
  exactKeys(onboarding, ['schema_version', 'candidate_combined_digest', 'candidate_manifest_sha256', 'records'], 'ONBOARDING_SCHEMA');
  refuse(onboarding.schema_version !== 'lazyseries.live-host-onboarding.v1', 'ONBOARDING_SCHEMA', 'schema version');
  refuse(onboarding.candidate_combined_digest !== candidate.combined_digest, 'STALE_CANDIDATE', 'combined digest');
  refuse(!SHA256.test(onboarding.candidate_manifest_sha256 || ''), 'ONBOARDING_SCHEMA', 'manifest digest');
  validateHostRows(onboarding.records, 'pending', 'receipt');
  onboarding.records.forEach((row) => refuse(row.receipt !== null, 'NONPENDING_HOST_ROW', row.host_id));
}

function validateFinalizerInput(finalizer, candidate, onboarding) {
  exactKeys(finalizer, ['schema_version', 'candidate_combined_digest', 'candidate_manifest_sha256', 'onboarding_manifest_sha256', 'receipts'], 'FINALIZER_SCHEMA');
  refuse(finalizer.schema_version !== 'lazyseries.live-test-finalizer-input.v1', 'FINALIZER_SCHEMA', 'schema version');
  refuse(finalizer.candidate_combined_digest !== candidate.combined_digest, 'STALE_CANDIDATE', 'combined digest');
  refuse(finalizer.candidate_manifest_sha256 !== onboarding.candidate_manifest_sha256, 'STALE_CANDIDATE', 'manifest digest');
  refuse(!SHA256.test(finalizer.onboarding_manifest_sha256 || ''), 'FINALIZER_SCHEMA', 'onboarding digest');
  refuse(!Array.isArray(finalizer.receipts) || finalizer.receipts.length !== HOSTS.length, 'HOST_INVENTORY', 'finalizer receipts');
  finalizer.receipts.forEach((receipt, index) => {
    exactKeys(receipt, ['host_id', 'status', 'source_sha', 'candidate_combined_digest', 'receipt_sha256'], 'FINALIZER_RECEIPT');
    refuse(receipt.host_id !== HOSTS[index] || receipt.status !== 'passed', 'FINALIZER_RECEIPT', `row ${index}`);
    const product = candidate.products[receipt.host_id.startsWith('trae-') ? 1 : 0];
    refuse(receipt.source_sha !== product.source_sha || receipt.candidate_combined_digest !== candidate.combined_digest, 'STALE_RECEIPT', receipt.host_id);
    refuse(!SHA256.test(receipt.receipt_sha256 || ''), 'FINALIZER_RECEIPT', receipt.host_id);
  });
}

function main(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  for (const flag of ['--candidate', '--payload-root', '--destination']) refuse(!values.get(flag), 'USAGE', `missing ${flag}`);
  const candidate = JSON.parse(fs.readFileSync(values.get('--candidate'), 'utf8'));
  const combinedDigest = validateCandidate(candidate, { payloadRoot: values.get('--payload-root'), destination: values.get('--destination') });
  const onboarding = values.get('--onboarding') ? JSON.parse(fs.readFileSync(values.get('--onboarding'), 'utf8')) : null;
  if (onboarding) validateOnboarding(onboarding, candidate);
  if (values.get('--finalizer')) {
    refuse(!onboarding, 'USAGE', '--finalizer requires --onboarding');
    validateFinalizerInput(JSON.parse(fs.readFileSync(values.get('--finalizer'), 'utf8')), candidate, onboarding);
  }
  process.stdout.write(`${JSON.stringify({ valid: true, combined_digest: combinedDigest })}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.code || 'VALIDATION_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ContractError, buildInventory, computeCombinedDigest, computeTreeDigest, validateCandidate, validateFinalizerInput, validateOnboarding };
