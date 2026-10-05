#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const products = Object.freeze({
  LazyBuddy: 'lazybuddy-plugin/shared/dashboard',
  LazyTrae: 'lazytrae-plugin/packages/cli/shared/dashboard',
  LazyQoder: 'lazyqoder-plugin/shared/dashboard',
  LazyZCode: 'plugins/lazyzcode/shared/dashboard',
  LazyKimi: 'lazykimi-plugin/shared/dashboard',
  LazyDeepSeek: 'plugins/lazydeepseek/shared/dashboard',
});
const portableFiles = new Set([
  'LICENSE', 'NOTICE', 'command-reducer.mjs', 'projection.mjs',
  'queue-reducer.mjs', 'revision-compatibility.mjs', 'adapters/host.mjs',
  'adapters/ledger.mjs', 'adapters/runtime.mjs', 'adapters/state.mjs',
]);
const portableTrees = ['contracts', 'ui'];
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultManifestPath = path.join(repositoryRoot, 'scripts/dashboard-vendor-manifest.v1.json');
const usage = 'Usage: node scripts/vendor-dashboard.mjs --check|--write [--source-revision SHA] [--manifest FILE] --root Product=/absolute/repository (six times)';

function requireInput(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readRegular(file, limit = 8 * 1024 * 1024) {
  requireInput(fs.lstatSync(file).isFile(), `expected regular file: ${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireInput(stat.isFile() && stat.size <= limit, `file exceeds bounds or is not regular: ${file}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function walk(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    requireInput(!entry.isSymbolicLink(), `linked dashboard path: ${path.join(directory, entry.name)}`);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`unsupported dashboard path: ${path.join(directory, entry.name)}`);
  }
  return files;
}

function selectedSourceFiles(source) {
  const files = [...portableFiles];
  for (const tree of portableTrees) files.push(...walk(path.join(source, tree), tree));
  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

function inventory(directory, expectedFiles) {
  requireInput(fs.lstatSync(directory).isDirectory(), `expected dashboard directory: ${directory}`);
  const files = expectedFiles ?? walk(directory);
  requireInput(files.length > 0 && files.length <= 256, 'dashboard file count is outside bounds');
  let total = 0;
  const records = files.map(relative => {
    requireInput(relative.split('/').every(part => part && part !== '.' && part !== '..'), `unsafe dashboard path: ${relative}`);
    const bytes = readRegular(path.join(directory, relative));
    total += bytes.length;
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
  requireInput(total <= 32 * 1024 * 1024, 'dashboard payload exceeds bounds');
  const treeSha256 = sha256(records.map(item => `${item.path}\0${item.bytes}\0${item.sha256}\n`).join(''));
  return { files: records, treeSha256 };
}

function parseArgs(argv) {
  let mode; let revision; let manifestPath = defaultManifestPath; const roots = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check' || flag === '--write') {
      requireInput(!mode, usage); mode = flag.slice(2); continue;
    }
    const value = argv[++index]; requireInput(value, usage);
    if (flag === '--source-revision') {
      requireInput(!revision && /^[a-f0-9]{40}$/.test(value), 'source revision must be one full commit SHA');
      revision = value; continue;
    }
    if (flag === '--manifest') {
      requireInput(manifestPath === defaultManifestPath, 'duplicate --manifest');
      manifestPath = path.resolve(value); continue;
    }
    requireInput(flag === '--root', usage);
    const split = value.indexOf('='); const product = value.slice(0, split); const root = value.slice(split + 1);
    requireInput(Object.hasOwn(products, product) && !roots.has(product) && path.isAbsolute(root), `invalid root: ${value}`);
    requireInput(fs.lstatSync(root).isDirectory(), `expected repository directory: ${root}`);
    roots.set(product, fs.realpathSync(root));
  }
  requireInput(mode && roots.size === Object.keys(products).length && new Set(roots.values()).size === roots.size, usage);
  requireInput(mode === 'check' ? !revision : Boolean(revision) && manifestPath === defaultManifestPath, usage);
  return { mode, revision, roots, manifestPath };
}

function manifestFor(source, revision) {
  const content = inventory(source, selectedSourceFiles(source));
  return {
    schemaVersion: 1,
    source: { repository: 'https://github.com/elvinzhao10/LazyBuddy', revision,
      path: products.LazyBuddy, treeSha256: content.treeSha256 },
    boundary: { hostAdapter: 'not-included', siblingRuntime: 'unsupported-until-native-adapter',
      entrypoints: ['projection.mjs', 'command-reducer.mjs', 'queue-reducer.mjs', 'ui/index.mjs'] },
    license: { spdx: 'MIT', files: ['LICENSE', 'NOTICE', 'ui/icons.LICENSE'] },
    files: content.files,
  };
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sidecar(root, product) {
  return path.join(root, path.dirname(products[product]), 'dashboard.vendor.json');
}

function validateManifest(value) {
  requireInput(value?.schemaVersion === 1 && value.source?.repository === 'https://github.com/elvinzhao10/LazyBuddy'
    && /^[a-f0-9]{40}$/.test(value.source?.revision) && value.source?.path === products.LazyBuddy
    && /^[a-f0-9]{64}$/.test(value.source?.treeSha256), 'malformed dashboard vendor manifest');
  requireInput(value.boundary?.hostAdapter === 'not-included'
    && value.boundary?.siblingRuntime === 'unsupported-until-native-adapter', 'malformed dashboard boundary');
  requireInput(value.license?.spdx === 'MIT' && Array.isArray(value.license.files), 'malformed dashboard license provenance');
  requireInput(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 256, 'malformed dashboard file inventory');
  const names = new Set();
  for (const item of value.files) requireInput(item && typeof item.path === 'string'
    && item.path.split('/').every(part => part && part !== '.' && part !== '..') && Number.isSafeInteger(item.bytes)
    && item.bytes >= 0 && /^[a-f0-9]{64}$/.test(item.sha256) && !names.has(item.path) && (names.add(item.path), true),
  'malformed or duplicate dashboard file record');
  return value;
}

function check(manifest, roots) {
  const manifestBytes = stableJSON(manifest); const expectedNames = manifest.files.map(item => item.path);
  for (const [product, root] of roots) {
    const directory = path.join(root, products[product]);
    const actual = inventory(directory, product === 'LazyBuddy' ? expectedNames : undefined);
    for (const expected of manifest.files) {
      const found = actual.files.find(item => item.path === expected.path);
      requireInput(found && found.bytes === expected.bytes && found.sha256 === expected.sha256,
        `${product}: dashboard drift at ${expected.path}`);
    }
    requireInput(actual.treeSha256 === manifest.source.treeSha256, `${product}: dashboard file set mismatch`);
    requireInput(readRegular(sidecar(root, product)).equals(Buffer.from(manifestBytes)), `${product}: vendor provenance drift`);
  }
  process.stdout.write(`${JSON.stringify({ verdict: 'PASS', sourceRevision: manifest.source.revision,
    treeSha256: manifest.source.treeSha256, products: Object.keys(products), files: manifest.files.length })}\n`);
}

function write(manifest, roots) {
  const source = path.join(roots.get('LazyBuddy'), products.LazyBuddy); const bytes = stableJSON(manifest);
  for (const [product, root] of roots) {
    const target = path.join(root, products[product]);
    if (product !== 'LazyBuddy') {
      requireInput(!fs.existsSync(target) || fs.existsSync(sidecar(root, product)), `refusing unmanaged target: ${target}`);
      fs.rmSync(target, { recursive: true, force: true });
      for (const item of manifest.files) {
        const destination = path.join(target, item.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, readRegular(path.join(source, item.path)), { mode: 0o644 });
      }
    }
    fs.mkdirSync(path.dirname(sidecar(root, product)), { recursive: true }); fs.writeFileSync(sidecar(root, product), bytes);
  }
  fs.writeFileSync(defaultManifestPath, bytes);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const source = path.join(options.roots.get('LazyBuddy'), products.LazyBuddy);
  if (options.mode === 'write') write(manifestFor(source, options.revision), options.roots);
  const manifest = validateManifest(JSON.parse(readRegular(options.manifestPath, 1024 * 1024)));
  check(manifest, options.roots);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ verdict: 'FAIL', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
