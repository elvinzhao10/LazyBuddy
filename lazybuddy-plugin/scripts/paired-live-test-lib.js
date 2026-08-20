#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildInventory,
  computeCombinedDigest,
  computeTreeDigest,
} = require('../contracts/validate-paired-candidate.js');

const HOSTS = Object.freeze(['codebuddy-cli', 'codebuddy-ide', 'workbuddy', 'trae-cli', 'trae-ide', 'trae-work']);
const FORBIDDEN = new Set(['.git', '.cache', 'cache', 'caches', 'secrets']);
const SOURCE_SHA = /^[0-9a-f]{40}$/;

class AssemblyError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

function refuse(condition, code, detail) {
  if (condition) throw new AssemblyError(code, detail);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveRealDirectory(input, label, create = false) {
  refuse(typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0'), 'UNSAFE_PATH', `${label}: ${input || ''}`);
  if (create && !fs.existsSync(input)) fs.mkdirSync(input, { recursive: true, mode: 0o755 });
  let stat;
  try { stat = fs.lstatSync(input); } catch (error) { throw new AssemblyError('MISSING_ROOT', `${label}: ${input}: ${error.code}`); }
  refuse(stat.isSymbolicLink() || !stat.isDirectory(), 'UNSAFE_PATH', `${label}: ${input}`);
  const real = fs.realpathSync(input);
  return real;
}

function assertRegularTree(root) {
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      refuse(relative.split('/').some((segment) => FORBIDDEN.has(segment)), 'FORBIDDEN_PATH', relative);
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      refuse(stat.isSymbolicLink(), 'LINKED_FILE', relative);
      if (stat.isDirectory()) visit(target, relative);
      else {
        refuse(!stat.isFile(), 'NONREGULAR_FILE', relative);
        refuse(stat.nlink !== 1, 'LINKED_FILE', relative);
      }
    }
  };
  visit(root, '');
}

function readRegular(root, relative) {
  const target = path.join(root, relative);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { throw new AssemblyError('MISSING_ARTIFACT', `${relative}: ${error.code}`); }
  refuse(stat.isSymbolicLink() || stat.nlink !== 1, 'LINKED_FILE', relative);
  refuse(!stat.isFile(), 'NONREGULAR_FILE', relative);
  return fs.readFileSync(target);
}

function readJson(root, relative) {
  try { return JSON.parse(readRegular(root, relative).toString('utf8')); }
  catch (error) {
    if (error instanceof AssemblyError) throw error;
    throw new AssemblyError('INVALID_RECEIPT', `${relative}: ${error.message}`);
  }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
  refuse(result.error?.code === 'ETIMEDOUT', 'CHILD_TIMEOUT', `git ${args.join(' ')}`);
  refuse(result.status !== 0, 'MALFORMED_SOURCE', `${root}: git ${args.join(' ')}: ${(result.stderr || '').trim()}`);
  return result.stdout.trim();
}

function verifySource(root, expectedSha, expectedTree, label) {
  refuse(!SOURCE_SHA.test(expectedSha), 'INVALID_RECEIPT', `${label} source sha`);
  refuse(git(root, ['rev-parse', '--show-toplevel']) !== root, 'MALFORMED_SOURCE', `${label} is not repository root`);
  refuse(git(root, ['rev-parse', 'HEAD']) !== expectedSha, 'SOURCE_SHA_MISMATCH', label);
  refuse(git(root, ['rev-parse', 'HEAD^{tree}']) !== expectedTree, 'SOURCE_TREE_MISMATCH', label);
  refuse(git(root, ['status', '--porcelain', '--untracked-files=all']) !== '', 'DIRTY_SOURCE', label);
}

