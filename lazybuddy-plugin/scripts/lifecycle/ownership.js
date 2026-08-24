'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');
const { contained } = require('./paths');

const ORIGINS = {
  LazyTrae: 'https://github.com/elvinzhao10/LazyTrae.git',
  LazyBuddy: 'https://github.com/elvinzhao10/LazyBuddy.git',
};

function ownedRelativePath(value, code) {
  const segments = typeof value === 'string' ? value.split('/') : [];
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || value.includes('\\') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value) {
    throw new LifecycleError(code, 'path must be a normalized relative release path');
  }
  return value;
}

function validateReceipt(paths, receipt, code = 'INVALID_RECEIPT') {
  if (!receipt || typeof receipt !== 'object' || !receipt.release || typeof receipt.release !== 'object'
    || !receipt.manifest || typeof receipt.manifest !== 'object'
    || !receipt.host_evidence || typeof receipt.host_evidence !== 'object') {
    throw new LifecycleError(code, 'generated lifecycle receipt is invalid');
  }
  const releasePrefix = `releases/${receipt.release.id}`;
  const declarations = receipt.registered_project_declarations;
  const validCreatedFile = (item) => item && typeof item.path === 'string'
    && (item.path === releasePrefix || item.path.startsWith(`${releasePrefix}/`))
    && /^0[0-7]{3}$/.test(item.mode)
    && ((item.type === 'directory' && item.sha256 === null)
      || (item.type === 'file' && typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256)));
  const declarationKeys = ['managed_entry_sha256', 'mode', 'ownership_scope', 'path', 'project_root'];
  const validDeclaration = (declaration) => declaration
    && JSON.stringify(Object.keys(declaration).sort()) === JSON.stringify(declarationKeys)
    && typeof declaration.project_root === 'string'
    && path.isAbsolute(declaration.project_root)
    && path.resolve(declaration.project_root) === declaration.project_root
    && path.parse(declaration.project_root).root !== declaration.project_root
    && !/(?:^|[\\/])\.workbuddy(?:[\\/]|$)/.test(declaration.project_root)
    && !/^(?:\/Applications|\/Library|\/System|\/usr|\/etc|\/var|\/opt)(?:[\\/]|$)/.test(declaration.project_root)
    && !/^[A-Za-z]:[\\/](?:Program Files|Windows)(?:[\\/]|$)/.test(declaration.project_root)
    && typeof declaration.path === 'string'
    && declaration.path === '.trae/mcp.json'
    && typeof declaration.mode === 'string'
    && /^0[0-7]{3}$/.test(declaration.mode)
    && typeof declaration.managed_entry_sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(declaration.managed_entry_sha256)
    && declaration.ownership_scope === 'managed-entry-only';
  if (receipt.schema_version !== 2 || receipt.$schema !== 'lazy-harness-lifecycle.v2.schema.json'
    || receipt.created_files_scope !== 'release-only' || receipt.product !== paths.product
    || receipt.origin !== ORIGINS[paths.product] || !/^[0-9a-f]{40}$/.test(receipt.commit_sha)
    || receipt.release.id !== `${receipt.manifest.version}-${receipt.commit_sha.slice(0, 12)}`
    || receipt.release.path !== releasePrefix
    || receipt.active_release !== receipt.release.id || receipt.manifest.path.indexOf(`${releasePrefix}/`) !== 0
    || receipt.receipt_path !== `receipts/${receipt.receipt_id}.json`
    || !Array.isArray(receipt.created_files) || !Array.isArray(receipt.manifest.digests)
    || receipt.host_evidence.status !== 'pending' || receipt.host_evidence.observation_receipt !== null
    || !receipt.created_files.every(validCreatedFile)
    || !Array.isArray(declarations)
    || (paths.product === 'LazyBuddy' && declarations.length !== 0)
    || (paths.product === 'LazyTrae' && !declarations.every(validDeclaration))) {
    throw new LifecycleError(code, 'generated lifecycle receipt is invalid');
  }
}

function verifyProjectDeclarations(receipt) {
  for (const declaration of receipt.registered_project_declarations) {
    const target = path.resolve(declaration.project_root, declaration.path);
    const file = contained(declaration.project_root, target) ? safeFile(target) : null;
    const digest = file && crypto.createHash('sha256').update(file.bytes).digest('hex');
    if (digest !== declaration.managed_entry_sha256) {
      throw new LifecycleError('OWNERSHIP_REFUSED', `project declaration changed: ${target}`);
    }
  }
}

module.exports = {
  ORIGINS,
  ownedRelativePath,
  validateReceipt,
  verifyProjectDeclarations,
};
