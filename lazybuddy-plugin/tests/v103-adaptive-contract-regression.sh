#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CONTRACTS="$PLUGIN_ROOT/contracts"
FIXTURES="$CONTRACTS/fixtures/v103"

(
    cd "$CONTRACTS"
    shasum -a 256 -c adaptive-harness-contract.v1.json.sha256 >/dev/null
)
(
    cd "$FIXTURES"
    shasum -a 256 -c sha256sums.txt >/dev/null
)

NODE_PATH="${SIX_HOST_PARITY_NODE_MODULES:-$PLUGIN_ROOT/tooling/node_modules}" node - "$CONTRACTS" <<'NODE'
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const contracts = process.argv[2];
const fixtureDir = path.join(contracts, 'fixtures', 'v103');
const contractPath = path.join(contracts, 'adaptive-harness-contract.v1.json');
const schemaPath = path.join(contracts, 'adaptive-harness-contract.v1.schema.json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseChecksumFile(text) {
    const entries = new Map();
    for (const line of text.trim().split('\n')) {
        const match = /^([0-9a-f]{64})  ([0-9]{2}-[a-z0-9-]+\.json)$/.exec(line);
        assert.ok(match, `invalid checksum line: ${line}`);
        assert.equal(entries.has(match[2]), false, `duplicate checksum entry: ${match[2]}`);
        entries.set(match[2], match[1]);
    }
    return entries;
}

function relationshipErrors(manifest, fixtureBytes, fixtures, checksums) {
    const errors = [];
    const manifestFiles = new Set();
    for (const entry of manifest.fixtures) {
        manifestFiles.add(entry.file);
        const bytes = fixtureBytes.get(entry.file);
        const fixture = fixtures.get(entry.file);
        if (!bytes || !fixture) {
            errors.push(`missing fixture: ${entry.file}`);
            continue;
        }
        const actual = sha256(bytes);
        if (entry.sha256 !== actual) errors.push(`manifest digest mismatch: ${entry.file}`);
        if (checksums.get(entry.file) !== actual) errors.push(`checksum mismatch: ${entry.file}`);
        if (entry.id !== fixture.id) errors.push(`manifest id mismatch: ${entry.file}`);
        if (entry.category !== fixture.category) errors.push(`manifest category mismatch: ${entry.file}`);
    }
    for (const file of checksums.keys()) {
        if (!manifestFiles.has(file)) errors.push(`unexpected checksum entry: ${file}`);
    }
    return errors;
}

const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const schema = readJson(schemaPath);
const manifest = readJson(path.join(fixtureDir, 'manifest.json'));
const checksums = parseChecksumFile(fs.readFileSync(path.join(fixtureDir, 'sha256sums.txt'), 'utf8'));
const fixtureBytes = new Map();
const fixtures = new Map();
const ajv = new Ajv({ allErrors: true, schemaId: 'auto', strict: false });
const validateContract = ajv.compile(schema);
const validateFixture = ajv.compile({
    $ref: '#/definitions/fixture',
    definitions: schema.definitions,
});
const validateManifest = ajv.compile({
    $ref: '#/definitions/fixture_manifest',
    definitions: schema.definitions,
});

assert.equal(validateContract(contract), true, JSON.stringify(validateContract.errors));
assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
assert.equal(manifest.fixtures.length, 10);

for (const entry of manifest.fixtures) {
    const bytes = fs.readFileSync(path.join(fixtureDir, entry.file));
    const fixture = JSON.parse(bytes);
    fixtureBytes.set(entry.file, bytes);
    fixtures.set(entry.file, fixture);
    assert.equal(validateFixture(fixture), true, `${entry.file}: ${JSON.stringify(validateFixture.errors)}`);
    const requestDigest = `sha256:${sha256(Buffer.from(fixture.request, 'utf8'))}`;
    assert.equal(fixture.expected_snapshot.adaptive.requestDigest, requestDigest, entry.file);
    const history = fixture.expected_snapshot.adaptive.escalationHistory;
    assert.equal(fixture.expected_snapshot.adaptive.escalationCount, history.length, entry.file);
    assert.ok(history.length <= contract.escalation_bounds.max_auto_escalations, entry.file);
    const ownedResponsibilities = fixture.expected_decision.ownership
        .map((item) => item.responsibility);
    assert.equal(ownedResponsibilities.length, new Set(ownedResponsibilities).size,
        `duplicate responsibility owner: ${entry.file}`);
    assert.deepEqual(new Set(ownedResponsibilities), new Set(fixture.expected_decision.responsibilities),
        `ownership coverage mismatch: ${entry.file}`);
    for (const [index, transition] of history.entries()) {
        assert.equal(transition.sequence, index + 1, entry.file);
        if (index > 0) assert.equal(transition.fromMode, history[index - 1].toMode, entry.file);
    }
}

assert.deepEqual(relationshipErrors(manifest, fixtureBytes, fixtures, checksums), []);
assert.equal(sha256(contractBytes), fs.readFileSync(`${contractPath}.sha256`, 'utf8').trim().split(/\s+/)[0]);
const digestSummary = readJson(path.join(contracts, 'adaptive-harness-v103-digest.json'));
for (const artifact of digestSummary.artifacts) {
    const bytes = fs.readFileSync(path.join(contracts, artifact.name));
    assert.equal(artifact.sha256, sha256(bytes), artifact.name);
    assert.equal(artifact.size_bytes, bytes.length, artifact.name);
}
for (const fixtureEntry of digestSummary.fixtures) {
    const bytes = fs.readFileSync(path.join(fixtureDir, fixtureEntry.name));
    assert.equal(fixtureEntry.sha256, sha256(bytes), fixtureEntry.name);
    assert.equal(fixtureEntry.size_bytes, bytes.length, fixtureEntry.name);
}
assert.equal(digestSummary.fixture_directory.manifest_sha256,
    sha256(fs.readFileSync(path.join(fixtureDir, 'manifest.json'))));
