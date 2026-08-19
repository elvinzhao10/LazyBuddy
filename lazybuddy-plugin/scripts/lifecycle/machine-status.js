'use strict';

const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');
const { validateMarketplaceRoutes } = require('./marketplace-routes');
const { CURRENT_VERSION, MACHINE_STATUS_CONTRACT_VERSION } = require('./version');

const CONTRACT_REF = 'contracts/marketplace-route-contract.v1.json';
const CONTRACT_CHECKSUM = path.resolve(__dirname, '..', '..', `${CONTRACT_REF}.sha256`);
const HOST_DEFINITIONS = Object.freeze([
  Object.freeze(['codebuddy-cli', 'codebuddy-marketplace', 'invoke-documented', 'documented-tested']),
  Object.freeze(['codebuddy-ide', 'codebuddy-marketplace', 'invoke-documented', 'documented-tested']),
  Object.freeze(['workbuddy', 'workbuddy-full-plugin', 'observe-only', 'observed-build-specific']),
]);
const ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze(['codebuddy-marketplace', ['codebuddy-cli', 'codebuddy-ide'], 'default', false, true, 'invoke-documented', 'documented-tested']),
  Object.freeze(['workbuddy-full-plugin', ['workbuddy'], 'default', false, true, 'observe-only', 'observed-build-specific']),
  Object.freeze(['manual-skills-mcp-fallback', ['codebuddy-ide', 'workbuddy'], 'recovery-only', true, false, 'invoke-documented', 'documented-untested']),
]);

function fail() {
  throw new LifecycleError('MACHINE_STATUS_INVALID', 'machine status does not match the v2 contract');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail();
}

function evidence(digest) {
  return { scope: 'package', ref: CONTRACT_REF, sha256: digest, session_id: null };
}

function contractDigest() {
  const digest = safeFile(CONTRACT_CHECKSUM, 'MACHINE_STATUS_INVALID').bytes.toString('utf8').trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(digest)) fail();
  return digest;
}

function buildMachineStatus(releaseRoot) {
  const marketplace = validateMarketplaceRoutes(releaseRoot);
  if (marketplace.version !== CURRENT_VERSION) fail();
  const digest = contractDigest();
  const report = {
    schema_version: 2,
    contract_version: MACHINE_STATUS_CONTRACT_VERSION,
    product: 'LazyBuddy',
    version: CURRENT_VERSION,
    status: 'ready',
    package_readiness: { status: 'ready', scope: 'package' },
    host_readiness: { status: 'pending' },
    hosts: HOST_DEFINITIONS.map(([host, route, nativeMode, publicLabel]) => ({
      host,
      route,
      native_mode: nativeMode,
      public_label: publicLabel,
      package_status: 'ready',
      probe_status: 'not-run',
      readiness_scope: 'package',
      host_readiness: 'pending',
      evidence: evidence(digest),
    })),
    routes: ROUTE_DEFINITIONS.map(([route, hosts, routeRole, recoveryOnly, coexistsWithDefault, nativeMode, publicLabel]) => ({
      route,
      hosts,
      route_role: routeRole,
      recovery_only: recoveryOnly,
      coexists_with_default: coexistsWithDefault,
      native_mode: nativeMode,
      public_label: publicLabel,
      evidence: evidence(digest),
    })),
  };
  validateMachineStatus(report);
  return report;
}

function validateEvidence(value, digest) {
  exactKeys(value, ['scope', 'ref', 'sha256', 'session_id']);
  if (value.scope !== 'package' || value.ref !== CONTRACT_REF || value.sha256 !== digest || value.session_id !== null) fail();
}

function validateMachineStatus(value) {
  exactKeys(value, ['schema_version', 'contract_version', 'product', 'version', 'status', 'package_readiness', 'host_readiness', 'hosts', 'routes']);
  if (value.schema_version !== 2 || value.contract_version !== MACHINE_STATUS_CONTRACT_VERSION
    || value.product !== 'LazyBuddy' || value.version !== CURRENT_VERSION || value.status !== 'ready') fail();
  exactKeys(value.package_readiness, ['status', 'scope']);
  exactKeys(value.host_readiness, ['status']);
  if (value.package_readiness.status !== 'ready' || value.package_readiness.scope !== 'package'
    || value.host_readiness.status !== 'pending') fail();
  if (!Array.isArray(value.hosts) || value.hosts.length !== HOST_DEFINITIONS.length
    || !Array.isArray(value.routes) || value.routes.length !== ROUTE_DEFINITIONS.length) fail();
  const digest = contractDigest();
  value.hosts.forEach((row, index) => {
    exactKeys(row, ['host', 'route', 'native_mode', 'public_label', 'package_status', 'probe_status', 'readiness_scope', 'host_readiness', 'evidence']);
    const expected = HOST_DEFINITIONS[index];
    if (JSON.stringify([row.host, row.route, row.native_mode, row.public_label]) !== JSON.stringify(expected)
      || row.package_status !== 'ready' || row.probe_status !== 'not-run'
      || row.readiness_scope !== 'package' || row.host_readiness !== 'pending') fail();
    validateEvidence(row.evidence, digest);
  });
  value.routes.forEach((route, index) => {
    exactKeys(route, ['route', 'hosts', 'route_role', 'recovery_only', 'coexists_with_default', 'native_mode', 'public_label', 'evidence']);
    const expected = ROUTE_DEFINITIONS[index];
    if (JSON.stringify([route.route, route.hosts, route.route_role, route.recovery_only,
      route.coexists_with_default, route.native_mode, route.public_label]) !== JSON.stringify(expected)) fail();
    validateEvidence(route.evidence, digest);
  });
  return value;
}

module.exports = { buildMachineStatus, validateMachineStatus };
