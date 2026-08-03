'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { atomicJson, readJson, safeFile } = require('./files');
const { validateMarketplaceRoutes } = require('./marketplace-routes');

const SURFACES = Object.freeze([
  'automation-status',
  'plan-design-todo',
  'plan-files',
  'primary-root-branch',
  'queue-parallel-status',
  'skill-management',
  'task-continuation',
  'workspace-grouped-tasks',
]);
const TASK_STATUSES = Object.freeze(['blocked', 'cancelled', 'completed', 'failed', 'queued', 'running']);
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function fail(code, message, cause) {
  throw new LifecycleError(code, message, cause);
}

function exact(value, keys, name) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail('NATIVE_OBSERVATION_INVALID', `${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('NATIVE_OBSERVATION_INVALID', `${name} fields are invalid`);
}

function timestamp(value, name) {
  const parts = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  const parsed = parts === null ? Number.NaN : Date.parse(value);
  const date = new Date(parsed);
  if (parts === null || Number.isNaN(parsed)
    || date.getUTCFullYear() !== Number(parts[1]) || date.getUTCMonth() + 1 !== Number(parts[2])
    || date.getUTCDate() !== Number(parts[3]) || date.getUTCHours() !== Number(parts[4])
    || date.getUTCMinutes() !== Number(parts[5]) || date.getUTCSeconds() !== Number(parts[6])) {
    fail('NATIVE_OBSERVATION_INVALID', `${name} is invalid`);
  }
}

function realDirectory(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.parse(path.resolve(value)).root === path.resolve(value)) {
    fail('PRIMARY_ROOT_INVALID', `${name} must be a non-root absolute directory`);
  }
  let stat;
  try {
    stat = fs.lstatSync(value);
  } catch (error) {
    fail('PRIMARY_ROOT_INVALID', `${name} is unavailable`, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PRIMARY_ROOT_INVALID', `${name} must be a real directory`);
  return fs.realpathSync(value);
}

function workspaceFor(roots, primaryRoot, branch) {
  if (!Array.isArray(roots) || roots.length === 0) fail('PRIMARY_ROOT_REQUIRED', 'at least one project root is required');
  const resolved = roots.map((root) => realDirectory(root, 'project root'));
  if (new Set(resolved).size !== resolved.length) fail('PRIMARY_ROOT_INVALID', 'project roots must be unique');
  if (resolved.length > 1 && primaryRoot === undefined) fail('PRIMARY_ROOT_REQUIRED', 'multiple project roots require --primary-root');
  const primary = realDirectory(primaryRoot === undefined ? resolved[0] : primaryRoot, 'primary root');
  if (!resolved.includes(primary)) fail('PRIMARY_ROOT_INVALID', 'primary root must be one of the project roots');
  if (typeof branch !== 'string' || !BRANCH.test(branch) || branch.includes('..') || branch.includes('//')) {
    fail('PRIMARY_ROOT_INVALID', 'branch is invalid');
  }
  return { roots: resolved, primary_root: primary, branch };
}

function marketplaceIdentity(marketplaceFile) {
  if (typeof marketplaceFile !== 'string' || !path.isAbsolute(marketplaceFile)
    || path.basename(path.dirname(marketplaceFile)) !== '.codebuddy-plugin'
    || path.basename(marketplaceFile) !== 'marketplace.json') {
    fail('MARKETPLACE_IDENTITY_INVALID', '--marketplace must be an absolute release-root marketplace.json');
  }
  const releaseRoot = path.dirname(path.dirname(marketplaceFile));
  const routes = validateMarketplaceRoutes(releaseRoot);
  const marketplace = readJson(marketplaceFile, 'MARKETPLACE_IDENTITY_INVALID');
  return {
    name: marketplace.name,
    plugin: routes.codebuddy.plugin,
    version: routes.version,
    installation_scope: 'user',
    release_root: fs.realpathSync(releaseRoot),
    fingerprint: crypto.createHash('sha256').update(safeFile(marketplaceFile, 'MARKETPLACE_IDENTITY_INVALID').bytes).digest('hex'),
  };
}

function writeOutput(target, value) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) fail('OUTPUT_INVALID', '--output must be an absolute path');
  const parent = path.dirname(target);
  realDirectory(parent, 'output directory');
  atomicJson(parent, target, value);
}

function createTemplate(options) {
  timestamp(options.generatedAt, 'generated_at');
  const workspace = workspaceFor(options.projectRoots, options.primaryRoot, options.branch);
  const marketplace = marketplaceIdentity(options.marketplace);
  const template = {
    schema_version: 1,
    record_type: 'codebuddy-ide-native-template',
    template_id: 'pending:codebuddy-ide-native-surfaces',
    host: 'codebuddy-ide',
    status: 'pending',
    generated_at: options.generatedAt,
    installation_route: 'codebuddy-marketplace',
    marketplace,
    workspace,
    surfaces: SURFACES.map(surface_id => ({ surface_id, status: 'pending', host_authority: 'host' })),
    host_readiness: { status: 'pending' },
    promotion: 'prohibited',
  };
  writeOutput(options.output, template);
  return template;
}

function validateMarketplace(value, expected) {
  exact(value, ['fingerprint', 'installation_scope', 'name', 'plugin', 'release_root', 'version'], 'marketplace');
  if (Object.keys(expected).some(key => value[key] !== expected[key])) fail('MARKETPLACE_STALE', 'observed marketplace identity is stale');
}

function validateWorkspace(value, expected) {
  exact(value, ['branch', 'primary_root', 'roots'], 'workspace');
  if (!Array.isArray(value.roots) || value.primary_root !== expected.primary_root || value.branch !== expected.branch
    || value.roots.length !== expected.roots.length || value.roots.some((root, index) => root !== expected.roots[index])) {
    fail('PRIMARY_ROOT_MISMATCH', 'observed primary root, roots, or branch changed');
  }
}

function validateSurfaces(values) {
  if (!Array.isArray(values) || values.length !== SURFACES.length) fail('NATIVE_OBSERVATION_INVALID', 'all native surfaces are required');
  const ids = values.map((value, index) => {
    exact(value, ['status', 'surface_id', 'value_digest'], `surfaces[${index}]`);
    if (!SURFACES.includes(value.surface_id)) fail('NATIVE_OBSERVATION_INVALID', 'surface is unsupported');
    if (!['observed', 'unsupported'].includes(value.status)) fail('NATIVE_OBSERVATION_INVALID', 'surface status is unsupported');
    if (typeof value.value_digest !== 'string' || !SHA256.test(value.value_digest)) fail('NATIVE_OBSERVATION_INVALID', 'surface digest is invalid');
    return value.surface_id;
  });
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_MIRROR', 'native surface mirrors must be unique');
  if (SURFACES.some(surface => !ids.includes(surface))) fail('NATIVE_OBSERVATION_INVALID', 'all native surfaces are required');
}

function validateTasks(values) {
  if (!Array.isArray(values)) fail('NATIVE_OBSERVATION_INVALID', 'tasks must be an array');
  const ids = values.map((value, index) => {
    exact(value, ['group_id', 'status', 'task_id', 'value_digest'], `tasks[${index}]`);
    if (!ID.test(value.task_id) || !ID.test(value.group_id)) fail('NATIVE_OBSERVATION_INVALID', 'task identity is invalid');
    if (!TASK_STATUSES.includes(value.status)) fail('UNKNOWN_TASK_STATUS', 'task status is unsupported');
    if (typeof value.value_digest !== 'string' || !SHA256.test(value.value_digest)) fail('NATIVE_OBSERVATION_INVALID', 'task digest is invalid');
    return value.task_id;
  });
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_MIRROR', 'task mirrors must be unique');
}

function ingestObservation(options) {
  timestamp(options.now, 'now');
  const template = readJson(options.template, 'NATIVE_TEMPLATE_INVALID');
  exact(template, ['generated_at', 'host', 'host_readiness', 'installation_route', 'marketplace', 'promotion', 'record_type', 'schema_version', 'status', 'surfaces', 'template_id', 'workspace'], 'template');
  if (template.schema_version !== 1 || template.record_type !== 'codebuddy-ide-native-template'
    || template.host !== 'codebuddy-ide' || template.status !== 'pending'
    || template.installation_route !== 'codebuddy-marketplace' || template.promotion !== 'prohibited'
    || JSON.stringify(template.host_readiness) !== JSON.stringify({ status: 'pending' })) {
    fail('NATIVE_TEMPLATE_INVALID', 'template cannot establish host readiness');
  }
  const currentMarketplace = marketplaceIdentity(path.join(template.marketplace.release_root, '.codebuddy-plugin', 'marketplace.json'));
  validateMarketplace(template.marketplace, currentMarketplace);
  const observation = readJson(options.observation, 'NATIVE_OBSERVATION_INVALID');
  exact(observation, ['expires_at', 'marketplace', 'observation_id', 'observed_at', 'record_type', 'schema_version', 'session_id', 'surfaces', 'tasks', 'workspace'], 'observation');
  if (observation.schema_version !== 1 || observation.record_type !== 'codebuddy-ide-native-observation'
    || !ID.test(observation.observation_id) || !ID.test(observation.session_id)) {
    fail('NATIVE_OBSERVATION_INVALID', 'observation identity is invalid');
  }
  timestamp(observation.observed_at, 'observed_at');
  timestamp(observation.expires_at, 'expires_at');
  if (Date.parse(observation.observed_at) > Date.parse(options.now)
    || Date.parse(observation.expires_at) <= Date.parse(options.now)
    || Date.parse(observation.expires_at) <= Date.parse(observation.observed_at)) {
    fail('NATIVE_OBSERVATION_STALE', 'observation freshness is stale');
  }
  validateMarketplace(observation.marketplace, template.marketplace);
  validateWorkspace(observation.workspace, template.workspace);
  validateSurfaces(observation.surfaces);
  validateTasks(observation.tasks);
  const record = {
    schema_version: 1,
    record_type: 'codebuddy-ide-native-receipt',
    host: 'codebuddy-ide',
    status: 'observed',
    observation_id: observation.observation_id,
    session_id: observation.session_id,
    freshness: {
      status: 'current',
      observed_at: observation.observed_at,
      expires_at: observation.expires_at,
      marketplace_identity: observation.marketplace,
    },
    workspace: observation.workspace,
    surfaces: observation.surfaces,
    tasks: observation.tasks,
    host_readiness: { status: 'pending', reason: 'observation-recorded-not-promoted' },
    promotion: 'prohibited',
  };
  writeOutput(options.output, record);
  return record;
}

module.exports = { SURFACES, TASK_STATUSES, createTemplate, ingestObservation };
