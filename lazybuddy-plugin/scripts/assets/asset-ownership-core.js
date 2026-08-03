'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedRelative(value) {
  const segments = typeof value === 'string' ? value.split('/') : [];
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || value.includes('\\') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
    || path.posix.normalize(value) !== value) {
    throw new Error('asset path must be a normalized relative path');
  }
  return value;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeFile(filePath, label = 'asset') {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink or linked path`);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
  if (stat.nlink !== 1) throw new Error(`${label} is hard-linked`);
  return { bytes: fs.readFileSync(filePath), mode: stat.mode & 0o777 };
}

function safeDestination(root, relativePath) {
  normalizedRelative(relativePath);
  const absolute = path.resolve(root, relativePath);
  if (!contained(root, absolute)) throw new Error('asset destination escapes its root');
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('asset destination is a symlink or linked path');
    if (current !== absolute && !stat.isDirectory()) throw new Error('asset destination has a non-directory parent');
    if (current === absolute && stat.isFile() && stat.nlink !== 1) throw new Error('asset destination is hard-linked');
  }
  return absolute;
}

function readManifest(sourceRoot, manifestPath) {
  const root = fs.realpathSync.native(sourceRoot);
  const manifestFile = safeFile(manifestPath, 'asset manifest');
  if (!manifestFile || !contained(root, fs.realpathSync.native(manifestPath))) {
    throw new Error('asset manifest must be a regular file inside its source root');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`asset manifest is malformed: ${error.message}`);
  }
  if (!manifest || manifest.schema_version !== 1 || typeof manifest.owner !== 'string'
    || !/^[a-z0-9][a-z0-9.-]+$/.test(manifest.owner) || !Array.isArray(manifest.roots)
    || manifest.roots.length === 0) {
    throw new Error('asset manifest does not satisfy schema version 1');
  }
  return { manifest, root };
}

function collectEntries(sourceRoot, manifest) {
  const entries = [];
  const destinations = new Set();
  const walk = (absolute, relative, rule) => {
    for (const item of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = path.join(absolute, item.name);
      const child = relative ? `${relative}/${item.name}` : item.name;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || (item.isFile() && stat.nlink !== 1)) throw new Error(`source asset is linked: ${child}`);
      if (item.isDirectory()) walk(source, child, rule);
      else if (item.isFile()) {
        const destination = normalizedRelative(`${rule.destination}/${child}`);
        if (destinations.has(destination)) throw new Error(`duplicate asset destination: ${destination}`);
        destinations.add(destination);
        const format = rule.format_by_extension?.[path.extname(item.name)] || rule.default_format;
        if (!['json', 'text'].includes(format)) throw new Error(`unsupported asset format: ${format}`);
        const bytes = fs.readFileSync(source);
        entries.push({ path: destination, format, mode: stat.mode & 0o777, bytes });
      } else throw new Error(`source asset is not a regular file: ${child}`);
    }
  };
  for (const rule of manifest.roots) {
    if (!rule || !['json', 'text'].includes(rule.default_format)
      || !rule.format_by_extension || typeof rule.format_by_extension !== 'object') {
      throw new Error('asset root rule is malformed');
    }
    const source = normalizedRelative(rule.source);
    normalizedRelative(rule.destination);
    const absolute = path.resolve(sourceRoot, source);
    if (!contained(sourceRoot, absolute)) throw new Error('source asset root escapes its manifest root');
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`source asset root is linked or not a directory: ${source}`);
    walk(absolute, '', rule);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeJson(base, caller, incoming, location = '$') {
  if (same(caller, base)) return incoming;
  if (same(incoming, base) || same(caller, incoming)) return caller;
  const objects = [base, caller, incoming].every((value) => value && typeof value === 'object' && !Array.isArray(value));
  if (!objects) throw new Error(`JSON merge conflict at ${location}`);
  const result = {};
  const keys = [...new Set([...Object.keys(base), ...Object.keys(caller), ...Object.keys(incoming)])].sort();
  for (const key of keys) result[key] = mergeJson(base[key], caller[key], incoming[key], `${location}.${key}`);
  return result;
}

function mergeText(base, caller, incoming) {
  if (caller.equals(base)) return incoming;
  if (incoming.equals(base) || caller.equals(incoming)) return caller;
  const baseLines = base.toString('utf8').split('\n');
  const callerLines = caller.toString('utf8').split('\n');
  const incomingLines = incoming.toString('utf8').split('\n');
  if (baseLines.length !== callerLines.length || baseLines.length !== incomingLines.length) {
    throw new Error('text merge conflict: line structure changed on both sides');
  }
  const merged = baseLines.map((line, index) => {
    if (callerLines[index] === line) return incomingLines[index];
    if (incomingLines[index] === line || callerLines[index] === incomingLines[index]) return callerLines[index];
    throw new Error(`text merge conflict at line ${index + 1}`);
  });
  return Buffer.from(merged.join('\n'));
}

function mergeBytes(format, base, caller, incoming) {
  if (caller.equals(base)) return incoming;
  if (incoming.equals(base) || caller.equals(incoming)) return caller;
  if (format === 'text') return mergeText(base, caller, incoming);
  let values;
  try {
    values = [base, caller, incoming].map((bytes) => JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    throw new Error(`JSON merge conflict: ${error.message}`);
  }
  return Buffer.from(`${JSON.stringify(mergeJson(...values), null, 2)}\n`);
}

module.exports = {
  collectEntries, contained, mergeBytes, normalizedRelative, readManifest, safeDestination, safeFile, sha256,
};
