#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectVerificationPolicy } = require('./verification-risk-policy');

const ALL_GATES = [
  'targeted-tests', 'dependency-tests', 'contract-tests', 'paired-full-suites',
  'independent-review', 'security-review', 'real-surface', 'final-assertions',
];

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--target', '--input', '--gate-config', '--report', '--timeout'].includes(option)) {
      fail(`unsupported verification-risk option: ${option || '<empty>'}`);
    }
    if (value === undefined || value.startsWith('--')) fail(`${option} requires a value`);
    values[option.slice(2)] = value;
  }
  for (const required of ['target', 'input', 'gate-config', 'report', 'timeout']) {
    if (!values[required]) fail(`--${required} is required`);
  }
  const timeout = Number(values.timeout);
  if (!Number.isSafeInteger(timeout) || timeout < 1) fail('--timeout must be a positive integer');
  return { ...values, timeout };
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} must be readable JSON: ${error.message}`);
  }
}

function safeDirectory(directory) {
  if (!path.isAbsolute(directory)) fail('--target must be absolute');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('--target must be an existing non-symlink canonical directory');
  }
  return fs.realpathSync(directory);
}

function parseCommands(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('gate config must be an object');
  const commands = {};
  for (const gate of ALL_GATES) {
    const command = raw[gate];
    if (!Array.isArray(command) || command.length === 0
      || command.some((part) => typeof part !== 'string' || part.length === 0)) {
      fail(`gate config requires a non-empty argv for ${gate}`);
    }
    commands[gate] = command;
  }
  return commands;
}

function trustedGitExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git']
    : process.platform === 'linux'
      ? ['/usr/bin/git', '/bin/git']
      : [];
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function gitDirty(target) {
  const git = trustedGitExecutable();
  if (!git) return true;
  const result = spawnSync(git, ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd: target, encoding: 'utf8', timeout: 5000,
  });
  return result.status !== 0 || result.stdout.trim().length > 0;
}

function specifications(level) {
  const policy = selectVerificationPolicy({
    taskCategory: level === 'comprehensive' ? 'ultrabrain' : level === 'affected' ? 'deep' : 'quick',
    changedPaths: [], riskFlags: [], capabilityFresh: true, evidenceFresh: true,
    dirtyTree: false, priorOutcomes: [],
  });
  const specs = [];
  for (const gateId of policy.gates) {
    const count = gateId === 'paired-full-suites' ? 2 : 1;
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const actorId = gateId === 'independent-review' || gateId === 'security-review'
        || (gateId === 'paired-full-suites' && ordinal === 2) ? 'actor-2' : 'actor-1';
      specs.push({ gateId, invocationId: `${gateId}#${ordinal}`, actorId });
    }
  }
  return specs;
}

function executeGate(options, command, spec, runtimeRoot) {
  const started = process.hrtime.bigint();
  const prefix = spec.invocationId.replaceAll(/[^a-z0-9-]/gi, '-');
  const resultFile = path.join(runtimeRoot, `${prefix}.json`);
  const stdin = path.join(runtimeRoot, `${prefix}.stdin`);
  const stdout = path.join(runtimeRoot, `${prefix}.stdout`);
  const stderr = path.join(runtimeRoot, `${prefix}.stderr`);
  const cwdFile = path.join(runtimeRoot, `${prefix}.cwd`);
  fs.writeFileSync(stdin, '');
  const runner = path.join(__dirname, 'lazybuddy-bounded-run.py');
  const result = spawnSync(process.env.LAZYBUDDY_PYTHON || 'python3', [runner,
    '--label', spec.invocationId, '--timeout', String(options.timeout), '--result-file', resultFile,
    '--cwd', options.target, '--cwd-file', cwdFile, '--stdin-file', stdin,
    '--stdout-file', stdout, '--stderr-file', stderr, '--', ...command], {
    cwd: options.target, encoding: 'utf8', timeout: (options.timeout + 10) * 1000,
  });
  if (!fs.existsSync(resultFile)) {
    fail(`bounded runner did not write ${spec.invocationId}: exit=${result.status} ${result.stderr.trim()}`);
  }
  const bounded = readJson(resultFile, `bounded result for ${spec.invocationId}`);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    ...spec,
    outcome: bounded.status === 'pass' && result.status === 0 ? 'passed' : 'failed',
    exitCode: Number.isInteger(result.status) ? result.status : 125,
    reason: bounded.reason,
    cleanup: bounded.cleanup,
    elapsed_ms: Math.max(0, Math.floor(elapsedMs)),
  };
}

function writeReport(reportPath, report) {
  const directory = path.dirname(reportPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(reportPath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(report)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, reportPath);
}

function main() {
  const started = process.hrtime.bigint();
  const options = parseArgs(process.argv.slice(2));
  options.target = safeDirectory(options.target);
  const commands = parseCommands(readJson(options['gate-config'], 'gate config'));
  const rawInput = readJson(options.input, 'risk input');
  const input = rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? { ...rawInput, dirtyTree: rawInput.dirtyTree === true || gitDirty(options.target) }
    : rawInput;
  const selected = selectVerificationPolicy(input);
  let level = selected.level;
  const reasonCodes = [...selected.reasonCodes];
  let pending = specifications(level);
  const results = [];
  const completed = new Set();
  const runtimeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-risk-run-')));
  try {
    while (pending.length > 0) {
      const spec = pending.shift();
      if (completed.has(spec.invocationId)) continue;
      const outcome = executeGate(options, commands[spec.gateId], spec, runtimeRoot);
      results.push(outcome);
      completed.add(spec.invocationId);
      if (outcome.outcome === 'failed' && level !== 'comprehensive') {
        level = 'comprehensive';
        reasonCodes.push('runtime-gate-failure');
        pending = specifications(level);
      }
    }
    const allPassed = results.every(({ outcome }) => outcome === 'passed');
    const actorCount = new Set(results.map(({ actorId }) => actorId)).size;
    const count = (gateIds) => results.filter(({ gateId }) => gateIds.includes(gateId)).length;
    const report = {
      schemaVersion: 1, level, reasonCodes: [...new Set(reasonCodes)], actorCount,
      allPassed, gateResults: results,
      elapsed_ms: Math.max(
        results.reduce((sum, gate) => sum + gate.elapsed_ms, 0),
        Math.floor(Number(process.hrtime.bigint() - started) / 1_000_000),
      ),
      actualCost: {
        gateInvocations: results.length, actorCount,
        targetedInvocations: count(['targeted-tests']),
        dependencyContractInvocations: count(['dependency-tests', 'contract-tests']),
        fullSuiteInvocations: count(['paired-full-suites']),
      },
    };
    writeReport(options.report, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return allPassed ? 0 : 1;
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

process.exitCode = main();
