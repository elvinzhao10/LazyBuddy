'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LifecycleError } = require('./errors');

const PRODUCTS = new Set(['LazyTrae', 'LazyBuddy']);

function resolveInstallRoot({
  installRoot,
  platform = process.platform,
  environment = process.env,
  home = environment.HOME,
} = {}) {
  if (installRoot !== undefined) {
    if (!path.isAbsolute(installRoot) || path.parse(path.resolve(installRoot)).root === path.resolve(installRoot)) {
      throw new LifecycleError('INVALID_ROOT', '--install-root must be a non-root absolute path');
    }
    return path.resolve(installRoot);
  }
  if (platform === 'win32') {
    const local = environment.LOCALAPPDATA;
    if (!local || !path.win32.isAbsolute(local)) {
      throw new LifecycleError('INVALID_ROOT', 'LOCALAPPDATA must be an absolute path');
    }
    return path.win32.join(local, 'LazySeries');
  }
  if (!home || !path.posix.isAbsolute(home)) {
    throw new LifecycleError('INVALID_ROOT', 'home directory must be an absolute path');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'LazySeries');
  if (platform === 'linux') {
    const data = environment.XDG_DATA_HOME || path.join(home, '.local', 'share');
    if (!path.isAbsolute(data)) throw new LifecycleError('INVALID_ROOT', 'XDG_DATA_HOME must be absolute');
    return path.join(data, 'lazyseries');
  }
  throw new LifecycleError('UNSUPPORTED_PLATFORM', `unsupported platform: ${platform}`);
}

function assertSafeAncestors(target) {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return;
    const stat = fs.lstatSync(current);
    const tempRoot = fs.realpathSync(os.tmpdir());
    const resolvedCurrent = stat.isSymbolicLink() ? fs.realpathSync(current) : current;
    const tempAlias = stat.isSymbolicLink()
      && (tempRoot.startsWith(`${resolvedCurrent}${path.sep}`) || tempRoot === resolvedCurrent);
    if (stat.isSymbolicLink() && !tempAlias) throw new LifecycleError('UNSAFE_PATH', `symlinked path component: ${current}`);
    if (current !== resolved && !stat.isDirectory() && !tempAlias) {
      throw new LifecycleError('UNSAFE_PATH', `non-directory path component: ${current}`);
    }
  }
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function productPaths({ installRoot, product }) {
  if (!PRODUCTS.has(product)) throw new LifecycleError('INVALID_PRODUCT', `unsupported product: ${product}`);
  const resolvedRoot = resolveInstallRoot({ installRoot });
  const productRoot = path.join(resolvedRoot, product);
  return {
    installRoot: resolvedRoot,
    product,
    productRoot,
    releases: path.join(productRoot, 'releases'),
    active: path.join(productRoot, 'active.json'),
    launcher: path.join(productRoot, 'launcher.js'),
    receipts: path.join(productRoot, 'receipts'),
    staging: path.join(productRoot, 'staging'),
    locks: path.join(productRoot, 'locks'),
    lock: path.join(productRoot, 'locks', 'lifecycle.lock'),
    rollback: path.join(productRoot, 'rollback'),
    rollbackMarker: path.join(productRoot, 'rollback', 'retained.json'),
  };
}

function prepareProductRoot(options) {
  const paths = productPaths(options);
  assertSafeAncestors(paths.productRoot);
  for (const directory of [paths.releases, paths.receipts, paths.staging, paths.locks, paths.rollback]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new LifecycleError('UNSAFE_PATH', `unsafe durable directory: ${directory}`);
    }
  }
  return paths;
}

function productRootIdentity(paths) {
  try {
    const stat = fs.lstatSync(paths.productRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new LifecycleError('UNSAFE_PATH', `unsafe product root: ${paths.productRoot}`);
    }
    return { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function prepareExistingProductRoot(paths, identity) {
  for (const directory of [paths.releases, paths.receipts, paths.staging, paths.locks, paths.rollback]) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    }
    let stat;
    try {
      stat = fs.lstatSync(directory);
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new LifecycleError('UNSAFE_PATH', `unsafe durable directory: ${directory}`);
    }
    const current = productRootIdentity(paths);
    if (!current || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  }
  return true;
}

function prepareBootstrapProductRoot(options) {
  const paths = productPaths(options);
  assertSafeAncestors(paths.productRoot);
  fs.mkdirSync(paths.installRoot, { recursive: true, mode: 0o700 });
  while (true) {
    const existing = productRootIdentity(paths);
    if (existing) {
      if (prepareExistingProductRoot(paths, existing)) return { ownership: null, paths };
      continue;
    }
    try {
      fs.mkdirSync(paths.productRoot, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      continue;
    }
    const ownership = productRootIdentity(paths);
    if (!ownership) continue;
    if (prepareExistingProductRoot(paths, ownership)) return { ownership, paths };
  }
}

function quarantineEmptyProductRoot(paths, ownership) {
  if (!ownership) return null;
  try {
    const directories = [paths.releases, paths.receipts, paths.staging, paths.locks, paths.rollback];
    const expected = new Set(directories.map((directory) => path.basename(directory)));
    const root = fs.lstatSync(paths.productRoot);
    if (!root.isDirectory() || root.isSymbolicLink()
      || root.dev !== ownership.dev || root.ino !== ownership.ino) return null;
    const names = fs.readdirSync(paths.productRoot);
    if (names.length !== expected.size || names.some((name) => !expected.has(name))) return null;
    for (const directory of directories) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      const entries = fs.readdirSync(directory);
      if (directory === paths.locks) {
        if (entries.length !== 1 || entries[0] !== path.basename(paths.lock)) return null;
      } else if (entries.length !== 0) {
        return null;
      }
    }
    const quarantine = path.join(
      paths.installRoot,
      `.${paths.product}-cleanup-${process.pid}-${crypto.randomUUID()}`,
    );
    fs.renameSync(paths.productRoot, quarantine);
    return quarantine;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY')) return null;
    throw error;
  }
}

function removeQuarantinedProductRoot(paths, quarantine) {
  try {
    for (const directory of [paths.releases, paths.receipts, paths.staging, paths.locks, paths.rollback]) {
      fs.rmdirSync(path.join(quarantine, path.basename(directory)));
    }
    fs.rmdirSync(quarantine);
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR', 'ENOTEMPTY'].includes(error.code)) return;
    throw error;
  }
}

module.exports = {
  assertSafeAncestors,
  contained,
  prepareBootstrapProductRoot,
  prepareProductRoot,
  productPaths,
  quarantineEmptyProductRoot,
  removeQuarantinedProductRoot,
  resolveInstallRoot,
};
