import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export class FloorError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export function meetsFloor(version, floor) {
  const actual = version.replace(/^v/, '').split('.').map(Number);
  const minimum = floor.split('.').map(Number);
  while (minimum.length < 3) minimum.push(0);
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

function optionsOf(argv, exercises) {
  const options = {};
  const values = new Set(['--exercise', '--expected-runtime', '--surface']);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (Object.hasOwn(options, key)) throw new FloorError('INVALID_OPTIONS', { argument: key });
    if (key === '--expect-unsupported') options[key] = true;
    else if (values.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key] = argv[++i];
    else throw new FloorError('INVALID_OPTIONS', { argument: key });
  }
  const selected = (options['--exercise'] || '').split(',');
  if (selected.some(name => !Object.hasOwn(exercises, name)) || new Set(selected).size !== selected.length) {
    throw new FloorError('INVALID_EXERCISE', { exercise: options['--exercise'] });
  }
  if (options['--expect-unsupported'] && (selected.length !== 1 || selected[0] !== 'lsp-provider')) {
    throw new FloorError('INVALID_OPTIONS', { argument: '--expect-unsupported requires lsp-provider only' });
  }
  return { ...options, selected };
}

export function runChild(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}` },
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error || result.status !== 0) {
    throw new FloorError('CHILD_FAILED', { command, args, status: result.status, signal: result.signal,
      error: result.error?.message, output: `${result.stdout || ''}\n${result.stderr || ''}` });
  }
  return result.stdout.trim();
}

export function isEngineRejection(error) {
  return error instanceof FloorError && error.code === 'CHILD_FAILED' && /\bEBADENGINE\b/.test(error.details.output);
}

function exerciseProvider(root, expectUnsupported) {
  const source = join(root, 'tooling/lsp/typescript');
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const floor = manifest.engines.node.replace(/^>=/, '');
  const supported = meetsFloor(process.versions.node, floor);
  if (expectUnsupported === supported) throw new FloorError('RUNTIME_EXPECTATION', { floor, expectUnsupported });
  const temporary = mkdtempSync(join(tmpdir(), 'lazyseries-floor-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(source, file), join(temporary, file));
    try {
      runChild('npm', ['ci', '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund'], temporary);
    } catch (error) {
      if (expectUnsupported && isEngineRejection(error)) return { floor, outcome: 'engine-rejected' };
      throw error;
    }
    if (expectUnsupported) throw new FloorError('UNEXPECTED_INSTALL_SUCCESS', { floor });
    const version = runChild(process.execPath, [join(temporary, 'node_modules/typescript-language-server/lib/cli.mjs'), '--version'], temporary);
    if (version !== manifest.dependencies['typescript-language-server']) throw new FloorError('PROVIDER_VERSION_MISMATCH', { version });
    return { floor, outcome: 'executed', version };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyFloor(config, argv = process.argv.slice(2)) {
  try {
    const options = optionsOf(argv, config.exercises);
    const surface = options['--surface'] || config.defaultSurface;
    const floor = config.surfaces[surface];
    if (!floor) throw new FloorError('INVALID_SURFACE', { surface });
    if (options['--expected-runtime'] && process.versions.node !== options['--expected-runtime']) {
      throw new FloorError('RUNTIME_MISMATCH', { expected: options['--expected-runtime'], actual: process.versions.node });
    }
    const results = [];
    for (const exercise of options.selected) {
      if (exercise === 'lsp-provider') results.push({ exercise, ...exerciseProvider(config.root, options['--expect-unsupported'] === true) });
      else {
        const required = exercise === 'onboarding' ? '20.0.0' : floor;
        if (!meetsFloor(process.versions.node, required)) throw new FloorError('UNSUPPORTED_RUNTIME', { exercise, floor: required });
        runChild(process.execPath, surface === 'cli' && config.cliExercises ? config.cliExercises[exercise] : config.exercises[exercise], config.root);
        results.push({ exercise, outcome: 'executed' });
      }
    }
    process.stdout.write(`${JSON.stringify({ verdict: 'PASS', runtime: process.versions.node, surface, declared_floor: floor, results })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: 'FAIL', code: error instanceof FloorError ? error.code : 'UNEXPECTED_ERROR',
      details: error instanceof FloorError ? error.details : { message: error instanceof Error ? error.message : String(error) } })}\n`);
    return 1;
  }
}
