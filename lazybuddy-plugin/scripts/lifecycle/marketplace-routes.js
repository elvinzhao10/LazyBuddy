'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');

const CONTRACT_PATH = path.resolve(__dirname, '..', '..', 'contracts', 'marketplace-route-contract.v1.json');
const PAYLOAD_COMPONENTS = Object.freeze({
  skills: ['./skills/'],
  commands: ['./commands/'],
  agents: ['./agents/'],
  hooks: ['./hooks/hooks.json'],
  mcpServers: ['./.mcp.json'],
});
const CODEBUDDY_USER_CONFIG = Object.freeze({
  mcp_mode: Object.freeze({
    description: 'MCP profile: direct, assisted, planned, orchestrated, or long-horizon.',
    sensitive: false,
  }),
});

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function jsonFile(file, code) {
  const bytes = safeFile(file, code).bytes;
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    throw new LifecycleError(code, `invalid JSON: ${file}`, error);
  }
}

function contract() {
  const contractFile = jsonFile(CONTRACT_PATH, 'MARKETPLACE_CONTRACT_INVALID');
  const expectedDigest = safeFile(`${CONTRACT_PATH}.sha256`, 'MARKETPLACE_CONTRACT_INVALID')
    .bytes.toString('utf8').trim().split(/\s+/)[0];
  if (digest(contractFile.bytes) !== expectedDigest) {
    throw new LifecycleError('MARKETPLACE_CONTRACT_INVALID', 'marketplace route contract digest mismatch');
  }
  const parsed = contractFile.value;
  if (parsed?.schema_version !== 1 || typeof parsed.version !== 'string'
    || !parsed.identity || !parsed.artifacts || !parsed.payload || !parsed.default_routes || !parsed.fallback) {
    throw new LifecycleError('MARKETPLACE_CONTRACT_INVALID', 'marketplace route contract is malformed');
  }
  return parsed;
}

function inventory(pluginRoot, policy) {
  const records = [];
  const walk = (relative) => {
    const directory = path.join(pluginRoot, relative);
    let names;
    try {
      names = fs.readdirSync(directory).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    } catch (error) {
      throw new LifecycleError('MARKETPLACE_PAYLOAD_INVALID', `canonical payload root unavailable: ${relative}`, error);
    }
    for (const name of names) {
      const child = path.posix.join(relative, name);
      const absolute = path.join(pluginRoot, child);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(child);
      else if (stat.isFile() && stat.nlink === 1 && name !== '.gitkeep') {
        records.push({ path: child, sha256: digest(safeFile(absolute, 'MARKETPLACE_PAYLOAD_INVALID').bytes) });
      } else if (name !== '.gitkeep') {
        throw new LifecycleError('MARKETPLACE_PAYLOAD_INVALID', `canonical payload must contain only regular files: ${child}`);
      }
    }
  };
  for (const root of policy.roots) walk(root);
  for (const relative of policy.files) {
    records.push({ path: relative, sha256: digest(safeFile(path.join(pluginRoot, relative), 'MARKETPLACE_PAYLOAD_INVALID').bytes) });
  }
  records.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return records;
}

function validateManifest(value, host, expectedVersion) {
  const expected = host === 'codebuddy'
    ? { name: 'lazybuddy', version: expectedVersion, commands: PAYLOAD_COMPONENTS.commands, agents: PAYLOAD_COMPONENTS.agents, hooks: PAYLOAD_COMPONENTS.hooks, mcpServers: PAYLOAD_COMPONENTS.mcpServers, userConfig: CODEBUDDY_USER_CONFIG }
    : { name: 'lazybuddy', version: expectedVersion, description: 'LazyBuddy workflows for CodeBuddy and WorkBuddy.', skills: PAYLOAD_COMPONENTS.skills, commands: PAYLOAD_COMPONENTS.commands, agents: PAYLOAD_COMPONENTS.agents, hooks: PAYLOAD_COMPONENTS.hooks, mcpServers: PAYLOAD_COMPONENTS.mcpServers };
  if (host === 'codebuddy') expected.description = 'LazyBuddy workflows for CodeBuddy and WorkBuddy.';
  const errorCode = value?.version === expectedVersion ? 'MARKETPLACE_IDENTITY_INVALID' : 'MARKETPLACE_VERSION_MISMATCH';
  const keysMatch = JSON.stringify(Object.keys(value || {}).sort()) === JSON.stringify(Object.keys(expected).sort());
  const valuesMatch = keysMatch && Object.entries(expected)
    .every(([key, expectedValue]) => JSON.stringify(value[key]) === JSON.stringify(expectedValue));
  if (!valuesMatch) {
    throw new LifecycleError(errorCode, `${host} plugin manifest does not match the marketplace contract`);
  }
}

function validateMarketplaceRoutes(releaseRoot) {
  const policy = contract();
  const artifacts = {};
  for (const [relative, expectedDigest] of Object.entries(policy.artifacts)) {
    const parsed = jsonFile(path.join(releaseRoot, relative), 'MARKETPLACE_MANIFEST_INVALID');
    if (digest(parsed.bytes) !== expectedDigest) {
      const version = parsed.value?.version ?? parsed.value?.plugins?.[0]?.version;
      const code = version === policy.version ? 'MARKETPLACE_IDENTITY_INVALID' : 'MARKETPLACE_VERSION_MISMATCH';
      throw new LifecycleError(code, `marketplace artifact bytes changed: ${relative}`);
    }
    artifacts[relative] = parsed.value;
  }
  const marketplace = artifacts['.codebuddy-plugin/marketplace.json'];
  const entry = marketplace?.plugins?.[0];
  if (marketplace?.name !== policy.identity.marketplace || marketplace?.owner?.name !== policy.identity.owner
    || marketplace?.plugins?.length !== 1 || entry?.name !== policy.identity.plugin
    || entry?.source !== './lazybuddy-plugin' || entry?.version !== policy.version) {
    throw new LifecycleError('MARKETPLACE_IDENTITY_INVALID', 'CodeBuddy marketplace identity does not match the contract');
  }
  validateManifest(artifacts['lazybuddy-plugin/.codebuddy-plugin/plugin.json'], 'codebuddy', policy.version);
  validateManifest(artifacts['lazybuddy-plugin/.workbuddy-plugin/plugin.json'], 'workbuddy', policy.version);
  const payload = inventory(path.join(releaseRoot, 'lazybuddy-plugin'), policy.payload);
  if (payload.length !== policy.payload.file_count || digest(Buffer.from(JSON.stringify(payload))) !== policy.payload.inventory_sha256) {
    throw new LifecycleError('MARKETPLACE_PAYLOAD_INVALID', 'canonical marketplace payload inventory changed');
  }
  return {
    version: policy.version,
    codebuddy: { plugin: policy.identity.codebuddy_install_id, payload_inventory: payload.map((entryValue) => entryValue.path) },
    workbuddy: { plugin: policy.identity.plugin, payload_inventory: payload.map((entryValue) => entryValue.path) },
  };
}

function defaultRouteForHost(host) {
  const route = contract().default_routes[host];
  if (!route) throw new LifecycleError('INVALID_HOST', `unsupported marketplace host: ${host}`);
  return route;
}

function fallbackPolicy() {
  return contract().fallback;
}

module.exports = { defaultRouteForHost, fallbackPolicy, validateMarketplaceRoutes };
