'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class EvidenceIntegrityError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'EvidenceIntegrityError';
  }
}

function resolveRoot(rootPath) {
  if (!path.isAbsolute(rootPath)) {
    throw new EvidenceIntegrityError('eval_root', 'must be an absolute path');
  }
  let root;
  try {
    root = fs.realpathSync(rootPath);
  } catch {
    throw new EvidenceIntegrityError('eval_root', 'must exist');
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new EvidenceIntegrityError('eval_root', 'must be a directory');
  }
  return root;
}

function readBoundFile(root, productRoot, item, field) {
  if (path.isAbsolute(item.file)) {
    throw new EvidenceIntegrityError(field, 'file must be relative to eval_root');
  }
  const candidate = path.resolve(root, item.file);
  if (!candidate.startsWith(`${productRoot}${path.sep}`)) {
    throw new EvidenceIntegrityError(field, `file is outside product namespace: ${item.file}`);
  }
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    throw new EvidenceIntegrityError(field, `file is absent: ${item.file}`);
  }
  if (!resolved.startsWith(`${productRoot}${path.sep}`) || !fs.statSync(resolved).isFile()) {
    throw new EvidenceIntegrityError(field, 'file must resolve inside product namespace');
  }
  const content = fs.readFileSync(resolved);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  if (digest !== item.sha256) {
    throw new EvidenceIntegrityError(`${field}.sha256`, `digest mismatch: ${item.file}`);
  }
  if (item.bytes !== undefined && content.byteLength !== item.bytes) {
    throw new EvidenceIntegrityError(`${field}.bytes`, `size mismatch: ${item.file}`);
  }
  return content;
}

function verifyAssertionManifest(root, productRoot, manifest) {
  return manifest.reduce((total, item, index) => {
    const content = readBoundFile(root, productRoot, item, `assertion_manifest[${index}]`).toString(
      'utf8',
    );
    const derivedCount = [...content.matchAll(/^\s+def test_/gm)].length;
    if (derivedCount !== item.count) {
      throw new EvidenceIntegrityError(
        `assertion_manifest[${index}].count`,
        `derived ${derivedCount}, fixture claimed ${item.count}`,
      );
    }
    return total + derivedCount;
  }, 0);
}

function verifyEvidence(root, productRoot, evidence, assertionOutput) {
  let outputContent = null;
  evidence.forEach((item, index) => {
    const content = readBoundFile(root, productRoot, item, `required_evidence[${index}]`);
    if (item.file === assertionOutput) outputContent = content.toString('utf8');
  });
  if (outputContent === null) {
    throw new EvidenceIntegrityError('assertion_output', 'must reference required_evidence');
  }
  const countMatch = outputContent.match(/Ran (\d+) tests? in /);
  if (countMatch === null || !/\nOK\s*$/.test(outputContent)) {
    throw new EvidenceIntegrityError('assertion_output', 'must contain a completed passing test run');
  }
  return Number.parseInt(countMatch[1], 10);
}

function verifyFixtureEvidence(rootPath, fixture) {
  const root = resolveRoot(rootPath);
  const productPath = path.join(root, `${fixture.product}-liveeval`);
  let productRoot;
  try {
    productRoot = fs.realpathSync(productPath);
  } catch {
    throw new EvidenceIntegrityError('product', `namespace is absent: ${productPath}`);
  }
  if (!productRoot.startsWith(`${root}${path.sep}`) || !fs.statSync(productRoot).isDirectory()) {
    throw new EvidenceIntegrityError('product', 'namespace must resolve inside eval_root');
  }
  return {
    assertionsRepresented: verifyAssertionManifest(
      root,
      productRoot,
      fixture.quality.assertion_manifest,
    ),
    assertionsPassed: verifyEvidence(
      root,
      productRoot,
      fixture.quality.required_evidence,
      fixture.quality.assertion_output,
    ),
  };
}

module.exports = { EvidenceIntegrityError, verifyFixtureEvidence };
