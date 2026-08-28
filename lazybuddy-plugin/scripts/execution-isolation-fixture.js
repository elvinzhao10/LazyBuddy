#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { acquire, release, renew } = require('./execution-isolation');

function value(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) throw new Error(`${flag} is required.`);
  return args[index + 1];
}

function main(args) {
  const root = path.resolve(value(args, '--root'));
  const taskId = value(args, '--task');
  const session = value(args, '--session');
  const started = Date.now();
  const ownerPid = process.pid;
  const request = {
    taskId,
    session,
    ownerPid,
    workspace: process.cwd(),
    direct: !args.includes('--orchestrated'),
    mutationRequiresWorktree: args.includes('--mutation-worktree'),
  };
  const acquired = acquire(root, request, { now: () => started });
  const renewed = renew(root, taskId, { session, ownerPid }, {
    now: () => started + (11 * 60_000),
    isPidAlive: () => true,
  });
  const leaseFile = path.join(renewed.namespace.root, 'lease.json');
  const portFile = path.join(root, renewed.product, 'ports', `${renewed.namespace.port}.json`);
  const beforeCleanup = {
    lease_file_exists: fs.existsSync(leaseFile),
    port_file_exists: fs.existsSync(portFile),
    worktree_exists: fs.existsSync(renewed.namespace.paths.worktree),
  };
  release(root, taskId, { session, ownerPid });
  process.stdout.write(`${JSON.stringify({ acquired, renewed, before_cleanup: beforeCleanup, cleanup: {
    namespace_removed: !fs.existsSync(renewed.namespace.root),
    port_released: !fs.existsSync(portFile),
  } }, null, 2)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
