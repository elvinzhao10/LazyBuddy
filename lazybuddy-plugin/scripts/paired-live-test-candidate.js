#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  AssemblyError,
  HOSTS,
  chmodImmutable,
  computeCombinedDigest,
  digest,
  jsonBytes,
  makeWritable,
  pendingTemplate,
  productRecord,
  readRegular,
  refuse,
  resolveRealDirectory,
  stableJson,
  verifyArtifacts,
  verifySource,
  writeExclusive,
} = require('./paired-live-test-lib.js');
const {
  buildInventory,
  computeTreeDigest,
  validateCandidate,
  validateOnboarding,
} = require('../contracts/validate-paired-candidate.js');

function parse(argv) {
  const command = argv[0];
  refuse(command !== 'assemble' && command !== 'verify', 'USAGE', 'expected assemble or verify');
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    refuse(!argv[index].startsWith('--') || index + 1 >= argv.length, 'USAGE', `malformed argument ${argv[index] || ''}`);
    refuse(values.has(argv[index]), 'USAGE', `duplicate ${argv[index]}`);
    values.set(argv[index], argv[index + 1]);
  }
  const required = command === 'assemble'
    ? ['--lazybuddy-root', '--lazytrae-root', '--lazybuddy-artifact-root', '--lazytrae-artifact-root', '--output-root']
    : ['--candidate'];
  for (const flag of required) refuse(!values.has(flag), 'USAGE', `missing ${flag}`);
  refuse(values.size !== required.length, 'USAGE', 'unknown argument');
  return { command, values };
}

function expectedFinalFiles(manifest) {
  return [...manifest.payload_inventory.map((entry) => entry.path), manifest.detached_metadata.path, 'manifest.json'].sort();
}

function listFiles(root) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      refuse(stat.isSymbolicLink(), 'LINKED_FILE', relative);
      if (stat.isDirectory()) {
        refuse((stat.mode & 0o777) !== 0o555, 'PERMISSION_MISMATCH', relative);
        visit(target, relative);
      } else {
        refuse(!stat.isFile(), 'NONREGULAR_FILE', relative);
        refuse(stat.nlink !== 1, 'LINKED_FILE', relative);
        refuse((stat.mode & 0o777) !== 0o444, 'PERMISSION_MISMATCH', relative);
        files.push(relative);
      }
    }
  };
  refuse((fs.lstatSync(root).mode & 0o777) !== 0o555, 'PERMISSION_MISMATCH', '.');
  visit(root, '');
  return files.sort();
}

