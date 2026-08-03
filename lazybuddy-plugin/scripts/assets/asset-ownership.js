'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  collectEntries, contained, mergeBytes, normalizedRelative, readManifest, safeDestination, safeFile, sha256,
} = require('./asset-ownership-core');

function compileAssets({ sourceRoot, manifestPath, tempParent = os.tmpdir() }) {
  const parsed = readManifest(sourceRoot, manifestPath);
  const entries = collectEntries(parsed.root, parsed.manifest);
  const inventory = entries.map((entry) => ({
    path: entry.path, format: entry.format, mode: entry.mode, sha256: sha256(entry.bytes),
  }));
  const manifestSha256 = sha256(Buffer.from(JSON.stringify({ owner: parsed.manifest.owner, inventory })));
  const treeRoot = fs.mkdtempSync(path.join(tempParent, 'lazyseries-assets-'));
  try {
    for (const entry of entries) {
      const target = safeDestination(treeRoot, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.bytes, { mode: entry.mode });
    }
  } catch (error) {
    fs.rmSync(treeRoot, { recursive: true, force: true });
    throw error;
  }
  return { treeRoot, entries: inventory, manifestSha256, owner: parsed.manifest.owner, compiledEntries: entries };
}

function receiptFile(destinationRoot, receiptPath) {
  const root = path.resolve(destinationRoot);
  const absolute = path.resolve(receiptPath);
  if (!contained(root, absolute) || absolute === root) throw new Error('receipt path must stay inside destination root');
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  return { absolute: safeDestination(root, normalizedRelative(relative)), relative };
}

function readReceipt(destinationRoot, receiptPath) {
  const location = receiptFile(destinationRoot, receiptPath);
  const file = safeFile(location.absolute, 'asset receipt');
  if (!file) return { location, receipt: null };
  let receipt;
  try {
    receipt = JSON.parse(file.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`asset receipt is malformed: ${error.message}`);
  }
  if (!receipt || receipt.schema_version !== 1 || typeof receipt.owner !== 'string'
    || !/^[0-9a-f]{64}$/.test(receipt.manifest_sha256) || !Array.isArray(receipt.files)) {
    throw new Error('asset receipt is malformed');
  }
  const seen = new Set();
  for (const entry of receipt.files) {
    normalizedRelative(entry.path);
    const base = Buffer.from(entry.base_base64, 'base64');
    if (seen.has(entry.path) || !['json', 'text'].includes(entry.format)
      || sha256(base) !== entry.base_sha256 || !/^[0-9a-f]{64}$/.test(entry.output_sha256)
      || typeof entry.caller_modified !== 'boolean') throw new Error('asset receipt is malformed');
    seen.add(entry.path);
  }
  return { location, receipt };
}

function planInstall(compiled, destinationRoot, receipt) {
  const previous = new Map((receipt?.files || []).map((entry) => [entry.path, entry]));
  const current = new Set(compiled.compiledEntries.map((entry) => entry.path));
  const orphans = [...previous.keys()].filter((entry) => !current.has(entry));
  if (orphans.length) throw new Error(`orphan receipt output: ${orphans.join(', ')}`);
  return compiled.compiledEntries.map((entry) => {
    const target = safeDestination(destinationRoot, entry.path);
    const existing = safeFile(target, `asset output ${entry.path}`);
    const prior = previous.get(entry.path);
    if (existing && !prior) throw new Error(`refusing unreceipted file adoption: ${entry.path}`);
    if (!existing && prior) throw new Error(`stale receipt: missing output ${entry.path}`);
    const merged = prior
      ? mergeBytes(entry.format, Buffer.from(prior.base_base64, 'base64'), existing.bytes, entry.bytes)
      : entry.bytes;
    return {
      target, relative: entry.path, bytes: merged, mode: entry.mode,
      receipt: {
        path: entry.path, format: entry.format, mode: entry.mode,
        base_sha256: sha256(entry.bytes), base_base64: entry.bytes.toString('base64'),
        output_sha256: sha256(merged), caller_modified: !merged.equals(entry.bytes),
      },
    };
  });
}

