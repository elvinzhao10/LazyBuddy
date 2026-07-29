#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: v103-lifecycle-contract-parity.sh --lazytrae-root ABSOLUTE_ROOT --lazybuddy-root ABSOLUTE_ROOT

Validate the lifecycle v1 contracts, CLI surface, durable layout, platform
fixtures, documentation, and v1.0.3 values from two explicit repository roots.

This is package evidence only. It does not inspect or claim host readiness.
USAGE
}

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

LAZYTRAE_ROOT=""
LAZYBUDDY_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazytrae-root)
            [ "$#" -ge 2 ] || fail "--lazytrae-root requires a value"
            LAZYTRAE_ROOT="$2"
            shift 2
            ;;
        --lazybuddy-root)
            [ "$#" -ge 2 ] || fail "--lazybuddy-root requires a value"
            LAZYBUDDY_ROOT="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "unknown argument: $1"
            ;;
    esac
done

[ -n "$LAZYTRAE_ROOT" ] || { usage >&2; fail "--lazytrae-root is required"; }
[ -n "$LAZYBUDDY_ROOT" ] || { usage >&2; fail "--lazybuddy-root is required"; }
case "$LAZYTRAE_ROOT" in /*) ;; *) fail "--lazytrae-root must be absolute" ;; esac
case "$LAZYBUDDY_ROOT" in /*) ;; *) fail "--lazybuddy-root must be absolute" ;; esac
[ -d "$LAZYTRAE_ROOT" ] || fail "missing LazyTrae root: $LAZYTRAE_ROOT"
[ -d "$LAZYBUDDY_ROOT" ] || fail "missing LazyBuddy root: $LAZYBUDDY_ROOT"

LAZYTRAE_ROOT="$(cd "$LAZYTRAE_ROOT" && pwd -P)"
LAZYBUDDY_ROOT="$(cd "$LAZYBUDDY_ROOT" && pwd -P)"
TRAE_CLI="$LAZYTRAE_ROOT/lazytrae-plugin/packages/cli"
BUDDY_PLUGIN="$LAZYBUDDY_ROOT/lazybuddy-plugin"
TRAE_CONTRACTS="$TRAE_CLI/contracts"
BUDDY_CONTRACTS="$BUDDY_PLUGIN/contracts"

[ -f "$TRAE_CLI/package.json" ] || fail "misconfigured LazyTrae root"
[ -f "$BUDDY_PLUGIN/tests/lifecycle-contract.test.js" ] || fail "misconfigured LazyBuddy root"
[ -d "$TRAE_CLI/node_modules/ajv" ] || fail "LazyTrae contract dependencies are not installed"

(cd "$TRAE_CLI" && node --test test/lifecycle-contract.test.js)
NODE_PATH="$TRAE_CLI/node_modules" node --test "$BUDDY_PLUGIN/tests/lifecycle-contract.test.js"
(cd "$TRAE_CLI" && node --test \
    test/lifecycle-core.test.js \
    test/lifecycle-command.test.js \
    test/lifecycle-platform-fixtures.test.js)
NODE_PATH="$TRAE_CLI/node_modules" node --test \
    "$BUDDY_PLUGIN/tests/lifecycle-core.test.js" \
    "$BUDDY_PLUGIN/tests/lifecycle-entrypoint.test.js" \
    "$BUDDY_PLUGIN/tests/lifecycle-platform-fixtures.test.js"

for artifact in \
    lazy-harness-lifecycle.v1.schema.json \
    lazy-harness-lifecycle.v1.schema.json.sha256 \
    lazy-harness-lifecycle.v1.example.json \
    lazy-harness-lifecycle.v1.example.json.sha256
do
    cmp -s "$TRAE_CONTRACTS/$artifact" "$BUDDY_CONTRACTS/$artifact" ||
        fail "mirrored lifecycle artifact differs: $artifact"
done

diff -ru "$TRAE_CONTRACTS/fixtures/lifecycle-v1" \
    "$BUDDY_CONTRACTS/fixtures/lifecycle-v1" >/dev/null ||
    fail "mirrored lifecycle fixtures differ"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazyseries-lifecycle-parity.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
PROJECT="$TMP/project with spaces"
INSTALL_ROOT="$TMP/durable root with spaces"
mkdir "$PROJECT"

TRAE_CLI_ENTRY="$TRAE_CLI/bin/lazytrae.js"
BUDDY_CLI_ENTRY="$BUDDY_PLUGIN/scripts/lazybuddy-lifecycle.js"
node "$TRAE_CLI_ENTRY" lifecycle --help > "$TMP/trae-help"
node "$BUDDY_CLI_ENTRY" --help > "$TMP/buddy-help"
node "$TRAE_CLI_ENTRY" lifecycle status \
    --install-root "$INSTALL_ROOT" --project "$PROJECT" --json > "$TMP/trae-status.json"
node "$BUDDY_CLI_ENTRY" status \
    --install-root "$INSTALL_ROOT" --project "$PROJECT" --json > "$TMP/buddy-status.json"

set +e
node "$TRAE_CLI_ENTRY" lifecycle status \
    --install-root "$INSTALL_ROOT" --project "$PROJECT" --json --unknown \
    > "$TMP/trae-error.json" 2> "$TMP/trae-error.stderr"
TRAE_ERROR_CODE=$?
node "$BUDDY_CLI_ENTRY" status \
    --install-root "$INSTALL_ROOT" --project "$PROJECT" --json --unknown \
    > "$TMP/buddy-error.json" 2> "$TMP/buddy-error.stderr"
BUDDY_ERROR_CODE=$?
set -e
[ "$TRAE_ERROR_CODE" -eq 1 ] || fail "LazyTrae malformed option exit code differs: $TRAE_ERROR_CODE"
[ "$BUDDY_ERROR_CODE" -eq 1 ] || fail "LazyBuddy malformed option exit code differs: $BUDDY_ERROR_CODE"

node - "$LAZYTRAE_ROOT" "$LAZYBUDDY_ROOT" "$TMP" "$INSTALL_ROOT" "$PROJECT" <<'NODE'
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [traeRoot, buddyRoot, outputRoot, installRoot, projectRoot] = process.argv.slice(2);
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));
const fail = (message) => {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
};

try {
  const statusFiles = ['trae-status.json', 'buddy-status.json'];
  const statuses = statusFiles.map((file) => json(path.join(outputRoot, file)));
  const commonFields = [
    'schema_version', 'product', 'command', 'status', 'package_readiness',
    'host_readiness', 'install_root', 'project_root',
  ];
  for (const [index, report] of statuses.entries()) {
    assert.deepEqual(Object.keys(report), commonFields, `${statusFiles[index]} common JSON fields`);
    assert.equal(report.schema_version, 1);
    assert.equal(report.command, 'status');
    assert.equal(report.status, 'absent');
    assert.deepEqual(report.package_readiness, { status: 'absent' });
    assert.deepEqual(report.host_readiness, { status: 'pending' });
    assert.equal(report.install_root, path.resolve(installRoot));
    assert.equal(report.project_root, fs.realpathSync(projectRoot));
  }
  assert.deepEqual(statuses.map(({ product }) => product), ['LazyTrae', 'LazyBuddy']);

  for (const file of ['trae-error.json', 'buddy-error.json']) {
    const report = json(path.join(outputRoot, file));
    assert.equal(report.schema_version, 1, `${file} schema version`);
    assert.equal(report.command, 'status', `${file} command`);
    assert.equal(report.status, 'error', `${file} status`);
    assert.equal(report.error.code, 'INVALID_ARGUMENT', `${file} error code`);
  }

  for (const file of ['trae-help', 'buddy-help']) {
    const help = read(path.join(outputRoot, file));
    for (const token of [
      'onboard', 'update', 'status', 'offboard', '--install-root', '--project',
      '--json', '--source', '--confirm-revision', '--yes',
    ]) {
      assert.ok(help.includes(token), `${file} missing help token ${token}`);
    }
  }

  const traePackage = json(path.join(
    traeRoot, 'lazytrae-plugin', 'packages', 'cli', 'package.json',
  ));
  const buddyTooling = json(path.join(
    buddyRoot, 'lazybuddy-plugin', 'tooling', 'package.json',
  ));
  assert.equal(traePackage.version, '1.0.3', 'LazyTrae package version');
  assert.equal(buddyTooling.version, '1.0.3', 'LazyBuddy tooling version');
  assert.ok(read(path.join(outputRoot, 'buddy-help')).includes('v1.0.3'));

  const requiredHeadings = new Map([
    ['README.md', ['## Install and onboard', '## Verify and remove']],
    ['RELEASE_NOTES-v1.0.3.md', ['## Durable package lifecycle', '## Cross-repo parity']],
    ['docs/v1.0.3-migration-guide.md', [
      '## v1.0.2 to v1.0.3',
      '## Node runtime refresh',
      '## Filesystem and platform limits',
    ]],
  ]);
  for (const [relative, headings] of requiredHeadings) {
    for (const [product, root] of [['LazyTrae', traeRoot], ['LazyBuddy', buddyRoot]]) {
      const content = read(path.join(root, relative));
      assert.ok(content.includes('v1.0.3'), `${product} ${relative} omits v1.0.3`);
      for (const heading of headings) {
        assert.ok(content.split('\n').includes(heading),
          `${product} ${relative} missing paired heading: ${heading}`);
      }
    }
  }

  const expectedLayout = [
    'active.json', 'launcher.js', 'releases/', 'receipts/', 'rollback/',
    'staging/', 'locks/',
  ];
  for (const [product, root] of [['LazyTrae', traeRoot], ['LazyBuddy', buddyRoot]]) {
    const docs = `${read(path.join(root, 'README.md'))}\n`
      + read(path.join(root, 'docs/v1.0.3-migration-guide.md'));
    for (const entry of expectedLayout) {
      assert.ok(docs.includes(entry), `${product} durable layout omits ${entry}`);
    }
    assert.match(
      docs,
      /Windows[\s\S]*%LOCALAPPDATA%\\LazySeries/,
      `${product} omits the Windows path fixture`,
    );
    assert.match(docs, /does not simulate\s+host readiness/,
      `${product} platform limits overclaim host readiness`);
  }

  const windowsRoot = 'C:\\Users\\Example Person\\AppData\\Local\\LazySeries';
  assert.equal(path.win32.isAbsolute(windowsRoot), true);
  assert.equal(path.win32.join(windowsRoot, 'LazyTrae'),
    'C:\\Users\\Example Person\\AppData\\Local\\LazySeries\\LazyTrae');
  assert.equal(path.win32.join(windowsRoot, 'LazyBuddy'),
    'C:\\Users\\Example Person\\AppData\\Local\\LazySeries\\LazyBuddy');
} catch (error) {
  fail(error.message);
}
NODE

echo "PASS: explicit-root lifecycle v1 parity (contracts, CLI, layout, docs, platform fixtures)"