function verifyArtifacts(buddyRoot, traeRoot) {
  assertRegularTree(buddyRoot);
  assertRegularTree(traeRoot);
  const buddyManifest = readJson(buddyRoot, 'manifest.json');
  const buddyReceipt = readJson(buddyRoot, 'self-verification-receipt.json');
  const buddyArchive = buddyManifest.archive_path;
  const buddyBytes = readRegular(buddyRoot, buddyArchive);
  const buddyTree = readRegular(buddyRoot, 'ordered-tree.digest').toString('utf8').trim();
  refuse(digest(buddyBytes) !== buddyManifest.archive_sha256 || buddyReceipt.archive_sha256 !== buddyManifest.archive_sha256, 'ARCHIVE_DIGEST_MISMATCH', `LazyBuddy/${buddyArchive}`);
  refuse(buddyTree !== buddyManifest.ordered_extracted_tree_sha256 || buddyReceipt.ordered_extracted_tree_sha256 !== buddyTree, 'TREE_DIGEST_MISMATCH', 'LazyBuddy');
  refuse(buddyReceipt.status !== 'pass' || buddyManifest.release_version !== '1.1.0' || buddyReceipt.release_version !== '1.1.0', 'INVALID_RECEIPT', 'LazyBuddy status/version');
  refuse(buddyReceipt.source_sha !== buddyManifest.source_sha || buddyReceipt.source_tree !== buddyManifest.source_tree, 'INVALID_RECEIPT', 'LazyBuddy source binding');

  const traeManifest = readJson(traeRoot, 'manifest.json');
  const traeReceipt = readJson(traeRoot, 'self-verification-receipt.json');
  const traeArchive = traeManifest.artifact?.file;
  refuse(typeof traeArchive !== 'string', 'INVALID_RECEIPT', 'LazyTrae archive path');
  const traeBytes = readRegular(traeRoot, traeArchive);
  const traeTree = readRegular(traeRoot, 'tree-digest.txt').toString('utf8').trim();
  const traeSidecar = readRegular(traeRoot, `${traeArchive}.sha256`).toString('utf8').trim().split(/\s+/)[0];
  refuse(digest(traeBytes) !== traeManifest.artifact.sha256 || traeReceipt.artifact?.sha256 !== traeManifest.artifact.sha256 || traeSidecar !== traeManifest.artifact.sha256, 'ARCHIVE_DIGEST_MISMATCH', `LazyTrae/${traeArchive}`);
  refuse(traeTree !== traeManifest.artifact.treeDigest || traeReceipt.artifact?.treeDigest !== traeTree, 'TREE_DIGEST_MISMATCH', 'LazyTrae');
  refuse(traeReceipt.status !== 'pass' || traeManifest.version !== '1.1.0' || traeReceipt.version !== '1.1.0', 'INVALID_RECEIPT', 'LazyTrae status/version');
  refuse(traeReceipt.source?.sha !== traeManifest.source?.sha || traeReceipt.source?.tree !== traeManifest.source?.tree, 'INVALID_RECEIPT', 'LazyTrae source binding');
  return {
    buddy: {
      manifest: buddyManifest,
      archive: buddyArchive,
      archiveBytes: buddyBytes,
      receiptSha256: digest(readRegular(buddyRoot, 'self-verification-receipt.json')),
      extractedTreeSha256: buddyTree,
    },
    trae: {
      manifest: traeManifest,
      archive: traeArchive,
      archiveBytes: traeBytes,
      receiptSha256: digest(readRegular(traeRoot, 'self-verification-receipt.json')),
      extractedTreeSha256: traeTree,
    },
  };
}

function writeExclusive(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  const fd = fs.openSync(target, 'wx', 0o644);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function productRecord(id, prefix, archive, sourceSha, inventory) {
  const records = inventory.filter((entry) => entry.path.startsWith(`${prefix}/`));
  const archiveRecord = records.find((entry) => entry.path === `${prefix}/${archive}`);
  refuse(!archiveRecord, 'MISSING_ARTIFACT', `${prefix}/${archive}`);
  return {
    product_id: id,
    source_sha: sourceSha,
    source_clean: true,
    archive_path: `${prefix}/${archive}`,
    archive_sha256: archiveRecord.sha256,
    tree_sha256: computeTreeDigest(records),
    payload_sha256: computeTreeDigest(records, 'payload-v1'),
    command: id === 'lazybuddy' ? 'bash lazybuddy-plugin/scripts/lazybuddy-verify.sh' : 'npm test',
    runtime: id === 'lazybuddy' ? 'node-20+python-3' : 'node-20',
  };
}

function pendingTemplate(combinedDigest, manifestSha256) {
  return {
    schema_version: 'lazyseries.live-host-onboarding.v1',
    candidate_combined_digest: combinedDigest,
    candidate_manifest_sha256: manifestSha256,
    records: HOSTS.map((host_id) => ({ host_id, status: 'pending', receipt: null })),
  };
}

function chmodImmutable(root) {
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) { visit(target); fs.chmodSync(target, 0o555); }
      else fs.chmodSync(target, 0o444);
    }
  };
  visit(root);
  fs.chmodSync(root, 0o555);
}

function makeWritable(root) {
  if (!fs.existsSync(root)) return;
  const visit = (directory) => {
    fs.chmodSync(directory, 0o755);
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name);
      if (fs.lstatSync(target).isDirectory()) visit(target); else fs.chmodSync(target, 0o644);
    }
  };
  visit(root);
}

module.exports = {
  AssemblyError,
  HOSTS,
  assertRegularTree,
  chmodImmutable,
  computeCombinedDigest,
  digest,
  jsonBytes,
  makeWritable,
  pendingTemplate,
  productRecord,
  readJson,
  readRegular,
  refuse,
  resolveRealDirectory,
  stableJson,
  verifyArtifacts,
  verifySource,
  writeExclusive,
};