function temporaryFor(target, bytes, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.asset-tmp`;
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return temporary;
}

function transactionalWrite(items, rename) {
  const prepared = [];
  try {
    for (const item of items) prepared.push({ ...item, temporary: temporaryFor(item.target, item.bytes, item.mode) });
  } catch (error) {
    for (const item of prepared) if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    throw error;
  }
  const committed = [];
  try {
    for (const item of prepared) {
      const backup = fs.existsSync(item.target) ? `${item.target}.${process.pid}.${Math.random().toString(16).slice(2)}.asset-backup` : null;
      const state = { target: item.target, backup, installed: false };
      committed.push(state);
      if (backup) rename(item.target, backup);
      rename(item.temporary, item.target);
      state.installed = true;
      item.temporary = null;
    }
    for (const state of committed) if (state.backup) fs.unlinkSync(state.backup);
  } catch (error) {
    for (const state of committed.reverse()) {
      if (state.installed && fs.existsSync(state.target)) fs.unlinkSync(state.target);
      if (state.backup && fs.existsSync(state.backup)) fs.renameSync(state.backup, state.target);
    }
    throw error;
  } finally {
    for (const item of prepared) if (item.temporary && fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
  }
}

function installAssets(options) {
  const destinationRoot = path.resolve(options.destinationRoot);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const rootStat = fs.lstatSync(destinationRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('destination root must be a non-linked directory');
  const compiled = compileAssets(options);
  try {
    const { location, receipt } = readReceipt(destinationRoot, options.receiptPath);
    if (receipt && receipt.owner !== compiled.owner) throw new Error('asset receipt owner does not match manifest');
    const plan = planInstall(compiled, destinationRoot, receipt);
    const nextReceipt = Buffer.from(`${JSON.stringify({
      schema_version: 1, owner: compiled.owner, manifest_sha256: compiled.manifestSha256,
      files: plan.map((item) => item.receipt),
    }, null, 2)}\n`);
    const writes = plan.filter((item) => !safeFile(item.target, `asset output ${item.relative}`)?.bytes.equals(item.bytes));
    writes.push({ target: location.absolute, bytes: nextReceipt, mode: 0o600 });
    transactionalWrite(writes, options.rename || fs.renameSync);
    return { written: writes.slice(0, -1).map((item) => item.relative), receipt: location.absolute };
  } finally {
    fs.rmSync(compiled.treeRoot, { recursive: true, force: true });
  }
}

function checkAssets(options) {
  const destinationRoot = path.resolve(options.destinationRoot);
  if (!fs.existsSync(destinationRoot)) return { issues: ['destination root is missing'] };
  const compiled = compileAssets(options);
  try {
    const { receipt } = readReceipt(destinationRoot, options.receiptPath);
    if (!receipt) return { issues: ['asset receipt is missing'] };
    const expected = new Set(compiled.compiledEntries.map((entry) => entry.path));
    const issues = receipt.manifest_sha256 === compiled.manifestSha256 && receipt.owner === compiled.owner
      ? [] : ['stale manifest or owner'];
    issues.push(...receipt.files.filter((entry) => !expected.has(entry.path)).map((entry) => `orphan output ${entry.path}`));
    for (const entry of receipt.files) {
      const target = safeDestination(destinationRoot, entry.path);
      const file = safeFile(target, `asset output ${entry.path}`);
      if (!file) issues.push(`missing output ${entry.path}`);
      else if (sha256(file.bytes) !== entry.output_sha256) issues.push(`modified output ${entry.path}`);
    }
    return { issues };
  } finally {
    fs.rmSync(compiled.treeRoot, { recursive: true, force: true });
  }
}

function transactionalUnlink(destinationRoot, targets) {
  const staging = fs.mkdtempSync(path.join(destinationRoot, '.lazyseries-uninstall-'));
  const backups = [];
  try {
    for (const [index, target] of targets.entries()) {
      const backup = path.join(staging, String(index));
      fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, fs.statSync(target).mode & 0o777);
      backups.push({ target, backup, deleted: false });
    }
    for (const item of backups) {
      fs.unlinkSync(item.target);
      item.deleted = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of backups.reverse()) {
      if (!item.deleted && fs.existsSync(item.target)) continue;
      try {
        fs.renameSync(item.backup, item.target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'uninstall failed and rollback was incomplete');
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function uninstallAssets(options) {
  const destinationRoot = path.resolve(options.destinationRoot);
  const { location, receipt } = readReceipt(destinationRoot, options.receiptPath);
  if (!receipt) throw new Error('asset receipt is missing; refusing unreceipted uninstall');
  const classification = receipt.files.map((entry) => {
    const target = safeDestination(destinationRoot, entry.path);
    const file = safeFile(target, `asset output ${entry.path}`);
    return { entry, target, removable: Boolean(file) && !entry.caller_modified && sha256(file.bytes) === entry.output_sha256 };
  });
  const removed = classification.filter((item) => item.removable).map((item) => item.entry.path);
  const preserved = classification.filter((item) => !item.removable).map((item) => item.entry.path);
  transactionalUnlink(destinationRoot, [
    ...classification.filter((item) => item.removable).map((item) => item.target),
    location.absolute,
  ]);
  return { removed, preserved };
}

module.exports = { checkAssets, compileAssets, installAssets, uninstallAssets };
