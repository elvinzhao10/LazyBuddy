'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LifecycleError } = require('./errors');

const PRODUCTS = new Set(['LazyTrae', 'LazyBuddy']);
const BOOTSTRAP_MARKER = '.bootstrap-owner.json';

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

function bootstrapOwnership(paths) {
  const marker = path.join(paths.productRoot, BOOTSTRAP_MARKER);
  try {
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return null;
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (record.schema_version !== 1 || record.product !== paths.product
      || typeof record.nonce !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.nonce)) {
      return null;
    }
    return { dev: stat.dev, ino: stat.ino, marker, nonce: record.nonce };
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return null;
    throw error;
  }
}

function writeBootstrapMarker(root, product) {
  fs.writeFileSync(path.join(root, BOOTSTRAP_MARKER), `${JSON.stringify({
    nonce: crypto.randomUUID(),
    product,
    schema_version: 1,
  })}\n`, { flag: 'wx', mode: 0o600 });
}

function ownsBootstrapMarker(paths, ownership) {
  const current = bootstrapOwnership(paths);
  return current && current.dev === ownership.dev && current.ino === ownership.ino
    && current.nonce === ownership.nonce;
}

function completeBootstrapProductRoot(paths, ownership) {
  if (!ownership) return;
  if (!ownsBootstrapMarker(paths, ownership)) {
    throw new LifecycleError('OWNERSHIP_REFUSED', 'bootstrap ownership marker changed');
  }
  fs.unlinkSync(ownership.marker);
}

function prepareBootstrapProductRoot(options) {
  const paths = productPaths(options);
  assertSafeAncestors(paths.productRoot);
  fs.mkdirSync(paths.installRoot, { recursive: true, mode: 0o700 });
  if (fs.existsSync(paths.productRoot)) {
    const initial = fs.lstatSync(paths.productRoot);
    prepareProductRoot(options);
    const current = fs.lstatSync(paths.productRoot);
    if ((initial.dev !== current.dev || initial.ino !== current.ino) && !bootstrapOwnership(paths)) {
      try {
        writeBootstrapMarker(paths.productRoot, paths.product);
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
      }
    }
    return { ownership: bootstrapOwnership(paths), paths };
  }

  const temporaryRoot = path.join(
    paths.installRoot,
    `.${paths.product}-bootstrap-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    fs.mkdirSync(temporaryRoot, { mode: 0o700 });
    for (const directory of ['releases', 'receipts', 'staging', 'locks', 'rollback']) {
      fs.mkdirSync(path.join(temporaryRoot, directory), { mode: 0o700 });
    }
    writeBootstrapMarker(temporaryRoot, paths.product);
    fs.renameSync(temporaryRoot, paths.productRoot);
  } catch (error) {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true });
    if (!error || (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY')) throw error;
  }
  prepareProductRoot(options);
  return { ownership: bootstrapOwnership(paths), paths };
}

function removeEmptyProductRoot(paths, ownership) {
  if (!ownership) return;
  try {
    const directories = [paths.releases, paths.receipts, paths.staging, paths.locks, paths.rollback];
    const expected = new Set([...directories.map((directory) => path.basename(directory)), BOOTSTRAP_MARKER]);
    const root = fs.lstatSync(paths.productRoot);
    if (!root.isDirectory() || root.isSymbolicLink()) return;
    const names = fs.readdirSync(paths.productRoot);
    if (names.length !== expected.size || names.some((name) => !expected.has(name))) return;
    if (!ownsBootstrapMarker(paths, ownership)) return;
    for (const directory of directories) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(directory).length !== 0) return;
    }
    fs.unlinkSync(ownership.marker);
    for (const directory of directories) fs.rmdirSync(directory);
    fs.rmdirSync(paths.productRoot);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY')) return;
    throw error;
  }
}

module.exports = {
  assertSafeAncestors,
  completeBootstrapProductRoot,
  contained,
  prepareBootstrapProductRoot,
  prepareProductRoot,
  productPaths,
  removeEmptyProductRoot,
  resolveInstallRoot,
};
