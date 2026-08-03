'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');

const LEGACY_LAUNCHER_V1 = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const active = JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8'));
const releases = path.join(root, 'releases');
const release = path.resolve(releases, active.active_release);
if (path.dirname(release) !== releases) throw new Error('active release escapes durable releases');
const entry = path.resolve(release, active.entrypoint);
if (!entry.startsWith(release + path.sep)) throw new Error('entrypoint escapes active release');
const result = spawnSync(active.runtime_path, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
`;

const LAUNCHER = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8'));
let active;
if (raw.schema_version === 1 && (raw.$schema === undefined || raw.$schema === 'lazy-harness-active.v1.schema.json')) {
  active = { ...raw, $schema: 'lazy-harness-active.v2.schema.json', schema_version: 2 };
} else if (raw.schema_version === 2 && raw.$schema === 'lazy-harness-active.v2.schema.json') {
  active = raw;
} else {
  throw new Error('unsupported or tampered active state version');
}
const releases = path.join(root, 'releases');
const release = path.resolve(releases, active.active_release);
if (path.dirname(release) !== releases) throw new Error('active release escapes durable releases');
const entry = path.resolve(release, active.entrypoint);
if (!entry.startsWith(release + path.sep)) throw new Error('entrypoint escapes active release');
const result = spawnSync(active.runtime_path, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
`;

function atomicLauncher(paths, bytes) {
  const temporary = path.join(paths.productRoot, `.launcher.js.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o755);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, paths.launcher);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function installLauncher(paths) {
  if (fs.existsSync(paths.launcher)) {
    const existing = safeFile(paths.launcher);
    if (existing.bytes.equals(Buffer.from(LAUNCHER))) return { changed: false, previous: null };
    if (!existing.bytes.equals(Buffer.from(LEGACY_LAUNCHER_V1))) {
      throw new LifecycleError('OWNERSHIP_REFUSED', 'stable launcher was modified');
    }
    atomicLauncher(paths, Buffer.from(LAUNCHER));
    return { changed: true, previous: existing.bytes };
  }
  atomicLauncher(paths, Buffer.from(LAUNCHER));
  return { changed: true, previous: null };
}

function restoreLauncher(paths, installation) {
  if (!installation.changed) return;
  const current = safeFile(paths.launcher);
  if (!current.bytes.equals(Buffer.from(LAUNCHER))) {
    throw new LifecycleError('OWNERSHIP_REFUSED', 'stable launcher changed during promotion rollback');
  }
  if (installation.previous === null) {
    fs.unlinkSync(paths.launcher);
  } else {
    atomicLauncher(paths, installation.previous);
  }
}

module.exports = { LAUNCHER, LEGACY_LAUNCHER_V1, installLauncher, restoreLauncher };
