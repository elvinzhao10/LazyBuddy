'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const {
  atomicJson,
  inventory,
  readJson,
  removeInventory,
  safeFile,
  sha256File,
  verifyInventory,
} = require('./files');
const { contained } = require('./paths');
const { ORIGINS, verifyProjectDeclarations } = require('./ownership');
const { LAUNCHER, installLauncher, readActive, writeActive } = require('./state');

function releaseId(version, commitSha) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new LifecycleError('INVALID_RELEASE', 'version and full lowercase commit SHA are required');
  }
  return `${version}-${commitSha.slice(0, 12)}`;
}

function stageRelease(paths, { sourceRoot, version, commitSha }) {
  const id = releaseId(version, commitSha);
  if (!fs.existsSync(sourceRoot) || !fs.lstatSync(sourceRoot).isDirectory()) {
    throw new LifecycleError('INVALID_SOURCE', 'release source must be a directory');
  }
  inventory(sourceRoot);
  const stagingPath = path.join(paths.staging, `${id}-${process.pid}-${Date.now()}`);
  fs.cpSync(sourceRoot, stagingPath, { recursive: true, errorOnExist: true, force: false });
  return { releaseId: id, stagingPath };
}

function buildReceipt(paths, options, previousRelease, promotedInventory) {
  const releasePath = `releases/${options.releaseId}`;
  const manifestPath = `${releasePath}/${options.manifestRelativePath}`;
  const manifestFile = path.join(paths.productRoot, manifestPath);
  const runtime = safeFile(options.runtimePath, 'INVALID_RUNTIME');
  const releaseMode = `0${(fs.lstatSync(path.join(paths.releases, options.releaseId)).mode & 0o777).toString(8).padStart(3, '0')}`;
  const createdFiles = [
    { path: releasePath, type: 'directory', mode: releaseMode, sha256: null },
    ...promotedInventory.map((entry) => ({ ...entry, path: `${releasePath}/${entry.path}` })),
  ];
  const receiptId = `${paths.product.toLowerCase()}-${options.version.replaceAll('.', '-')}-${options.commitSha.slice(0, 12)}`;
  return {
    $schema: 'lazy-harness-lifecycle.v1.schema.json',
    schema_version: 1,
    receipt_id: receiptId,
    product: paths.product,
    origin: options.origin,
    commit_sha: options.commitSha,
    manifest: {
      path: manifestPath,
      version: options.version,
      sha256: sha256File(manifestFile),
      digests: createdFiles.filter((entry) => entry.type === 'file').map((entry) => ({
        path: entry.path,
        sha256: entry.sha256,
      })),
    },
    layout: {
      install_root: paths.installRoot,
      product_root: paths.productRoot,
      releases: 'releases/',
      active: 'active.json',
      launcher: 'launcher.js',
      receipts: 'receipts/',
      staging: 'staging/',
      locks: 'locks/',
      rollback: 'rollback/',
    },
    release: { id: options.releaseId, path: releasePath },
    runtime: {
      path: options.runtimePath,
      fingerprint: {
        realpath: fs.realpathSync(options.runtimePath),
        version: process.version,
        sha256: require('node:crypto').createHash('sha256').update(runtime.bytes).digest('hex'),
      },
      ownership: 'external-prerequisite',
    },
    ownership_policy: {
      scope: 'product-root-only',
      owned_path_base: 'product_root',
      cross_product_ownership: 'forbidden',
      host_or_global_ownership: 'forbidden',
      symlink_ownership: 'forbidden',
    },
    created_files: createdFiles,
    registered_project_declarations: options.registeredProjectDeclarations || [],
    receipt_path: `receipts/${receiptId}.json`,
    active_release: options.releaseId,
    previous_release: previousRelease,
    host_evidence: { status: 'pending', observation_receipt: null },
  };
}

