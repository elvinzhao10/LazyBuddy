'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TERMINAL_RUNS = new Set(['complete', 'failed', 'cancelled']);
const UNSAFE_ARGV = new Set([';', '&&', '||', '|', '>', '>>', '<', '<<']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);
const NON_DISPATCHABLE = new Set(['rm', 'sudo', 'curl', 'wget', 'ssh', 'scp', 'open', 'osascript']);
const MUTATING_GIT = new Set(['push', 'reset', 'clean', 'checkout', 'restore', 'commit', 'rebase', 'merge', 'tag']);
const MUTATING_PACKAGES = new Set(['install', 'ci', 'publish', 'uninstall', 'update']);
const GIT_OPTIONS_WITH_VALUES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const INTERPRETER_EVAL = new Map([
  ['node', new Set(['-e', '--eval', '-p', '--print'])],
  ['node.exe', new Set(['-e', '--eval', '-p', '--print'])],
  ['python', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['python.exe', new Set(['-c'])],
  ['ruby', new Set(['-e'])],
  ['perl', new Set(['-e'])],
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function below(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function requireDirectory(root, target, label, owner) {
  if (!below(root, target)) throw new Error(`${label} escapes project root`);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory`);
    if (Number.isInteger(owner) && Number.isInteger(stat.uid) && stat.uid !== owner) {
      throw new Error(`${label} must retain project ownership`);
    }
  }
}

function readAuthorityFile(root, target, label, owner) {
  if (!below(root, target)) throw new Error(`${label} escapes project root`);
  requireDirectory(root, path.dirname(target), `${label} parent`, owner);
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (before.nlink !== 1) throw new Error(`${label} must not have multiple links`);
  if (Number.isInteger(owner) && Number.isInteger(before.uid) && before.uid !== owner) {
    throw new Error(`${label} must retain project ownership`);
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const handle = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(handle);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`${label} identity changed or has multiple links`);
    }
    if (Number.isInteger(owner) && Number.isInteger(opened.uid) && opened.uid !== owner) {
      throw new Error(`${label} must retain project ownership`);
    }
    if (!below(root, fs.realpathSync(target))) throw new Error(`${label} escapes project root`);
    return fs.readFileSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function currentRun(root, owner) {
  const runs = path.join(root, '.lazybuddy', 'runs');
  if (!fs.existsSync(runs)) throw new Error('current run execution authority is missing');
  requireDirectory(root, runs, 'run ledger', owner);
  const active = [];
  for (const entry of fs.readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const statePath = path.join(runs, entry.name, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    const state = parseJson(readAuthorityFile(root, statePath, 'current run state', owner), 'current run state');
    if (!TERMINAL_RUNS.has(state.status)) active.push({ entry: entry.name, state });
  }
  if (active.length === 0) throw new Error('current run execution authority is missing');
  active.sort((left, right) => String(right.state.updated_at || '').localeCompare(String(left.state.updated_at || '')));
  return active[0];
}

function resolveExecutionContext(options, record) {
  if (!options.projectRoot) throw new Error('execution: --project-root is required');
  if (!options.planCommandsFile) throw new Error('execution: trusted plan commands file (--plan-commands-file) is required');
  const root = fs.realpathSync(options.projectRoot);
  const rootStat = fs.statSync(root);
  const owner = Number.isInteger(rootStat.uid) ? rootStat.uid : undefined;
  const current = currentRun(root, owner);
  if (current.entry !== current.state.run_id || current.state.run_id !== record.task.run_id) {
    throw new Error('record task does not match the current run execution authority');
  }
  const running = Array.isArray(current.state.tasks)
    ? current.state.tasks.filter((task) => task && task.status === 'running') : [];
  if (running.length !== 1 || running[0].id !== record.task.task_id) {
    throw new Error('record task does not match the current running task execution authority');
  }
  const authority = running[0].execution_authority;
  if (!authority || authority.repo_head !== record.task.repo_head
    || JSON.stringify(authority.criterion_ids) !== JSON.stringify(record.task.criterion_ids)
    || authority.plan_reference !== current.state.plan_reference) {
    throw new Error('record identity does not match current task execution authority');
  }
  const plan = path.resolve(root, authority.plan_reference || '');
  if (!below(path.join(root, '.lazybuddy'), plan)) throw new Error('current plan authority must stay under .lazybuddy');
  const planBytes = readAuthorityFile(root, plan, 'current plan authority', owner);
  if (sha256(planBytes) !== authority.plan_sha256) throw new Error('current plan authority digest mismatch');
  const commands = path.resolve(root, authority.plan_commands_path || '');
  if (!below(path.join(root, '.lazybuddy', 'runs', current.entry), commands)) {
    throw new Error('plan commands authority must stay under the current run');
  }
  const originalRoot = path.resolve(options.projectRoot);
  const hinted = path.resolve(root, path.relative(originalRoot, path.resolve(originalRoot, options.planCommandsFile)));
  if (hinted !== commands) throw new Error('plan commands hint does not match current task execution authority');
  const commandBytes = readAuthorityFile(root, commands, 'plan commands authority', owner);
  if (sha256(commandBytes) !== authority.plan_commands_sha256) throw new Error('plan commands authority digest mismatch');
  const planCommands = parseJson(commandBytes, 'plan commands authority');
  if (!Array.isArray(planCommands) || planCommands.length === 0 || planCommands.length > 64
    || planCommands.some((argv) => !Array.isArray(argv) || argv.length === 0 || argv.length > 128
      || argv.some((part) => typeof part !== 'string' || part.length === 0 || part.length > 1024))) {
    throw new Error('plan commands authority must contain bounded argv arrays');
  }
  return { ...options, planCommands, planSha256: authority.plan_sha256 };
}

function gitSubcommand(argv) {
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const option = token.split('=', 1)[0];
    if (GIT_OPTIONS_WITH_VALUES.has(option)) {
      if (!token.includes('=')) index += 1;
    } else if (!token.startsWith('-')) return token.toLowerCase();
  }
  return '';
}

function commandErrors(commands) {
  const errors = [];
  for (const command of commands) {
    const executable = path.basename(command.argv[0]).toLowerCase();
    const subcommand = (command.argv[1] || '').toLowerCase();
    const evaluatesCode = command.argv.slice(1).some((part) => {
      const flag = part.toLowerCase();
      return (SHELLS.has(executable) && ['-c', '/c', '-command'].includes(flag))
        || (INTERPRETER_EVAL.get(executable)?.has(flag) ?? false);
    });
    if (evaluatesCode || command.argv.some((part) => UNSAFE_ARGV.has(part) || /[\r\n]/.test(part))) {
      errors.push('command_validation.commands.argv: unsafe shell token');
    }
    const packageMutation = ['npm', 'npm.cmd', 'pnpm', 'yarn'].includes(executable)
      && MUTATING_PACKAGES.has(subcommand);
    const hostMutation = executable === 'codebuddy' && command.argv.includes('plugin')
      && command.argv.some((part) => ['add', 'install', 'uninstall', 'remove'].includes(part.toLowerCase()));
    if (NON_DISPATCHABLE.has(executable)
      || (executable === 'git' && MUTATING_GIT.has(gitSubcommand(command.argv)))
      || packageMutation || hostMutation) {
      errors.push('command_validation.commands.argv: mutation, remote access, or approval required');
    }
  }
  return errors;
}

module.exports = { commandErrors, resolveExecutionContext };
