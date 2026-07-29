'use strict';

const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');

const CONNECTORS = Object.freeze([
  'run-ledger',
  'verification',
  'status-dashboard',
  'context-graph',
  'code-intel',
  'docs',
]);
const ROUTES = Object.freeze({
  'codebuddy-marketplace': 'codebuddy',
  'workbuddy-full-plugin': 'workbuddy',
  'manual-skills-mcp-fallback': 'workbuddy',
});
const OBSERVATION_KEYS = ['artifact', 'host', 'observed_at', 'type'];

function routeSelection(routes) {
  const selected = [...new Set(routes)].sort();
  const hasFull = selected.includes('workbuddy-full-plugin');
  const hasFallback = selected.includes('manual-skills-mcp-fallback');
  if (hasFull && hasFallback) {
    return {
      kind: 'conflict',
      routes: ['manual-skills-mcp-fallback', 'workbuddy-full-plugin'],
      nextAction: 'Use the host UI to remove the prior LazyBuddy route, start a fresh session, then select exactly one route.',
    };
  }
  if (selected.length === 0) return { kind: 'none' };
  if (selected.length !== 1) throw new LifecycleError('ROUTE_SELECTION_AMBIGUOUS', 'select exactly one host route');
  return { kind: 'route', route: selected[0], host: ROUTES[selected[0]] };
}

function parseObservation(receiptPath, host) {
  if (receiptPath === undefined) return { status: 'pending' };
  if (!path.isAbsolute(receiptPath) || path.parse(path.resolve(receiptPath)).root === path.resolve(receiptPath)
    || /(?:^|[\\/])\.workbuddy(?:[\\/]|$)/.test(receiptPath)) {
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', 'observation receipt must be an explicit non-host-private file');
  }
  let receipt;
  try {
    receipt = JSON.parse(safeFile(receiptPath, 'OBSERVATION_RECEIPT_INVALID').bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', 'observation receipt must be valid JSON', error);
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(OBSERVATION_KEYS)
    || receipt.type !== 'host-observation' || receipt.host !== host
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(receipt.observed_at)
    || !/^[A-Za-z0-9._:-]+$/.test(receipt.artifact)) {
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', 'observation receipt does not match the selected host');
  }
  return { status: 'observed', observation_receipt: receipt };
}

function connector(name, releaseRoot, projectRoot) {
  return {
    name,
    command: 'bash',
    args: [path.join(releaseRoot, 'lazybuddy-plugin', 'mcp', name, 'server.sh')],
    cwd: projectRoot,
    env: { CWD: projectRoot, CODEBUDDY_PROJECT_DIR: projectRoot },
  };
}

function renderHandoff(route, releaseRoot, projectRoot) {
  const base = { namespace: 'lazybuddy', route, host: ROUTES[route], host_mutation: 'none' };
  if (route === 'codebuddy-marketplace') {
    return {
      ...base,
      expected_artifacts: {
        marketplace: path.join(releaseRoot, '.codebuddy-plugin', 'marketplace.json'),
        plugin: 'lazybuddy@lazybuddy',
        version: '1.0.3',
      },
      degraded: { status: 'none' },
      next_action: { kind: 'host-command', command: `codebuddy plugin marketplace add ${releaseRoot}` },
    };
  }
  if (route === 'workbuddy-full-plugin') {
    return {
      ...base,
      expected_artifacts: { plugin: 'already-host-installed', version: '1.0.3' },
      preflight: { status: 'package-ready', full_plugin: 'user-observed-only' },
      next_action: { kind: 'gui', instruction: 'Open Skills → Plugins and inspect LazyBuddy in the current WorkBuddy session.' },
    };
  }
  return {
    ...base,
    expected_artifacts: { skills: path.join(releaseRoot, 'lazybuddy-plugin', 'skills') },
    degraded: { status: 'manual-skills-mcp-fallback', excludes: ['commands', 'agents', 'hooks'] },
    manual_mcp: { connectors: CONNECTORS.map((name) => connector(name, releaseRoot, projectRoot)) },
    next_action: { kind: 'gui', instruction: 'Open Skills and import the LazyBuddy skills directory.' },
  };
}

module.exports = { parseObservation, renderHandoff, routeSelection };