function promoteRelease(paths, options) {
  if (options.origin !== ORIGINS[paths.product]) throw new LifecycleError('INVALID_ORIGIN', 'origin does not match product');
  if (!contained(paths.staging, options.stagingPath) || path.dirname(options.stagingPath) !== paths.staging) {
    throw new LifecycleError('UNSAFE_STAGE', 'stage must be a direct child of the product staging directory');
  }
  const active = readActive(paths);
  if (active && active.previous_release !== null) {
    throw new LifecycleError('ROLLBACK_FULL', 'prune the verified previous release before another promotion');
  }
  const target = path.join(paths.releases, options.releaseId);
  if (fs.existsSync(target)) throw new LifecycleError('RELEASE_EXISTS', 'immutable release already exists');
  if (fs.statSync(options.stagingPath).dev !== fs.statSync(paths.releases).dev) {
    throw new LifecycleError('CROSS_DEVICE', 'staging and releases must share a filesystem');
  }
  const stagedInventory = inventory(options.stagingPath);
  try {
    fs.renameSync(options.stagingPath, target);
  } catch (error) {
    if (error && error.code === 'EXDEV') throw new LifecycleError('CROSS_DEVICE', 'cross-filesystem promotion refused', error);
    throw error;
  }
  const receipt = buildReceipt(paths, options, active ? active.active_release : null, stagedInventory);
  const receiptPath = path.join(paths.productRoot, receipt.receipt_path);
  atomicJson(paths.productRoot, receiptPath, receipt, 0o600);
  installLauncher(paths);
  writeActive(paths, {
    schema_version: 1,
    product: paths.product,
    active_release: options.releaseId,
    previous_release: active ? active.active_release : null,
    entrypoint: options.entrypoint,
    runtime_path: options.runtimePath,
    updated_at: new Date().toISOString(),
  });
  return { releaseId: options.releaseId, receiptPath };
}

function receiptFor(paths, id) {
  const prefix = `${paths.product.toLowerCase()}-`;
  const candidates = fs.readdirSync(paths.receipts).filter((name) => name.startsWith(prefix) && name.endsWith(`-${id.slice(-12)}.json`));
  if (candidates.length !== 1) throw new LifecycleError('OWNERSHIP_REFUSED', `missing exact receipt for ${id}`);
  const receiptPath = path.join(paths.receipts, candidates[0]);
  const receipt = readJson(receiptPath, 'OWNERSHIP_REFUSED');
  if (receipt.product !== paths.product || receipt.release.id !== id || receipt.receipt_path !== `receipts/${candidates[0]}`) {
    throw new LifecycleError('OWNERSHIP_REFUSED', `receipt identity mismatch for ${id}`);
  }
  const expected = receipt.created_files.filter((entry) => entry.path.startsWith(`releases/${id}/`)).map((entry) => ({
    ...entry,
    path: entry.path.slice(`releases/${id}/`.length),
  }));
  verifyInventory(path.join(paths.releases, id), expected);
  return { receipt, receiptPath, expected };
}

function rollbackRelease(paths) {
  const active = readActive(paths);
  if (!active || active.previous_release === null) throw new LifecycleError('NO_ROLLBACK', 'no verified previous release is available');
  if (fs.existsSync(paths.rollbackMarker)) throw new LifecycleError('ROLLBACK_FULL', 'rollback retention must be pruned first');
  receiptFor(paths, active.active_release);
  const previous = receiptFor(paths, active.previous_release).receipt;
  const next = {
    ...active,
    active_release: active.previous_release,
    previous_release: null,
    entrypoint: active.entrypoint,
    runtime_path: previous.runtime.path,
    updated_at: new Date().toISOString(),
  };
  writeActive(paths, next);
  atomicJson(paths.productRoot, paths.rollbackMarker, { release_id: active.active_release }, 0o600);
  return next;
}

function removeVerifiedRelease(paths, id) {
  const verified = receiptFor(paths, id);
  removeInventory(path.join(paths.releases, id), verified.expected);
  fs.rmdirSync(path.join(paths.releases, id));
  fs.unlinkSync(verified.receiptPath);
}