function verifyCandidate(candidateInput) {
  const root = resolveRealDirectory(candidateInput, 'candidate');
  const manifestBytes = readRegular(root, 'manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const combined = computeCombinedDigest(manifest);
  refuse(combined !== manifest.combined_digest, 'COMBINED_DIGEST_MISMATCH', 'manifest projection');
  refuse(path.basename(root) !== `live-test-v1.1.0-${combined}`, 'CANDIDATE_NAME_MISMATCH', root);
  const actualFiles = listFiles(root);
  refuse(stableJson(actualFiles) !== stableJson(expectedFinalFiles(manifest)), 'UNEXPECTED_FILE', actualFiles.join(','));
  const actualInventory = manifest.payload_inventory.map((expected) => {
    const bytes = readRegular(root, expected.path);
    const actual = { ...expected, size: bytes.length, sha256: digest(bytes) };
    refuse(stableJson(actual) !== stableJson(expected), 'FILE_DIGEST_MISMATCH', expected.path);
    return actual;
  });
  const detached = readRegular(root, manifest.detached_metadata.path);
  refuse(digest(detached) !== manifest.detached_metadata.sha256, 'DETACHED_METADATA_MISMATCH', manifest.detached_metadata.path);
  const metadata = JSON.parse(detached.toString('utf8'));
  refuse(metadata.schema_version !== 'lazyseries.paired-build-metadata.v1', 'DETACHED_METADATA_MISMATCH', manifest.detached_metadata.path);
  for (const product of manifest.products) {
    const prefix = product.product_id === 'lazybuddy' ? 'LazyBuddy/' : 'LazyTrae/';
    const records = actualInventory.filter((entry) => entry.path.startsWith(prefix));
    refuse(computeTreeDigest(records) !== product.tree_sha256, 'TREE_DIGEST_MISMATCH', product.product_id);
    refuse(computeTreeDigest(records, 'payload-v1') !== product.payload_sha256, 'PAYLOAD_DIGEST_MISMATCH', product.product_id);
    const archive = records.find((entry) => entry.path === product.archive_path);
    refuse(!archive || archive.sha256 !== product.archive_sha256, 'ARCHIVE_DIGEST_MISMATCH', product.archive_path);
  }
  const onboardingPath = `${root}-onboarding`;
  const onboardingRoot = resolveRealDirectory(onboardingPath, 'onboarding sibling');
  refuse((fs.lstatSync(onboardingRoot).mode & 0o777) !== 0o755, 'PERMISSION_MISMATCH', onboardingRoot);
  const onboardingFiles = fs.readdirSync(onboardingRoot).sort();
  refuse(stableJson(onboardingFiles) !== stableJson(['manifest.json']), 'UNEXPECTED_FILE', onboardingRoot);
  const onboardingFile = path.join(onboardingRoot, 'manifest.json');
  const onboardingStat = fs.lstatSync(onboardingFile);
  refuse(!onboardingStat.isFile() || onboardingStat.isSymbolicLink() || onboardingStat.nlink !== 1, 'LINKED_FILE', onboardingFile);
  refuse((onboardingStat.mode & 0o777) !== 0o644, 'PERMISSION_MISMATCH', onboardingFile);
  const onboarding = JSON.parse(fs.readFileSync(onboardingFile, 'utf8'));
  validateOnboarding(onboarding, manifest);
  refuse(onboarding.candidate_manifest_sha256 !== digest(manifestBytes), 'STALE_CANDIDATE', onboardingFile);
  return { valid: true, combined_digest: combined, candidate_path: root, onboarding_path: onboardingRoot };
}

function assemble(values) {
  const buddySource = resolveRealDirectory(values.get('--lazybuddy-root'), 'LazyBuddy source');
  const traeSource = resolveRealDirectory(values.get('--lazytrae-root'), 'LazyTrae source');
  const buddyArtifacts = resolveRealDirectory(values.get('--lazybuddy-artifact-root'), 'LazyBuddy artifacts');
  const traeArtifacts = resolveRealDirectory(values.get('--lazytrae-artifact-root'), 'LazyTrae artifacts');
  const outputRoot = resolveRealDirectory(values.get('--output-root'), 'output root', true);
  const artifacts = verifyArtifacts(buddyArtifacts, traeArtifacts);
  verifySource(buddySource, artifacts.buddy.manifest.source_sha, artifacts.buddy.manifest.source_tree, 'LazyBuddy');
  verifySource(traeSource, artifacts.trae.manifest.source.sha, artifacts.trae.manifest.source.tree, 'LazyTrae');

  const buddySchema = readRegular(path.join(buddySource, 'lazybuddy-plugin', 'contracts'), 'paired-candidate-contract.v1.schema.json');
  const traeSchema = readRegular(path.join(traeSource, 'lazytrae-plugin', 'packages', 'cli', 'contracts'), 'paired-candidate-contract.v1.schema.json');
  refuse(!buddySchema.equals(traeSchema), 'SHARED_SCHEMA_MISMATCH', 'paired-candidate-contract.v1.schema.json');

  const nonce = require('node:crypto').randomBytes(16).toString('hex');
  let staging = path.join(outputRoot, `.live-test-v1.1.0.prestaging-${nonce}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  let destination = '';
  let onboardingDestination = '';
  let onboardingStaging = '';
  let lock = '';
  let lockOwned = false;
  let published = false;
  let onboardingPublished = false;
  try {
    writeExclusive(staging, `LazyBuddy/${artifacts.buddy.archive}`, artifacts.buddy.archiveBytes);
    writeExclusive(staging, `LazyTrae/${artifacts.trae.archive}`, artifacts.trae.archiveBytes);
    const metadataBytes = jsonBytes({
      schema_version: 'lazyseries.paired-build-metadata.v1',
      products: [
        {
          product_id: 'lazybuddy',
          source_tree: artifacts.buddy.manifest.source_tree,
          extracted_tree_sha256: artifacts.buddy.extractedTreeSha256,
          todo32_self_verification_receipt_sha256: artifacts.buddy.receiptSha256,
        },
        {
          product_id: 'lazytrae',
          source_tree: artifacts.trae.manifest.source.tree,
          extracted_tree_sha256: artifacts.trae.extractedTreeSha256,
          todo32_self_verification_receipt_sha256: artifacts.trae.receiptSha256,
        },
      ],
    });
    writeExclusive(staging, 'detached/build-metadata.json', metadataBytes);
    const inventory = buildInventory(staging);
    const manifest = {
      schema_version: 'lazyseries.paired-candidate.v1',
      release_version: '1.1.0',
      products: [
        productRecord('lazybuddy', 'LazyBuddy', artifacts.buddy.archive, artifacts.buddy.manifest.source_sha, inventory),
        productRecord('lazytrae', 'LazyTrae', artifacts.trae.archive, artifacts.trae.manifest.source.sha, inventory),
      ],
      shared_contract_digests: [{ name: 'paired-candidate-contract.v1.schema.json', sha256: digest(buddySchema) }],
      payload_inventory: inventory.filter((entry) => entry.path !== 'detached/build-metadata.json'),
      detached_metadata: { path: 'detached/build-metadata.json', sha256: digest(metadataBytes) },
      host_rows: HOSTS.map((host_id) => ({ host_id, status: 'pending' })),
      onboarding_sibling: 'live-test-v1.1.0-<combined-digest>-onboarding',
    };
    manifest.combined_digest = computeCombinedDigest(manifest);
    destination = path.join(outputRoot, `live-test-v1.1.0-${manifest.combined_digest}`);
    onboardingDestination = `${destination}-onboarding`;
    refuse(fs.existsSync(destination), 'DESTINATION_EXISTS', destination);
    refuse(fs.existsSync(onboardingDestination), 'DESTINATION_EXISTS', onboardingDestination);
    const namedStaging = path.join(outputRoot, `.live-test-v1.1.0-${manifest.combined_digest}.staging-${nonce}`);
    fs.renameSync(staging, namedStaging);
    staging = namedStaging;
    validateCandidate(manifest, { payloadRoot: staging, destination });
    const manifestBytes = jsonBytes(manifest);
    writeExclusive(staging, 'manifest.json', manifestBytes);
    chmodImmutable(staging);
    if (process.env.LAZYBUDDY_PAIRED_FAIL_BEFORE_RENAME === '1') throw new AssemblyError('INJECTED_FAILURE', 'before rename');
    lock = `${destination}.lock`;
    let lockFd;
    try { lockFd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new AssemblyError('DESTINATION_EXISTS', destination);
      throw error;
    }
    fs.closeSync(lockFd);
    lockOwned = true;
    verifySource(buddySource, artifacts.buddy.manifest.source_sha, artifacts.buddy.manifest.source_tree, 'LazyBuddy');
    verifySource(traeSource, artifacts.trae.manifest.source.sha, artifacts.trae.manifest.source.tree, 'LazyTrae');
    refuse(fs.existsSync(destination), 'DESTINATION_EXISTS', destination);
    refuse(fs.existsSync(onboardingDestination), 'DESTINATION_EXISTS', onboardingDestination);
    fs.renameSync(staging, destination);
    published = true;
    onboardingStaging = path.join(outputRoot, `.live-test-v1.1.0-${manifest.combined_digest}-onboarding.staging-${nonce}`);
    fs.mkdirSync(onboardingStaging, { mode: 0o700 });
    const onboarding = pendingTemplate(manifest.combined_digest, digest(manifestBytes));
    validateOnboarding(onboarding, manifest);
    writeExclusive(onboardingStaging, 'manifest.json', jsonBytes(onboarding));
    fs.chmodSync(path.join(onboardingStaging, 'manifest.json'), 0o644);
    fs.chmodSync(onboardingStaging, 0o755);
    refuse(fs.existsSync(onboardingDestination), 'DESTINATION_EXISTS', onboardingDestination);
    fs.renameSync(onboardingStaging, onboardingDestination);
    onboardingPublished = true;
    const verified = verifyCandidate(destination);
    fs.unlinkSync(lock);
    lockOwned = false;
    lock = '';
    return verified;
  } catch (error) {
    if (lockOwned && lock && fs.existsSync(lock)) fs.unlinkSync(lock);
    if (fs.existsSync(staging)) { makeWritable(staging); fs.rmSync(staging, { recursive: true }); }
    if (onboardingStaging && fs.existsSync(onboardingStaging)) fs.rmSync(onboardingStaging, { recursive: true });
    if (onboardingPublished && onboardingDestination && fs.existsSync(onboardingDestination)) {
      fs.rmSync(onboardingDestination, { recursive: true });
    }
    if (published && destination && fs.existsSync(destination)) {
      makeWritable(destination);
      fs.rmSync(destination, { recursive: true });
    }
    throw error;
  }
}

function main(argv) {
  const parsed = parse(argv);
  const result = parsed.command === 'assemble' ? assemble(parsed.values) : verifyCandidate(parsed.values.get('--candidate'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error.code || 'ASSEMBLY_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assemble, verifyCandidate };
