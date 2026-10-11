import { createHash } from 'node:crypto';

// Local consistency checks, not signatures or authenticated verification receipts.
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const sha256Text = value => createHash('sha256').update(value, 'utf8').digest('hex');
export const commandDigest = command => sha256Text(canonicalJSON(command));
