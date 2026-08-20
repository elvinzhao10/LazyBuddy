#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
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

function parentDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }
  return directories;
}

function assertClosedRegularTree(root, allowedFiles) {
  const allowed = new Set(allowedFiles);
  const allowedDirectories = parentDirectories(allowed);
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      refuse(relative.split('/').some((segment) => FORBIDDEN.has(segment)), 'FORBIDDEN_PATH', relative);
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      refuse(stat.isSymbolicLink(), 'LINKED_FILE', relative);
      if (stat.isDirectory()) {
        refuse(!allowedDirectories.has(relative), 'UNEXPECTED_ARTIFACT', relative);
        visit(target, relative);
      } else {
        refuse(!stat.isFile(), 'NONREGULAR_FILE', relative);
        refuse(stat.nlink !== 1, 'LINKED_FILE', relative);
        refuse(!allowed.has(relative), 'UNEXPECTED_ARTIFACT', relative);
      }
    }
  };
  visit(root, '');
}

function parseArchivePath(input, label) {
  const detail = `${label}: ${JSON.stringify(input)}`;
  refuse(typeof input !== 'string' || input === '' || input.includes('\0') || input.includes('\\')
    || path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || path.posix.normalize(input) !== input
    || input.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'), 'UNSAFE_ARCHIVE_PATH', detail);
  return input;
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

function terminateChild(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}

function gitAsync(root, args, registerChild) {
  return new Promise((resolve, reject) => {
    let settled = false; let timedOut = false; let stdout = ''; let stderr = '';
    const child = spawn('git', ['-C', root, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => { timedOut = true; terminateChild(child, 'SIGKILL'); }, 10000);
    const finish = (callback) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); registerChild(null);
      callback();
    };
    registerChild(child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (status) => finish(() => {
      if (timedOut) reject(new AssemblyError('CHILD_TIMEOUT', `git ${args.join(' ')}`));
      else if (status !== 0) reject(new AssemblyError('MALFORMED_SOURCE', `${root}: git ${args.join(' ')}: ${stderr.trim()}`)); else resolve(stdout.trim());
    }));
  });
}

function verifySource(root, expectedSha, expectedTree, label) {
  refuse(!SOURCE_SHA.test(expectedSha), 'INVALID_RECEIPT', `${label} source sha`);
  refuse(git(root, ['rev-parse', '--show-toplevel']) !== root, 'MALFORMED_SOURCE', `${label} is not repository root`);
  refuse(git(root, ['rev-parse', 'HEAD']) !== expectedSha, 'SOURCE_SHA_MISMATCH', label);
  refuse(git(root, ['rev-parse', 'HEAD^{tree}']) !== expectedTree, 'SOURCE_TREE_MISMATCH', label);
  refuse(git(root, ['status', '--porcelain', '--untracked-files=all']) !== '', 'DIRTY_SOURCE', label);
}

async function verifySourceAsync(root, expectedSha, expectedTree, label, registerChild) {
  refuse(!SOURCE_SHA.test(expectedSha), 'INVALID_RECEIPT', `${label} source sha`);
  refuse(await gitAsync(root, ['rev-parse', '--show-toplevel'], registerChild) !== root, 'MALFORMED_SOURCE', `${label} is not repository root`);
  refuse(await gitAsync(root, ['rev-parse', 'HEAD'], registerChild) !== expectedSha, 'SOURCE_SHA_MISMATCH', label);
  refuse(await gitAsync(root, ['rev-parse', 'HEAD^{tree}'], registerChild) !== expectedTree, 'SOURCE_TREE_MISMATCH', label);
  refuse(await gitAsync(root, ['status', '--porcelain', '--untracked-files=all'], registerChild) !== '', 'DIRTY_SOURCE', label);
}

function verifyArtifacts(buddyRoot, traeRoot) {
  const buddyManifest = readJson(buddyRoot, 'manifest.json');
  const buddyReceipt = readJson(buddyRoot, 'self-verification-receipt.json');
  const buddyArchive = parseArchivePath(buddyManifest.archive_path, 'LazyBuddy archive path');
  assertClosedRegularTree(buddyRoot, [
    'manifest.json',
    'self-verification-receipt.json',
    'ordered-tree.digest',
    'ordered-file-digest-inventory.json',
    'ordered-file-digest-inventory.txt',
    buddyArchive,
  ]);
  const buddyBytes = readRegular(buddyRoot, buddyArchive);
  const buddyTree = readRegular(buddyRoot, 'ordered-tree.digest').toString('utf8').trim();
  refuse(digest(buddyBytes) !== buddyManifest.archive_sha256 || buddyReceipt.archive_sha256 !== buddyManifest.archive_sha256, 'ARCHIVE_DIGEST_MISMATCH', `LazyBuddy/${buddyArchive}`);
  refuse(buddyTree !== buddyManifest.ordered_extracted_tree_sha256 || buddyReceipt.ordered_extracted_tree_sha256 !== buddyTree, 'TREE_DIGEST_MISMATCH', 'LazyBuddy');
  refuse(buddyReceipt.status !== 'pass' || buddyManifest.release_version !== '1.1.0' || buddyReceipt.release_version !== '1.1.0', 'INVALID_RECEIPT', 'LazyBuddy status/version');
  refuse(buddyReceipt.source_sha !== buddyManifest.source_sha || buddyReceipt.source_tree !== buddyManifest.source_tree, 'INVALID_RECEIPT', 'LazyBuddy source binding');

  const traeManifest = readJson(traeRoot, 'manifest.json');
  const traeReceipt = readJson(traeRoot, 'self-verification-receipt.json');
  const traeArchive = parseArchivePath(traeManifest.artifact?.file, 'LazyTrae archive path');
  assertClosedRegularTree(traeRoot, [
    'manifest.json',
    'self-verification-receipt.json',
    'tree-digest.txt',
    'inventory.json',
    'inventory.txt',
    traeArchive,
    `${traeArchive}.sha256`,
  ]);
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
  parseArchivePath,
  pendingTemplate,
  productRecord,
  readJson,
  readRegular,
  refuse,
  resolveRealDirectory,
  stableJson,
  terminateChild,
  verifyArtifacts,
  verifySource,
  verifySourceAsync,
  writeExclusive,
};
