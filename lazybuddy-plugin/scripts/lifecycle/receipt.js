'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { inventory, readJson, safeFile, sha256File, verifyInventory } = require('./files');
const { ORIGINS, ownedRelativePath, validateReceipt } = require('./ownership');

function preparePromotion(paths, options, previousRelease) {
  if (!/^[0-9a-f]{40}$/.test(options.commitSha)
    || options.releaseId !== `${options.version}-${options.commitSha.slice(0, 12)}`) {
    throw new LifecycleError('INVALID_RECEIPT', 'release identity does not match selected revision');
  }
  const entrypoint = ownedRelativePath(options.entrypoint, 'INVALID_ENTRYPOINT');
  const manifestRelativePath = ownedRelativePath(options.manifestRelativePath, 'INVALID_MANIFEST');
  const stagedInventory = inventory(options.stagingPath);
  const entry = stagedInventory.find((item) => item.path === entrypoint);
  if (!entry || entry.type !== 'file') throw new LifecycleError('INVALID_ENTRYPOINT', 'entrypoint is not a staged regular file');
  const manifest = stagedInventory.find((item) => item.path === manifestRelativePath);
  if (!manifest || manifest.type !== 'file') throw new LifecycleError('INVALID_MANIFEST', 'manifest is not a staged regular file');
  let manifestValue;
  try {
    manifestValue = JSON.parse(safeFile(path.join(options.stagingPath, manifestRelativePath), 'INVALID_MANIFEST').bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError('INVALID_MANIFEST', 'manifest is not valid JSON', error);
  }
  if (manifestValue.version !== options.version) {
    throw new LifecycleError('INVALID_MANIFEST', 'manifest version does not match selected release');
  }
  const receipt = buildReceipt(paths, options, previousRelease, stagedInventory, manifestRelativePath);
  validateReceipt(paths, receipt);
  return { entrypoint, receipt, stagedInventory };
}

function buildReceipt(paths, options, previousRelease, stagedInventory, manifestRelativePath) {
  const releasePath = `releases/${options.releaseId}`;
  const manifestPath = `${releasePath}/${manifestRelativePath}`;
  const manifestFile = path.join(options.stagingPath, manifestRelativePath);
  const runtime = safeFile(options.runtimePath, 'INVALID_RUNTIME');
  const releaseMode = `0${(fs.lstatSync(options.stagingPath).mode & 0o777).toString(8).padStart(3, '0')}`;
  const createdFiles = [
    { path: releasePath, type: 'directory', mode: releaseMode, sha256: null },
    ...stagedInventory.map((item) => ({ ...item, path: `${releasePath}/${item.path}` })),
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
      digests: createdFiles.filter((item) => item.type === 'file').map((item) => ({
        path: item.path,
        sha256: item.sha256,
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
        sha256: crypto.createHash('sha256').update(runtime.bytes).digest('hex'),
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

function receiptFor(paths, id) {
  const prefix = `${paths.product.toLowerCase()}-`;
  const candidates = fs.readdirSync(paths.receipts).filter((name) => name.startsWith(prefix) && name.endsWith(`-${id.slice(-12)}.json`));
  if (candidates.length !== 1) throw new LifecycleError('OWNERSHIP_REFUSED', `missing exact receipt for ${id}`);
  const receiptPath = path.join(paths.receipts, candidates[0]);
  const receipt = readJson(receiptPath, 'OWNERSHIP_REFUSED');
  if (receipt.product !== paths.product || receipt.release.id !== id || receipt.receipt_path !== `receipts/${candidates[0]}`) {
    throw new LifecycleError('OWNERSHIP_REFUSED', `receipt identity mismatch for ${id}`);
  }
  const expected = receipt.created_files.filter((item) => item.path.startsWith(`releases/${id}/`)).map((item) => ({
    ...item,
    path: item.path.slice(`releases/${id}/`.length),
  }));
  verifyInventory(path.join(paths.releases, id), expected);
  return { receipt, receiptPath, expected };
}

module.exports = { preparePromotion, receiptFor };
