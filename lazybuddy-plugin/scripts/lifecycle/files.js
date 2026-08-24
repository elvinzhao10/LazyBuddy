'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { contained } = require('./paths');

const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const GENERATED_SOURCE_DIRECTORIES = new Set([
  'lazybuddy-plugin/tooling/node_modules',
]);

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeFile(file, code = 'OWNERSHIP_REFUSED') {
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) throw new LifecycleError(code, `unsafe file: ${file}`);
    return { bytes: fs.readFileSync(descriptor), stat };
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError(code, `cannot safely read file: ${file}`, error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readJson(file, code = 'MALFORMED_STATE') {
  try {
    return JSON.parse(safeFile(file, code).bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof LifecycleError && error.cause === undefined) throw error;
    throw new LifecycleError(code, `invalid JSON: ${file}`, error);
  }
}

function atomicJson(root, target, value, mode = 0o600) {
  if (!contained(root, target)) throw new LifecycleError('UNSAFE_PATH', `write outside product root: ${target}`);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, mode);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function inventoryTree(root, current, omitGenerated) {
  const entries = [];
  for (const name of fs.readdirSync(current)) {
    const absolute = path.join(current, name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new LifecycleError('OWNERSHIP_REFUSED', `symlinked content: ${relative}`);
    if (stat.isDirectory()) {
      if (omitGenerated && GENERATED_SOURCE_DIRECTORIES.has(relative)) continue;
      entries.push({ path: relative, type: 'directory', mode: modeOf(stat), sha256: null });
      entries.push(...inventoryTree(root, absolute, omitGenerated));
    } else if (stat.isFile() && stat.nlink === 1) {
      entries.push({ path: relative, type: 'file', mode: modeOf(stat), sha256: sha256File(absolute) });
    } else {
      throw new LifecycleError('OWNERSHIP_REFUSED', `linked or unsupported content: ${relative}`);
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function inventory(root, current = root) {
  return inventoryTree(root, current, false);
}

function inventoryReleaseSource(root) {
  return inventoryTree(root, root, true);
}

function includeReleaseSource(root, candidate) {
  const relative = path.relative(root, candidate).split(path.sep).join('/');
  if (!GENERATED_SOURCE_DIRECTORIES.has(relative)) return true;
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LifecycleError('OWNERSHIP_REFUSED', `unsafe generated dependency root: ${relative}`);
  }
  return false;
}

function modeOf(stat) {
  return `0${(stat.mode & 0o777).toString(8).padStart(3, '0')}`;
}

function verifyInventory(root, expected) {
  const actual = inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new LifecycleError('OWNERSHIP_REFUSED', `receipt mismatch: ${root}`);
  }
}

function removeInventory(root, entries) {
  for (const entry of [...entries].filter((item) => item.type === 'file').reverse()) {
    fs.unlinkSync(path.join(root, entry.path));
  }
  for (const entry of [...entries].filter((item) => item.type === 'directory').reverse()) {
    fs.rmdirSync(path.join(root, entry.path));
  }
}

module.exports = {
  atomicJson,
  includeReleaseSource,
  inventory,
  inventoryReleaseSource,
  readJson,
  removeInventory,
  safeFile,
  sha256File,
  verifyInventory,
};
