#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const products = Object.freeze({
  LazyBuddy: 'lazybuddy-plugin',
  LazyTrae: 'lazytrae-plugin/packages/cli',
  LazyQoder: 'lazyqoder-plugin',
  LazyZCode: 'plugins/lazyzcode',
  LazyKimi: 'lazykimi-plugin',
  LazyDeepSeek: 'plugins/lazydeepseek',
});
const families = Object.freeze({
  dashboard: Object.freeze({
    name: 'dashboard',
    directory: 'shared/dashboard',
    sidecarName: 'dashboard.vendor.json',
    manifestFile: 'scripts/dashboard-vendor-manifest.v1.json',
    partial: false,
    selection: null,
    boundary: Object.freeze({ hostAdapter: 'not-included', siblingRuntime: 'unsupported-until-native-adapter',
      entrypoints: Object.freeze(['projection.mjs', 'command-reducer.mjs', 'queue-reducer.mjs', 'ui/index.mjs']) }),
    license: Object.freeze({ spdx: 'MIT', files: Object.freeze(['LICENSE', 'NOTICE', 'ui/icons.LICENSE']) }),
    portableFiles: Object.freeze(new Set([
      'LICENSE', 'NOTICE', 'command-reducer.mjs', 'projection.mjs',
      'queue-reducer.mjs', 'revision-compatibility.mjs', 'adapters/host.mjs',
      'adapters/ledger.mjs', 'adapters/runtime.mjs', 'adapters/state.mjs', 'adapters/package-health.mjs', 'adapters/telemetry.mjs',
    ])),
    portableTrees: Object.freeze(['contracts', 'ui']),
  }),
  project: Object.freeze({
    name: 'project',
    directory: 'shared/project',
    sidecarName: 'project.vendor.json',
    manifestFile: 'scripts/project-vendor-manifest.v1.json',
    partial: true,
    selection: Object.freeze({
      mode: 'full-tree-excluding',
      excludedPaths: Object.freeze(['test', 'qa/fault-hooks', 'qa/native-identity.mjs']),
      excludedDirectoryNames: Object.freeze(['__pycache__']),
      rationale: Object.freeze([
        'Ships the closed portable unit: the runtime modules (contract, model, history,',
        'projection, cli, architecture, usage-accounting, reconciliation, artifacts/, baseline/,',
        'plans/, git-observation/, source-edit/) plus the portable qa harness (helpers,',
        'inactivity-baseline, store-boundary). Runtime modules and the portable qa harness',
        'import nothing outside this tree. Excludes test/ and qa/native-identity.mjs because',
        'they are Buddy-side contract proof bound to dashboard dev files',
        '(dashboard/test/command-fixture.mjs, dashboard/test/queue-fixture.mjs,',
        'dashboard/test/producer-workload.mjs, dashboard/producers.mjs) that no family',
        'manifest distributes, so they cannot run in siblings; ports author their own adapter',
        'tests against the vendored runtime, and the fixtures stay with their tests. Excludes',
        'qa/fault-hooks because deliberate fault-injection hooks must never distribute to',
        'sibling packages. Excludes generated __pycache__ bytecode caches (git-ignored).',
        'Siblings receive this tree byte-identically at T21-T25 via --write --family project.',
      ].join(' ')),
    }),
    boundary: Object.freeze({ hostAdapter: 'not-included', siblingRuntime: 'pending-native-ports-t21-t25',
      entrypoints: Object.freeze(['contract.mjs', 'model.mjs', 'history.mjs', 'projection.mjs', 'cli.mjs']) }),
    license: Object.freeze({ spdx: 'MIT', files: Object.freeze([]) }),
  }),
});
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const usage = 'Usage: node scripts/vendor-dashboard.mjs --check|--write|--pin [--family dashboard|project] [--source-revision SHA] [--manifest FILE] [--require-complete] --root Product=/absolute/repository (six times; --pin takes only LazyBuddy; --check --family project also accepts the single LazyBuddy root)';

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

function excludedFromFamily(family, relative) {
  const selection = family.selection;
  if (!selection) return false;
  if (relative.split('/').some(part => selection.excludedDirectoryNames.includes(part))) return true;
  return selection.excludedPaths.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
}

function walk(directory, family, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    requireInput(!entry.isSymbolicLink(), `linked ${family.name} path: ${path.join(directory, entry.name)}`);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (excludedFromFamily(family, name)) continue;
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), family, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`unsupported ${family.name} path: ${path.join(directory, entry.name)}`);
  }
  return files;
}

function selectedSourceFiles(family, source) {
  if (!family.selection) {
    const files = [...family.portableFiles];
    for (const tree of family.portableTrees) files.push(...walk(path.join(source, tree), family, tree));
    return files.sort((a, b) => a.localeCompare(b, 'en'));
  }
  return walk(source, family).sort((a, b) => a.localeCompare(b, 'en'));
}

