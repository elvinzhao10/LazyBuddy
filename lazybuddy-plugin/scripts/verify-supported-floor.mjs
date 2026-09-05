#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function optionsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`invalid argument ${key}`);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { result[key.slice(2)] = next; index += 1; }
    else result[key.slice(2)] = true;
  }
  return result;
}
function major(version) { return Number(version.replace(/^v/, '').split('.')[0]); }

try {
  const options = optionsOf(process.argv.slice(2));
  const runtime = process.versions.node;
  if (options['expected-runtime'] && runtime !== options['expected-runtime']) throw new Error(`runtime ${runtime} != ${options['expected-runtime']}`);
  let supported = major(runtime) >= 20;
  let packageEngine = null;
  if (options['probe-package']) {
    packageEngine = execFileSync('npm', ['view', options['probe-package'], 'engines.node', '--json'], { encoding: 'utf8' }).trim().replace(/^"|"$/g, '');
    if (packageEngine !== options['expect-package-engine']) throw new Error(`package engine ${packageEngine} != ${options['expect-package-engine']}`);
    const root = mkdtempSync(join(tmpdir(), 'lazybuddy-floor-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { [options['probe-package'].split('@')[0]]: options['probe-package'].split('@').at(-1) } }));
    writeFileSync(join(root, '.npmrc'), 'engine-strict=true\n');
    let rejected = false;
    try { execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'pipe' }); } catch { rejected = true; }
    supported = supported && !rejected;
  }
  const expectUnsupported = options['expect-unsupported'] === true;
  if (expectUnsupported === supported) throw new Error(expectUnsupported ? 'unsupported surface unexpectedly provisioned' : 'supported surface rejected');
  const packageJson = JSON.parse(readFileSync(new URL('../tooling/lsp/typescript/package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${JSON.stringify({ runtime, declared_floor: '20.0.0', package_engine: packageEngine, lsp_version: packageJson.dependencies['typescript-language-server'], exercise: options.exercise ?? 'current', verdict: 'PASS' })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