assert.equal(digestSummary.fixture_directory.sha256sums_sha256,
    sha256(fs.readFileSync(path.join(fixtureDir, 'sha256sums.txt'))));
assert.deepEqual(new Set(manifest.fixtures.map((entry) => entry.category)), new Set([
    'broad-feature-unresolved-design',
    'direct-task-verification-failure',
    'explicit-named-workflow',
    'localized-one-file-correction',
    'multi-session-migration',
    'preferred-capability-unavailable',
    'release-or-publication-change',
    'security-sensitive-authorization-change',
    'stale-continuation-snapshot',
    'unfamiliar-cross-file-bug',
]));

assert.deepEqual(new Set(contract.continuation_policy.required_matches), new Set([
    'hostFingerprint',
    'requestDigest',
    'revisionFingerprint',
    'scopeFingerprint',
]));
assert.deepEqual(new Set(contract.continuation_policy.re_evaluate_before_reuse), new Set(['approval', 'risk']));
assert.equal(contract.fingerprint_policy.revision_unavailable, 'fail-closed');
assert.deepEqual(new Set(contract.fingerprint_policy.revision_material), new Set([
    'committed-base',
    'nonignored-untracked-content',
    'staged-content',
    'tracked-working-content',
]));
assert.equal(contract.authority_matrix['release-review'], 'automatic');
assert.equal(contract.authority_matrix['security-review'], 'automatic');
assert.deepEqual(new Set(contract.approval_policy.approval_required_action_classes), new Set([
    'account-marketplace-or-publish-mutation',
    'browser-or-desktop-control',
    'credentials-auth-or-paid-service',
    'host-mcp-settings-mutation',
    'install-or-download',
    'persistent-capability',
    'remote-data-egress',
]));

const security = fixtures.get('04-orchestrated-security-change.json');
const implementationOwner = security.expected_decision.ownership.find((item) => item.responsibility === 'implementation');
const securityReviewer = security.expected_decision.ownership.find((item) => item.responsibility === 'security-review');
assert.equal(implementationOwner.ownerClass, 'implementation-owner');
assert.equal(securityReviewer.ownerClass, 'independent-reviewer');
assert.equal(security.expected_decision.approval_required, false);

const stale = fixtures.get('10-responsibility-ownership.json');
assert.deepEqual(stale.continuation_case.changedMaterial, ['revisionFingerprint']);
assert.equal(stale.continuation_case.oldFingerprints.requestDigest, stale.continuation_case.newFingerprints.requestDigest);
assert.equal(stale.continuation_case.oldFingerprints.scopeFingerprint, stale.continuation_case.newFingerprints.scopeFingerprint);
assert.equal(stale.continuation_case.oldFingerprints.hostFingerprint, stale.continuation_case.newFingerprints.hostFingerprint);
assert.notEqual(stale.continuation_case.oldFingerprints.revisionFingerprint.digest,
    stale.continuation_case.newFingerprints.revisionFingerprint.digest);
assert.equal(stale.continuation_case.preservedDiagnostic.preserved, true);
assert.equal(stale.continuation_case.priorCompletionEvidence, 'rejected');
assert.deepEqual(stale.continuation_case.reclassifiedDecision, stale.expected_decision);

const rootLeak = structuredClone(contract);
rootLeak.host_mapping = { capability: 'implementation-choice' };
assert.equal(validateContract(rootLeak), false, 'root contract must reject host mapping');

const fixtureLeak = structuredClone(fixtures.get('01-direct-localized-fix.json'));
fixtureLeak.expected_snapshot.adaptive.runtimeResolution = { 'text-search': 'host-native' };
assert.equal(validateFixture(fixtureLeak), false, 'fixture must reject implementation mapping');

const textLeak = structuredClone(fixtures.get('01-direct-localized-fix.json'));
textLeak.expected_decision.user_explanation.selected = 'package-lsp';
assert.equal(validateFixture(textLeak), false, 'fixture must reject implementation identifier text');

const fakeDigest = structuredClone(fixtures.get('01-direct-localized-fix.json'));
fakeDigest.expected_snapshot.adaptive.requestDigest = 'sha256:not-a-digest';
assert.equal(validateFixture(fakeDigest), false, 'fixture must reject fake digest');

const staleManifest = structuredClone(manifest);
staleManifest.fixtures[0].sha256 = '0'.repeat(64);
assert.match(relationshipErrors(staleManifest, fixtureBytes, fixtures, checksums).join('\n'), /manifest digest mismatch/);

const staleChecksums = new Map(checksums);
staleChecksums.set(manifest.fixtures[0].file, '0'.repeat(64));
assert.match(relationshipErrors(manifest, fixtureBytes, fixtures, staleChecksums).join('\n'), /checksum mismatch/);
assert.throws(() => JSON.parse('{'), SyntaxError);

const serializedFixtures = [...fixtureBytes.values()].map((bytes) => bytes.toString('utf8')).join('\n');
assert.doesNotMatch(serializedFixtures,
    /runtimeResolution|host-native|package-lsp|package-cli|package-loop-store|lsp-bridge|\/Users\/|\.worktrees\//);
NODE

printf 'PASS: v1.0.3 adaptive contract family\n'
