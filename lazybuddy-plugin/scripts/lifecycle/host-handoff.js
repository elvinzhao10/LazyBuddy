'use strict';

const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');
const {
  MCP_SERVERS,
  receiptTemplates,
  validateReceiptPath,
  validateWorkbuddyReceipt,
} = require('./workbuddy-receipt');
const {
  defaultRouteForHost,
  fallbackPolicy,
  validateMarketplaceRoutes,
} = require('./marketplace-routes');

const CONNECTORS = MCP_SERVERS;
const ROUTES = Object.freeze({
  'codebuddy-marketplace': 'codebuddy',
  'workbuddy-full-plugin': 'workbuddy',
  'manual-skills-mcp-fallback': 'workbuddy',
});
const OBSERVATION_KEYS = ['artifact', 'host', 'observed_at', 'type'];

function routeSelection(routes) {
  const selected = [...new Set(routes)].sort();
  const hasFull = selected.includes('workbuddy-full-plugin') || selected.includes('codebuddy-marketplace');
  const hasFallback = selected.includes('manual-skills-mcp-fallback');
  if (hasFull && hasFallback) {
    return {
      kind: 'conflict',
      routes: selected,
      nextAction: 'Use the host UI to remove the prior LazyBuddy route, start a fresh session, then select exactly one route.',
    };
  }
  if (selected.length === 0) return { kind: 'none' };
  if (selected.length !== 1) throw new LifecycleError('ROUTE_SELECTION_AMBIGUOUS', 'select exactly one host route');
  return { kind: 'route', route: selected[0], host: ROUTES[selected[0]] };
}

function parseObservation(receiptPath, host, context = {}) {
  if (receiptPath === undefined) return { status: 'pending' };
  try {
    validateReceiptPath(receiptPath);
  } catch (error) {
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', error.message, error);
  }
  if (host === 'workbuddy') {
    if (context.route !== 'workbuddy-full-plugin') {
      throw new LifecycleError('WORKBUDDY_RECEIPT_INVALID', 'full-plugin receipt cannot validate a fallback route');
    }
    if (!context.releaseRoot || !context.manifestSha256 || !context.build || !context.session) {
      throw new LifecycleError('WORKBUDDY_RECEIPT_INVALID', 'current WorkBuddy build and session are required');
    }
    return validateWorkbuddyReceipt(receiptPath, {
      ...context,
      now: context.now || new Date(),
    });
  }
  const now = context instanceof Date ? context : context.now || new Date();
  let receipt;
  try {
    receipt = JSON.parse(safeFile(receiptPath, 'OBSERVATION_RECEIPT_INVALID').bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', 'observation receipt must be valid JSON', error);
  }
  const observedAt = new Date(receipt?.observed_at);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(OBSERVATION_KEYS)
    || receipt.type !== 'host-observation' || receipt.host !== host
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(receipt.observed_at)
    || Number.isNaN(observedAt.getTime())
    || !/^[A-Za-z0-9._:-]+$/.test(receipt.artifact)) {
    throw new LifecycleError('OBSERVATION_RECEIPT_INVALID', 'observation receipt does not match the selected host');
  }
  const currentDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (observedAt < currentDay || observedAt > now) return { status: 'pending' };
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

function renderHandoff(route, releaseRoot, projectRoot, marketplace = null) {
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
    const templates = receiptTemplates(releaseRoot, marketplace.workbuddy.manifest_sha256);
    return {
      ...base,
      route_priority: { rank: 1, fallback_rank: 2 },
      expected_artifacts: {
        route: 'workbuddy-marketplace',
        manifest: path.join(releaseRoot, 'lazybuddy-plugin', '.workbuddy-plugin', 'plugin.json'),
        plugin: 'lazybuddy',
        version: '1.0.3',
      },
      preflight: { status: 'package-ready', full_plugin: 'user-observed-only' },
      receipt_templates: templates,
      next_action: { kind: 'gui', instruction: 'Open Skills → Plugins and inspect LazyBuddy in the current WorkBuddy session.' },
    };
  }
  return {
    ...base,
    route_priority: { rank: 2, recovery_only: true },
    expected_artifacts: { skills: path.join(releaseRoot, 'lazybuddy-plugin', 'skills') },
    recovery: fallbackPolicy(),
    degraded: { status: 'manual-skills-mcp-fallback', excludes: ['commands', 'agents', 'hooks'] },
    manual_mcp: { connectors: CONNECTORS.map((name) => connector(name, releaseRoot, projectRoot)) },
    next_action: { kind: 'gui', instruction: 'Open Skills and import the LazyBuddy skills directory.' },
  };
}

module.exports = {
  defaultRouteForHost,
  parseObservation,
  renderHandoff,
  routeSelection,
  validateMarketplaceRoutes,
};
