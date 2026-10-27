import { definitions } from './schema.mjs';

export class ContractError extends Error {
  constructor(code, location = '$') { super(`${code} at ${location}`); this.code = code; this.location = location; }
}
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function check(value, rule, location) {
  if (rule.$ref) return check(value, definitions[rule.$ref.split('/').at(-1)], location);
  if (rule.anyOf || rule.oneOf) {
    const matches = (rule.anyOf || rule.oneOf).filter(option => {
      try { check(value, option, location); return true; } catch (error) { if (error instanceof ContractError) return false; throw error; }
    });
    if (matches.length === 0 || (rule.oneOf && matches.length !== 1)) throw new ContractError('INVALID_VARIANT', location);
    return;
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) throw new ContractError('INVALID_CONSTANT', location);
  if (rule.enum && !rule.enum.includes(value)) throw new ContractError('INVALID_ENUM', location);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type && (rule.type === 'integer' ? !Number.isSafeInteger(value) : type !== rule.type)) throw new ContractError('INVALID_TYPE', location);
  if (type === 'string' && ((rule.minLength && value.length < rule.minLength) ||
    (rule.maxLength && value.length > rule.maxLength) || (rule.pattern && !new RegExp(rule.pattern).test(value)))) throw new ContractError('INVALID_STRING', location);
  if (type === 'string' && rule.format === 'date-time' && !Number.isFinite(Date.parse(value))) throw new ContractError('INVALID_TIMESTAMP', location);
  if (typeof value === 'number' && (value < rule.minimum || value > rule.maximum)) throw new ContractError('OUT_OF_BOUNDS', location);
  if (type === 'array') {
    if (value.length > (rule.maxItems ?? 10000)) throw new ContractError('TOO_MANY_ITEMS', location);
    if (rule.items) value.forEach((item, index) => check(item, rule.items, `${location}[${index}]`));
  }
  if (type === 'object') {
    for (const name of rule.required || []) if (!Object.hasOwn(value, name)) throw new ContractError('MISSING_FIELD', `${location}.${name}`);
    for (const [name, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new ContractError('RESERVED_FIELD', location);
      if (rule.properties && Object.hasOwn(rule.properties, name)) check(item, rule.properties[name], `${location}.${name}`);
      else if (rule.additionalProperties === false) throw new ContractError('UNKNOWN_FIELD', `${location}.${name}`);
    }
  }
}
export function parseContract(name, value) {
  if (!Object.hasOwn(definitions, name)) throw new ContractError('UNKNOWN_CONTRACT');
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new ContractError('INPUT_TOO_LARGE');
  check(value, definitions[name], '$');
  if (name === 'command' && Object.keys(value.payload).length === 0) throw new ContractError('EMPTY_OPERATION');
  if (name === 'acknowledgement' && value.status === 'applied' && value.consumed_plan_revision !== value.plan_revision) throw new ContractError('UNCONSUMED_REVISION');
  return structuredClone(value);
}
export function requireRecord(value, location = '$') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('EXPECTED_RECORD', location);
  return value;
}
export function requireText(value, location = '$') {
  if (typeof value !== 'string' || !value.length || value.length > 8192) throw new ContractError('EXPECTED_TEXT', location);
  return value;
}
export function requireRevision(value, location = '$') {
  if (!Number.isSafeInteger(value) || value < 0) throw new ContractError('EXPECTED_REVISION', location);
  return value;
}
