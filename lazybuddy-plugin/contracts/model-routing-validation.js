'use strict';

const fs = require('node:fs');

const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_MODELS = 256;
const TOP_LEVEL_FIELDS = new Set(['schema_version', 'host', 'models']);
const MODEL_FIELDS = new Set(['id', 'origin', 'tier', 'available', 'capabilities', 'costRank', 'subagentSupported']);
const TIERS = new Set(['economy', 'balanced', 'strong']);
const CAPABILITIES = new Set(['tools', 'code', 'vision']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,127}$/;

class CatalogError extends Error {
  constructor(message) {
    super(`catalog: ${message}`);
    this.name = 'CatalogError';
  }
}

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError(`${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown) throw new CatalogError(`${label} has an unknown field`);
}

function parseModel(value, index) {
  exactFields(value, MODEL_FIELDS, `models[${index}]`);
  if (typeof value.id !== 'string' || !IDENTIFIER.test(value.id)) throw new CatalogError(`models[${index}].id is invalid`);
  if (!['builtin', 'custom'].includes(value.origin)) throw new CatalogError(`models[${index}].origin is invalid`);
  if (!TIERS.has(value.tier)) throw new CatalogError(`models[${index}].tier is invalid`);
  if (typeof value.available !== 'boolean') throw new CatalogError(`models[${index}].available must be boolean`);
  if (!Array.isArray(value.capabilities) || new Set(value.capabilities).size !== value.capabilities.length) {
    throw new CatalogError(`models[${index}].capabilities is invalid`);
  }
  if (value.capabilities.some((capability) => !CAPABILITIES.has(capability))) {
    throw new CatalogError(`models[${index}].capabilities is invalid`);
  }
  if (value.costRank !== undefined && (!Number.isSafeInteger(value.costRank) || value.costRank < 0)) {
    throw new CatalogError(`models[${index}].costRank is invalid`);
  }
  if (value.subagentSupported !== undefined && typeof value.subagentSupported !== 'boolean') {
    throw new CatalogError(`models[${index}].subagentSupported must be boolean`);
  }
  return Object.freeze({
    id: value.id,
    origin: value.origin,
    tier: value.tier,
    available: value.available,
    capabilities: Object.freeze([...value.capabilities]),
    ...(value.costRank === undefined ? {} : { costRank: value.costRank }),
    ...(value.subagentSupported === undefined ? {} : { subagentSupported: value.subagentSupported }),
  });
}

function readCatalog(catalogPath, expectedHost) {
  let bytes;
  try {
    const stat = fs.lstatSync(catalogPath);
    if (!stat.isFile()) throw new CatalogError('input must be a regular file');
    if (stat.size > MAX_CATALOG_BYTES) throw new CatalogError('input exceeds 256 KiB');
    bytes = fs.readFileSync(catalogPath, 'utf8');
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError('input could not be read');
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new CatalogError('input is not valid JSON');
  }
  exactFields(value, TOP_LEVEL_FIELDS, 'root');
  if (value.schema_version !== 1) throw new CatalogError('schema_version must be 1');
  if (value.host !== expectedHost) throw new CatalogError('host does not match --host');
  if (!Array.isArray(value.models) || value.models.length > MAX_MODELS) throw new CatalogError('models must contain at most 256 entries');
  const models = value.models.map(parseModel);
  if (new Set(models.map(({ id }) => id)).size !== models.length) throw new CatalogError('model identifiers must be unique');
  return Object.freeze({ schema_version: 1, host: value.host, models: Object.freeze(models) });
}

module.exports = { CatalogError, readCatalog };
