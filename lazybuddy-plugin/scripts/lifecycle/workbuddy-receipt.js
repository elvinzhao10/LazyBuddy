'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');

const MCP_SERVERS = Object.freeze([
  'run-ledger',
  'verification',
  'status-dashboard',
  'context-graph',
  'code-intel',
  'docs',
]);
const RECEIPT_KEYS = Object.freeze([
  'build', 'capabilities', 'host', 'observed_at', 'schema_version', 'session_id', 'source', 'type',
]);
const CAPABILITY_KEYS = Object.freeze(['agent', 'command', 'hook', 'mcp', 'skill']);
const SOURCE_KEYS = Object.freeze(['manifest', 'manifest_sha256', 'plugin', 'release_root', 'route', 'version']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:+-]{2,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SENSITIVE_KEY = /(?:token|password|secret|credential|authorization|oauth|private[_-]?key)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._-]{10,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function fail(message) {
  throw new LifecycleError('WORKBUDDY_RECEIPT_INVALID', message);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail(`${label} fields do not match the receipt schema`);
}

function rejectSensitive(value) {
  if (Array.isArray(value)) {
    value.forEach(rejectSensitive);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) fail('credential-shaped receipt fields are forbidden');
      rejectSensitive(item);
    }
    return;
  }
  if (typeof value === 'string' && SENSITIVE_VALUE.test(value)) fail('credential-shaped receipt values are forbidden');
}

function loadedCapability(value, label) {
  exactKeys(value, ['id', 'status'], label);
  if (!IDENTIFIER.test(value.id) || value.status !== 'loaded') fail(`${label} must identify a loaded capability`);
}

function sourceTemplate(releaseRoot, manifestSha256, version) {
  return {
    route: 'workbuddy-marketplace',
    release_root: releaseRoot,
    manifest: 'lazybuddy-plugin/.workbuddy-plugin/plugin.json',
    manifest_sha256: manifestSha256,
    plugin: 'lazybuddy',
    version,
  };
}

function receiptTemplates(releaseRoot, manifestSha256, version) {
  const source = sourceTemplate(releaseRoot, manifestSha256, version);
  return {
    observation: {
      schema_version: 1,
      type: 'workbuddy-marketplace-full-plugin',
      source,
      host: 'workbuddy',
      build: '<current-build>',
      session_id: '<current-session>',
      observed_at: '<current-utc-timestamp>',
      capabilities: {
        skill: { id: '<loaded-skill>', status: 'loaded' },
        command: { id: '<loaded-command>', status: 'loaded' },
        agent: { id: '<loaded-agent>', status: 'loaded' },
        hook: { id: '<loaded-hook>', status: 'loaded' },
        mcp: Object.fromEntries(MCP_SERVERS.map((name) => [name, 'connected'])),
      },
    },
    removal: {
      schema_version: 1,
      type: 'workbuddy-marketplace-removal',
      source,
      scope: 'receipt-owned-assets-only',
      modified_assets: 'preserve-and-refuse',
    },
    recovery: {
      schema_version: 1,
      type: 'workbuddy-marketplace-recovery',
      from_route: 'workbuddy-marketplace',
      to_route: 'manual-skills-mcp-fallback',
      removal_receipt_required: true,
      coexistence: false,
      removal_scope: 'receipt-owned-unmodified-assets-only',
    },
  };
}

function validateWorkbuddyReceipt(receiptPath, context) {
  let receipt;
  try {
    receipt = JSON.parse(safeFile(receiptPath, 'WORKBUDDY_RECEIPT_INVALID').bytes.toString('utf8'));
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError('WORKBUDDY_RECEIPT_INVALID', 'receipt must be valid JSON', error);
  }
  rejectSensitive(receipt);
  exactKeys(receipt, RECEIPT_KEYS, 'receipt');
  exactKeys(receipt.source, SOURCE_KEYS, 'source');
  exactKeys(receipt.capabilities, CAPABILITY_KEYS, 'capabilities');
  if (receipt.schema_version !== 1 || receipt.type !== 'workbuddy-marketplace-full-plugin'
    || receipt.host !== 'workbuddy') fail('receipt identity does not match WorkBuddy marketplace full-plugin');
  const expectedSource = sourceTemplate(context.releaseRoot, context.manifestSha256, context.version);
  if (!Object.entries(expectedSource).every(([key, value]) => receipt.source[key] === value)) {
    fail('receipt marketplace source or version is stale');
  }
  if (!IDENTIFIER.test(receipt.build) || receipt.build !== context.build) fail('receipt build is not current');
  if (!IDENTIFIER.test(receipt.session_id) || receipt.session_id !== context.session) fail('receipt session is not current');
  const observedAt = new Date(receipt.observed_at);
  const currentDay = new Date(Date.UTC(context.now.getUTCFullYear(), context.now.getUTCMonth(), context.now.getUTCDate()));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(receipt.observed_at)
    || Number.isNaN(observedAt.getTime()) || observedAt < currentDay || observedAt > context.now) fail('receipt observation is stale');
  loadedCapability(receipt.capabilities.skill, 'skill');
  loadedCapability(receipt.capabilities.command, 'command');
  loadedCapability(receipt.capabilities.agent, 'agent');
  loadedCapability(receipt.capabilities.hook, 'hook');
  exactKeys(receipt.capabilities.mcp, MCP_SERVERS, 'mcp');
  if (MCP_SERVERS.some((name) => receipt.capabilities.mcp[name] !== 'connected')) fail('all six MCP servers must be connected');
  return { status: 'ready', route: 'workbuddy-marketplace-full-plugin', build: receipt.build, session_id: receipt.session_id };
}

function validateReceiptPath(receiptPath) {
  if (!path.isAbsolute(receiptPath) || path.parse(path.resolve(receiptPath)).root === path.resolve(receiptPath)) {
    fail('receipt must be an explicit non-host-private file');
  }
  let canonicalPath;
  try {
    canonicalPath = fs.realpathSync(receiptPath);
  } catch (error) {
    throw new LifecycleError('WORKBUDDY_RECEIPT_INVALID', 'receipt path is unavailable', error);
  }
  if ([receiptPath, canonicalPath].some((value) => /(?:^|[\\/])\.workbuddy(?:[\\/]|$)/.test(value))) {
    fail('receipt must be an explicit non-host-private file');
  }
}

module.exports = { MCP_SERVERS, receiptTemplates, validateReceiptPath, validateWorkbuddyReceipt };
