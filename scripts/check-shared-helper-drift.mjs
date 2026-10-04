#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const products = ['LazyBuddy', 'LazyTrae', 'LazyQoder', 'LazyZCode', 'LazyKimi', 'LazyDeepSeek'];
const usage = 'Usage: node check-shared-helper-drift.mjs --manifest FILE --root PRODUCT=ABSOLUTE_PAYLOAD (once for each of the six products)';

function requireInput(condition, message) {
  if (!condition) throw new Error(message);
}

function readBounded(file, limit) {
  requireInput(fs.lstatSync(file).isFile(), `expected regular file: ${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireInput(stat.isFile() && stat.size <= limit, `file exceeds bounds or is not regular: ${file}`);
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    let count;
    do {
      count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      size += count;
    } while (count > 0 && size <= limit);
    requireInput(size <= limit, `file exceeds bounds: ${file}`);
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function parseManifest(file) {
  const value = JSON.parse(readBounded(file, 128 * 1024));
  requireInput(exactKeys(value, ['schemaVersion', 'products', 'groups']) && value.schemaVersion === 1, 'unsupported manifest structure/version');
  requireInput(Array.isArray(value.products) && value.products.length === products.length
    && new Set(value.products).size === products.length && products.every(p => value.products.includes(p)), 'manifest must name exactly six family products');
  requireInput(Array.isArray(value.groups) && value.groups.length > 0 && value.groups.length <= 128, 'manifest requires 1..128 groups');
  const ids = new Set();
  const files = new Set();
  const covered = new Set();
  for (const group of value.groups) {
    requireInput(exactKeys(group, ['id', 'paths']) && typeof group.id === 'string'
      && /^[a-z0-9][a-z0-9-]{0,79}$/.test(group.id) && !ids.has(group.id), 'invalid or duplicate group id');
    ids.add(group.id);
    requireInput(group.paths !== null && typeof group.paths === 'object' && !Array.isArray(group.paths), `invalid paths: ${group.id}`);
    const entries = Object.entries(group.paths);
    requireInput(entries.length >= 2 && entries.length <= products.length, `group needs 2..6 members: ${group.id}`);
    for (const [product, relative] of entries) {
      requireInput(products.includes(product), `unknown product: ${product}`);
      requireInput(typeof relative === 'string' && relative.length <= 512
        && relative.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), `unsafe helper path: ${product}/${relative}`);
      const key = `${product}/${relative}`;
      requireInput(!files.has(key), `duplicate helper: ${key}`);
      files.add(key);
      covered.add(product);
    }
  }
  requireInput(covered.size === products.length, 'manifest groups must cover all six products');
  return value;
}

function parseArgs(args) {
  let manifest;
  const roots = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    requireInput(typeof value === 'string' && value.length > 0, usage);
    switch (args[i]) {
      case '--manifest':
        requireInput(manifest === undefined, 'duplicate --manifest');
        manifest = value;
        break;
      case '--root': {
        const split = value.indexOf('=');
        const product = value.slice(0, split);
        const root = value.slice(split + 1);
        requireInput(split > 0 && products.includes(product) && !roots.has(product)
          && path.isAbsolute(root), `invalid or duplicate root: ${value}`);
        requireInput(fs.statSync(root).isDirectory(), `expected payload directory: ${product}=${root}`);
        roots.set(product, fs.realpathSync(root));
        break;
      }
      default:
        throw new Error(usage);
    }
  }
  requireInput(manifest !== undefined && roots.size === products.length, usage);
  requireInput(new Set(roots.values()).size === products.length, 'payload roots must be distinct');
  return { manifest, roots };
}

try {
  const { manifest, roots } = parseArgs(process.argv.slice(2));
  const { groups } = parseManifest(manifest);
  const hashes = [];
  const mismatches = [];
  for (const group of groups) {
    const members = [];
    for (const [product, relative] of Object.entries(group.paths)) {
      const root = roots.get(product);
      const file = path.join(root, relative);
      const resolved = fs.realpathSync(file);
      requireInput(resolved.startsWith(root + path.sep), `helper escapes payload: ${product}/${relative}`);
      const sha256 = createHash('sha256').update(readBounded(file, 8 * 1024 * 1024)).digest('hex');
      members.push({ product, path: relative, sha256 });
    }
    hashes.push({ group: group.id, members });
    if (new Set(members.map(member => member.sha256)).size !== 1) mismatches.push({ group: group.id, members });
  }
  if (mismatches.length > 0) {
    process.stderr.write(JSON.stringify({ verdict: 'FAIL', mismatches }) + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({ verdict: 'PASS', groups: hashes }) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ verdict: 'FAIL', error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
