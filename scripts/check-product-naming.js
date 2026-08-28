#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = process.env.PRODUCT_NAMING_ROOT
  ? path.resolve(process.env.PRODUCT_NAMING_ROOT)
  : path.resolve(__dirname, '..');
const allowlistPath = path.join(root, '.product-naming-allowlist.json');
const classifications = new Set([
  'verbatim-eval-quote',
  'attribution',
  'old-release-note',
  'immutable-historical-fixture',
  'source-identity',
  'stable-machine-id',
  'old-note',
]);

function fail(message) {
  process.stderr.write(`NAMING_ERROR: ${message}\n`);
  process.exitCode = 1;
}

function parseAllowlist() {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path.basename(allowlistPath)}: ${error.message}`);
    return null;
  }
  if (!value || !Array.isArray(value.formerDisplayNames) || !Array.isArray(value.stableIdentityFiles) || !Array.isArray(value.currentCliPages)) {
    fail('allowlist must define formerDisplayNames, stableIdentityFiles, and currentCliPages arrays');
    return null;
  }
  for (const [index, entry] of value.formerDisplayNames.entries()) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.text !== 'string' || !Number.isInteger(entry.count) || entry.count < 1
      || typeof entry.classification !== 'string' || !classifications.has(entry.classification)
      || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      fail(`formerDisplayNames[${index}] requires path, text, positive count, approved classification, and reason`);
    }
  }
  for (const [index, entry] of value.stableIdentityFiles.entries()) {
    if (!entry || typeof entry.path !== 'string' || !entry.ids || typeof entry.ids !== 'object' || Array.isArray(entry.ids)) {
      fail(`stableIdentityFiles[${index}] requires path and ids object`);
      continue;
    }
    for (const [id, count] of Object.entries(entry.ids)) {
      if (!['trae-ide', 'trae-cli', 'trae-work'].includes(id) || !Number.isInteger(count) || count < 1) {
        fail(`stableIdentityFiles[${index}] has invalid stable ID/count`);
      }
    }
  }
  if (value.currentCliPages.some(item => typeof item !== 'string' || item === '')) fail('currentCliPages entries must be non-empty paths');
  return value;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function readText(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

function countExact(content, text) {
  return content.split(text).length - 1;
}

const allowlist = parseAllowlist();
if (allowlist) {
  const files = trackedFiles();
  const observed = new Map();
  for (const relativePath of files) {
    if (relativePath === '.product-naming-allowlist.json' || relativePath === 'scripts/check-product-naming.js') continue;
    const content = readText(relativePath);
    if (content === null) continue;
    for (const match of content.matchAll(/\b(?:LazyTrae CLI|Trae\s+(?:IDE|CLI|Work))\b/gi)) {
      const key = `${relativePath}\0${match[0]}`;
      observed.set(key, (observed.get(key) || 0) + 1);
    }
    for (const match of content.matchAll(/\bwork[\s-]*buddy\b/gi)) {
      if (match[0] !== 'WorkBuddy' && match[0] !== 'workbuddy') fail(`${relativePath} uses non-canonical WorkBuddy spelling: ${match[0]}`);
    }
    if (/\btraecode-(?:ide|cli|work)\b/i.test(content)) fail(`${relativePath} renames a stable Trae machine ID`);
  }

  const allowed = new Set();
  for (const entry of allowlist.formerDisplayNames) {
    const key = `${entry.path}\0${entry.text}`;
    if (allowed.has(key)) fail(`duplicate former display-name allowlist entry: ${entry.path} :: ${entry.text}`);
    allowed.add(key);
    const actual = observed.get(key) || 0;
    if (actual !== entry.count) fail(`${entry.path} :: ${entry.text} expected ${entry.count} allowlisted occurrence(s), found ${actual}`);
  }
  for (const [key, count] of observed.entries()) {
    if (!allowed.has(key)) fail(`${key.replace('\0', ' :: ')} has ${count} unallowlisted former display-name occurrence(s)`);
  }

  for (const entry of allowlist.stableIdentityFiles) {
    const content = readText(entry.path);
    if (content === null) {
      fail(`${entry.path} stable identity contract is not text`);
      continue;
    }
    for (const [id, expected] of Object.entries(entry.ids)) {
      const actual = countExact(content, id);
      if (actual !== expected) fail(`${entry.path} stable ID ${id} expected ${expected} occurrence(s), found ${actual}`);
    }
  }

  for (const relativePath of allowlist.currentCliPages) {
    const content = readText(relativePath);
    if (content === null || !content.includes('TraeCode CLI') || !content.includes('traecli')) {
      fail(`${relativePath} must use TraeCode CLI and the traecli executable name`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write('NAMING_OK: zero unallowlisted former display names; stable IDs and product spellings verified\n');