function pruneRollback(paths, confirmation) {
  if (confirmation !== 'prune-rollback') {
    throw new LifecycleError('CONFIRMATION_REQUIRED', 'pass explicit prune-rollback confirmation');
  }
  const active = readActive(paths);
  if (active && active.previous_release !== null) {
    const previous = active.previous_release;
    writeActive(paths, { ...active, previous_release: null, updated_at: new Date().toISOString() });
    removeVerifiedRelease(paths, previous);
    return;
  }
  if (!fs.existsSync(paths.rollbackMarker)) throw new LifecycleError('NO_ROLLBACK', 'no rollback release is retained');
  const marker = readJson(paths.rollbackMarker, 'OWNERSHIP_REFUSED');
  fs.unlinkSync(paths.rollbackMarker);
  removeVerifiedRelease(paths, marker.release_id);
}

function offboardProduct(paths, confirmation) {
  if (confirmation !== 'offboard-product') throw new LifecycleError('CONFIRMATION_REQUIRED', 'explicit product offboard confirmation required');
  try {
    if (!fs.existsSync(paths.productRoot)) throw new Error('product root is absent');
    if (fs.existsSync(paths.lock) || fs.readdirSync(paths.staging).length !== 0) throw new Error('operation state is not clean');
    const active = readActive(paths);
    if (!active) throw new Error('active state is absent');
    const receipts = fs.readdirSync(paths.receipts);
    const verified = receipts.map((name) => {
      if (!name.endsWith('.json')) throw new Error('unknown receipt content');
      const receipt = readJson(path.join(paths.receipts, name), 'OWNERSHIP_REFUSED');
      return receiptFor(paths, receipt.release.id);
    });
    for (const item of verified) verifyProjectDeclarations(item.receipt);
    const releaseIds = verified.map((item) => item.receipt.release.id).sort();
    const releaseNames = fs.readdirSync(paths.releases).sort();
    if (new Set(releaseIds).size !== releaseIds.length
      || JSON.stringify(releaseIds) !== JSON.stringify(releaseNames)) throw new Error('unknown release content');
    const expectedRoot = new Set(['active.json', 'launcher.js', 'locks', 'receipts', 'releases', 'rollback', 'staging']);
    if (fs.readdirSync(paths.productRoot).some((name) => !expectedRoot.has(name))) throw new Error('unknown product content');
    if (!safeFile(paths.launcher).bytes.equals(Buffer.from(LAUNCHER))) throw new Error('launcher changed');
    if (fs.readdirSync(paths.locks).length !== 0) throw new Error('unknown lock content');
    const rollbackNames = fs.readdirSync(paths.rollback);
    if (rollbackNames.some((name) => name !== 'retained.json')) throw new Error('unknown rollback content');
    for (const item of verified) removeInventory(path.join(paths.releases, item.receipt.release.id), item.expected);
    for (const item of verified) fs.rmdirSync(path.join(paths.releases, item.receipt.release.id));
    for (const name of receipts) fs.unlinkSync(path.join(paths.receipts, name));
    if (fs.existsSync(paths.rollbackMarker)) fs.unlinkSync(paths.rollbackMarker);
    fs.unlinkSync(paths.active);
    fs.unlinkSync(paths.launcher);
    for (const directory of [paths.locks, paths.receipts, paths.releases, paths.rollback, paths.staging]) fs.rmdirSync(directory);
    fs.rmdirSync(paths.productRoot);
  } catch (error) {
    if (error instanceof LifecycleError && error.code === 'CONFIRMATION_REQUIRED') throw error;
    throw new LifecycleError('OWNERSHIP_REFUSED', 'product state is not an exact receipt-owned installation', error);
  }
}

module.exports = {
  offboardProduct,
  promoteRelease,
  pruneRollback,
  rollbackRelease,
  stageRelease,
};