function inventory(family, directory, expectedFiles) {
  requireInput(fs.lstatSync(directory).isDirectory(), `expected ${family.name} directory: ${directory}`);
  const files = expectedFiles ?? walk(directory, family);
  requireInput(files.length > 0 && files.length <= 256, `${family.name} file count is outside bounds`);
  let total = 0;
  const records = files.map(relative => {
    requireInput(relative.split('/').every(part => part && part !== '.' && part !== '..'), `unsafe ${family.name} path: ${relative}`);
    const bytes = readRegular(path.join(directory, relative));
    total += bytes.length;
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
  requireInput(total <= 32 * 1024 * 1024, `${family.name} payload exceeds bounds`);
  const treeSha256 = sha256(records.map(item => `${item.path}\0${item.bytes}\0${item.sha256}\n`).join(''));
  return { files: records, treeSha256 };
}

function defaultManifestPath(family) {
  return path.join(repositoryRoot, family.manifestFile);
}

function productDirectory(family, product) {
  return path.join(products[product], family.directory);
}

function parseArgs(argv) {
  let mode; let revision; let familyName = 'dashboard'; let manifestPath; let manifestGiven = false;
  let requireComplete = false; const roots = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check' || flag === '--write' || flag === '--pin') {
      requireInput(!mode, usage); mode = flag.slice(2); continue;
    }
    if (flag === '--require-complete') {
      requireInput(!requireComplete, usage); requireComplete = true; continue;
    }
    const value = argv[++index]; requireInput(value, usage);
    if (flag === '--family') {
      requireInput(familyName === 'dashboard' && Object.hasOwn(families, value), usage); familyName = value; continue;
    }
    if (flag === '--source-revision') {
      requireInput(!revision && /^[a-f0-9]{40}$/.test(value), 'source revision must be one full commit SHA');
      revision = value; continue;
    }
    if (flag === '--manifest') {
      requireInput(!manifestGiven, 'duplicate --manifest');
      manifestPath = path.resolve(value); manifestGiven = true; continue;
    }
    requireInput(flag === '--root', usage);
    const split = value.indexOf('='); const product = value.slice(0, split); const root = value.slice(split + 1);
    requireInput(Object.hasOwn(products, product) && !roots.has(product) && path.isAbsolute(root), `invalid root: ${value}`);
    requireInput(fs.lstatSync(root).isDirectory(), `expected repository directory: ${root}`);
    roots.set(product, fs.realpathSync(root));
  }
  const family = families[familyName];
  if (!manifestGiven) manifestPath = defaultManifestPath(family);
  const expectedRoots = mode === 'pin' ? ['LazyBuddy']
    : family.partial && mode === 'check' && roots.size === 1 ? ['LazyBuddy']
    : Object.keys(products);
  requireInput(mode && roots.size === expectedRoots.length && expectedRoots.every(product => roots.has(product))
    && new Set(roots.values()).size === roots.size, usage);
  requireInput(mode === 'check' ? !revision : Boolean(revision) && !manifestGiven, usage);
  requireInput(!requireComplete || (mode === 'check' && family.partial), usage);
  return { mode, revision, roots, manifestPath, family, requireComplete };
}

function manifestFor(family, source, revision) {
  const content = inventory(family, source, selectedSourceFiles(family, source));
  const manifest = {
    schemaVersion: 1,
    source: { repository: 'https://github.com/elvinzhao10/LazyBuddy', revision,
      path: productDirectory(family, 'LazyBuddy'), treeSha256: content.treeSha256 },
    boundary: family.boundary,
    license: family.license,
    files: content.files,
  };
  if (family.selection) manifest.selection = family.selection;
  return manifest;
}

function stableJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sidecar(family, root, product) {
  return path.join(root, products[product], path.dirname(family.directory), family.sidecarName);
}

function validateFileRecords(family, value) {
  requireInput(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 256,
    `malformed ${family.name} file inventory`);
  const names = new Set();
  for (const item of value.files) requireInput(item && typeof item.path === 'string'
    && item.path.split('/').every(part => part && part !== '.' && part !== '..') && Number.isSafeInteger(item.bytes)
    && item.bytes >= 0 && /^[a-f0-9]{64}$/.test(item.sha256) && !names.has(item.path) && (names.add(item.path), true),
  `malformed or duplicate ${family.name} file record`);
  if (family.selection) {
    requireInput(JSON.stringify(value.selection) === JSON.stringify(family.selection),
      `${family.name} selection policy drift between manifest and tool`);
  }
}

function validateManifest(value, family) {
  requireInput(value?.schemaVersion === 1 && value.source?.repository === 'https://github.com/elvinzhao10/LazyBuddy'
    && /^[a-f0-9]{40}$/.test(value.source?.revision) && value.source?.path === productDirectory(family, 'LazyBuddy')
    && /^[a-f0-9]{64}$/.test(value.source?.treeSha256), `malformed ${family.name} vendor manifest`);
  requireInput(value.boundary?.hostAdapter === family.boundary.hostAdapter
    && value.boundary?.siblingRuntime === family.boundary.siblingRuntime
    && JSON.stringify(value.boundary?.entrypoints) === JSON.stringify(family.boundary.entrypoints),
  `malformed ${family.name} boundary`);
  requireInput(value.license?.spdx === family.license.spdx
    && JSON.stringify(value.license?.files) === JSON.stringify(family.license.files),
  `malformed ${family.name} license provenance`);
  validateFileRecords(family, value);
  return value;
}

