'use strict';

const { LifecycleError } = require('./errors');

const COMMANDS = new Set(['onboard', 'update', 'status', 'offboard']);
const VALUE_FLAGS = new Set(['--install-root', '--project', '--source', '--confirm-revision', '--observation-receipt']);
const BOOLEAN_FLAGS = new Set(['--json', '--yes']);
const ROUTE_FLAG = '--route';

function usage() {
  return `LazyBuddy durable lifecycle v1.0.3

Usage: node scripts/lazybuddy-lifecycle.js <command> [options]

Commands:
  onboard   Verify and install an official LazyBuddy release
  update    Verify and promote an official LazyBuddy revision
  status    Inspect durable package and host-readiness state
  offboard  Plan or remove exact receipt-owned LazyBuddy state

Common options:
  --install-root <absolute-path>
  --project <absolute-path>
  --json

Status options:
  --route <codebuddy-marketplace|workbuddy-full-plugin|manual-skills-mcp-fallback>
  --observation-receipt <absolute-path>

Onboard/update options:
  --source <canonical-official-url>
  --confirm-revision <full-sha>

Offboard option:
  --yes
`;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const command = argv[0];
  if (!COMMANDS.has(command)) throw new LifecycleError('INVALID_COMMAND', `unknown lifecycle command: ${command}`);
  const options = { command, json: false, routes: [], yes: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      const key = flag.slice(2);
      if (options[key]) throw new LifecycleError('INVALID_ARGUMENT', `${flag} may be provided only once`);
      options[key] = true;
      continue;
    }
    if (flag === ROUTE_FLAG) {
      const route = argv[index + 1];
      if (!route || route.startsWith('--')) throw new LifecycleError('INVALID_ARGUMENT', '--route requires a value');
      if (!['codebuddy-marketplace', 'workbuddy-full-plugin', 'manual-skills-mcp-fallback'].includes(route)) {
        throw new LifecycleError('INVALID_ARGUMENT', `unsupported host route: ${route}`);
      }
      if (options.routes.includes(route)) throw new LifecycleError('INVALID_ARGUMENT', '--route may not repeat a route');
      options.routes.push(route);
      index += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new LifecycleError('INVALID_ARGUMENT', `unknown option: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new LifecycleError('INVALID_ARGUMENT', `${flag} requires a value`);
    const key = flag.slice(2).replace('-revision', 'Revision').replace('-receipt', 'Receipt').replace('-root', 'Root');
    if (options[key] !== undefined) throw new LifecycleError('INVALID_ARGUMENT', `${flag} may be provided only once`);
    options[key] = value;
    index += 1;
  }
  if ((options.source || options.confirmRevision) && !['onboard', 'update'].includes(command)) {
    throw new LifecycleError('INVALID_ARGUMENT', '--source and --confirm-revision apply only to onboard or update');
  }
  if (options.project === undefined) {
    throw new LifecycleError('INVALID_ARGUMENT', '--project is required');
  }
  if (options.confirmRevision && command !== 'update') {
    throw new LifecycleError('INVALID_ARGUMENT', '--confirm-revision applies only to update');
  }
  if ((options.routes.length > 0 || options.observationReceipt) && command !== 'status') {
    throw new LifecycleError('INVALID_ARGUMENT', '--route and --observation-receipt apply only to status');
  }
  if (options.observationReceipt && options.routes.length === 0) {
    throw new LifecycleError('INVALID_ARGUMENT', '--observation-receipt requires one selected --route');
  }
  if (options.yes && command !== 'offboard') {
    throw new LifecycleError('INVALID_ARGUMENT', '--yes applies only to offboard');
  }
  if (['onboard', 'update'].includes(command) && !options.source) {
    throw new LifecycleError('INVALID_ARGUMENT', '--source is required for onboard and update');
  }
  return options;
}

module.exports = { parseArgs, usage };