function check(manifest, roots, family, requireComplete) {
  const manifestBytes = stableJSON(manifest); const expectedNames = manifest.files.map(item => item.path);
  const pendingPorts = []; const checkedRoots = [];
  for (const [product, root] of roots) {
    const directory = path.join(root, productDirectory(family, product));
    if (!fs.existsSync(directory)) {
      requireInput(product !== 'LazyBuddy', 'LazyBuddy: canonical tree is missing');
      requireInput(!requireComplete, `${product}: ${family.name} tree missing under --require-complete`);
      pendingPorts.push(product); continue;
    }
    const actual = inventory(family, directory, family.partial ? selectedSourceFiles(family, directory) : product === 'LazyBuddy' ? expectedNames : undefined);
    for (const expected of manifest.files) {
      const found = actual.files.find(item => item.path === expected.path);
      requireInput(found, `${product}: missing pinned ${family.name} file at ${expected.path}`);
      requireInput(found.bytes === expected.bytes && found.sha256 === expected.sha256,
        `${product}: ${family.name} byte drift at ${expected.path}`);
    }
    for (const extra of actual.files.filter(item => !expectedNames.includes(item.path))) {
      requireInput(false, `${product}: unpinned ${family.name} file at ${extra.path}`);
    }
    requireInput(actual.treeSha256 === manifest.source.treeSha256, `${product}: ${family.name} file set mismatch`);
    requireInput(readRegular(sidecar(family, root, product)).equals(Buffer.from(manifestBytes)), `${product}: vendor provenance drift`);
    checkedRoots.push(product);
  }
  if (!family.partial || pendingPorts.length === 0) {
    process.stdout.write(`${JSON.stringify({ verdict: 'PASS', ...(family.partial ? { family: family.name } : {}),
      sourceRevision: manifest.source.revision,
      treeSha256: manifest.source.treeSha256, products: Object.keys(products), files: manifest.files.length })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ verdict: 'PENDING_PORTS', family: family.name, sourceRevision: manifest.source.revision,
    treeSha256: manifest.source.treeSha256, checkedRoots, pendingPorts, files: manifest.files.length,
    note: 'pending ports do not have the vendored tree yet and are NOT passing; they receive it at T21-T25 via --write' })}\n`);
}

function write(manifest, roots, family) {
  const source = path.join(roots.get('LazyBuddy'), productDirectory(family, 'LazyBuddy')); const bytes = stableJSON(manifest);
  for (const [product, root] of roots) {
    const target = path.join(root, productDirectory(family, product));
    if (product !== 'LazyBuddy') {
      requireInput(!fs.existsSync(target) || fs.existsSync(sidecar(family, root, product)), `refusing unmanaged target: ${target}`);
      fs.rmSync(target, { recursive: true, force: true });
      for (const item of manifest.files) {
        const destination = path.join(target, item.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, readRegular(path.join(source, item.path)), { mode: 0o644 });
      }
    }
    fs.mkdirSync(path.dirname(sidecar(family, root, product)), { recursive: true }); fs.writeFileSync(sidecar(family, root, product), bytes);
  }
  fs.writeFileSync(defaultManifestPath(family), bytes);
}

function pin(manifest, roots, family) {
  requireInput(roots.get('LazyBuddy') === fs.realpathSync(repositoryRoot), '--pin requires the LazyBuddy root to be this repository');
  const bytes = stableJSON(manifest);
  fs.writeFileSync(defaultManifestPath(family), bytes);
  const sidecarPath = sidecar(family, roots.get('LazyBuddy'), 'LazyBuddy');
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true }); fs.writeFileSync(sidecarPath, bytes);
  process.stdout.write(`${JSON.stringify({ verdict: 'PINNED', family: family.name, sourceRevision: manifest.source.revision,
    treeSha256: manifest.source.treeSha256, files: manifest.files.length, manifest: family.manifestFile,
    sidecar: path.join(products.LazyBuddy, path.dirname(family.directory), family.sidecarName) })}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const source = path.join(options.roots.get('LazyBuddy'), productDirectory(options.family, 'LazyBuddy'));
  if (options.mode === 'write') write(manifestFor(options.family, source, options.revision), options.roots, options.family);
  if (options.mode === 'pin') pin(manifestFor(options.family, source, options.revision), options.roots, options.family);
  const manifest = validateManifest(JSON.parse(readRegular(options.manifestPath, 1024 * 1024)), options.family);
  check(manifest, options.roots, options.family, options.requireComplete);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ verdict: 'FAIL', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
