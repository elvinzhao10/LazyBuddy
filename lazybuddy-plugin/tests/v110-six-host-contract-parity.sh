#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<'USAGE'
Usage: v110-six-host-contract-parity.sh --lazybuddy-root ABSOLUTE_ROOT --lazytrae-root ABSOLUTE_ROOT

Run the bounded, read-only six-host parity gate against two clean Git roots.
Package evidence is not live-host evidence.
USAGE
}

LAZYBUDDY_ROOT=""
LAZYTRAE_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazybuddy-root)
            [ "$#" -ge 2 ] || fail "--lazybuddy-root requires a value"
            LAZYBUDDY_ROOT="$2"
            shift 2
            ;;
        --lazytrae-root)
            [ "$#" -ge 2 ] || fail "--lazytrae-root requires a value"
            LAZYTRAE_ROOT="$2"
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

case "$LAZYBUDDY_ROOT" in /*) ;; *) fail "--lazybuddy-root must be absolute" ;; esac
case "$LAZYTRAE_ROOT" in /*) ;; *) fail "--lazytrae-root must be absolute" ;; esac
[ -d "$LAZYBUDDY_ROOT" ] || fail "missing LazyBuddy root: $LAZYBUDDY_ROOT"
[ -d "$LAZYTRAE_ROOT" ] || fail "missing LazyTrae root: $LAZYTRAE_ROOT"
LAZYBUDDY_ROOT="$(cd "$LAZYBUDDY_ROOT" && pwd -P)"
LAZYTRAE_ROOT="$(cd "$LAZYTRAE_ROOT" && pwd -P)"
[ "$LAZYBUDDY_ROOT" != "$LAZYTRAE_ROOT" ] || fail "repository roots must differ: $LAZYBUDDY_ROOT"

validate_root() {
    local label="$1" root="$2" top status
    top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" || fail "malformed $label root: $root"
    top="$(cd "$top" && pwd -P)"
    [ "$top" = "$root" ] || fail "$label root is not the repository top level: $root"
    git -C "$root" rev-parse --verify HEAD^{commit} >/dev/null 2>&1 || fail "malformed $label root: $root"
    status="$(git -C "$root" status --porcelain --untracked-files=all)" || fail "cannot inspect $label root: $root"
    [ -z "$status" ] || fail "dirty $label root: $root"
}

validate_root "LazyBuddy" "$LAZYBUDDY_ROOT"
validate_root "LazyTrae" "$LAZYTRAE_ROOT"

BUDDY_PLUGIN="$LAZYBUDDY_ROOT/lazybuddy-plugin"
TRAE_CLI="$LAZYTRAE_ROOT/lazytrae-plugin/packages/cli"
BUDDY_CONTRACTS="$BUDDY_PLUGIN/contracts"
TRAE_CONTRACTS="$TRAE_CLI/contracts"
[ -f "$BUDDY_PLUGIN/tooling/package-lock.json" ] || fail "malformed LazyBuddy root: $BUDDY_PLUGIN/tooling/package-lock.json"
[ -f "$TRAE_CLI/package-lock.json" ] || fail "malformed LazyTrae root: $TRAE_CLI/package-lock.json"

RUNNER_PLUGIN="$(cd "$(dirname "$0")/.." && pwd -P)"
TOOLING_MODULES="${SIX_HOST_PARITY_NODE_MODULES:-$RUNNER_PLUGIN/tooling/node_modules}"
TIMEOUT="${SIX_HOST_PARITY_TIMEOUT_SECONDS:-120}"
[[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || fail "SIX_HOST_PARITY_TIMEOUT_SECONDS must be a positive integer"
[ -d "$TOOLING_MODULES/ajv" ] || fail "locked parity dependencies are not installed: $RUNNER_PLUGIN/tooling"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-six-host-parity.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

BUDDY_HEAD="$(git -C "$LAZYBUDDY_ROOT" rev-parse HEAD)"
BUDDY_TREE="$(git -C "$LAZYBUDDY_ROOT" rev-parse HEAD^{tree})"
TRAE_HEAD="$(git -C "$LAZYTRAE_ROOT" rev-parse HEAD)"
TRAE_TREE="$(git -C "$LAZYTRAE_ROOT" rev-parse HEAD^{tree})"

compare_file() {
    local relative="$1" buddy trae
    buddy="$BUDDY_CONTRACTS/$relative"
    trae="$TRAE_CONTRACTS/$relative"
    [ -f "$buddy" ] || fail "missing shared artifact: $buddy"
    [ -f "$trae" ] || fail "missing shared artifact: $trae"
    cmp -s "$buddy" "$trae" || fail "shared artifact drift: $buddy <> $trae"
}

SHARED_FILES=(
    lazyseries-capability-readiness.v1.json
    lazyseries-capability-readiness.v1.json.sha256
    fixtures/v017/readiness-records.json
    lazyseries-capability-readiness.v2.json
    lazyseries-capability-readiness.v2.json.sha256
    fixtures/readiness-v2/forged-current-session.json
    fixtures/readiness-v2/missing-evidence.json
    fixtures/readiness-v2/prompt-injection.json
    fixtures/readiness-v2/sha256sums.txt
    fixtures/readiness-v2/unknown-field.json
    fixtures/readiness-v2/unknown-version.json
    fixtures/readiness-v2/valid-package.json
    lazy-harness-lifecycle.v1.schema.json
    lazy-harness-lifecycle.v1.schema.json.sha256
    lazy-harness-lifecycle.v1.example.json
    lazy-harness-lifecycle.v1.example.json.sha256
    fixtures/lifecycle-v1/host-evidence-invalid.json
    fixtures/lifecycle-v1/identity-invalid.json
    fixtures/lifecycle-v1/malformed-json.json
    fixtures/lifecycle-v1/manifest.json
    fixtures/lifecycle-v1/ownership-invalid.json
    fixtures/lifecycle-v1/sha256sums.txt
    lazy-harness-active.v2.schema.json
    lazy-harness-active.v2.schema.json.sha256
    lazy-harness-lifecycle.v2.schema.json
    lazy-harness-lifecycle.v2.schema.json.sha256
    fixtures/lifecycle-v2/active-valid.json
    fixtures/lifecycle-v2/manifest.json
    fixtures/lifecycle-v2/receipt-valid.json
    fixtures/lifecycle-v2/sha256sums.txt
    fixtures/lifecycle-v2/version-adversarial.json
    host-evidence-contract.test.js
    lazyseries-canonical-event.v1.schema.json
    lazyseries-generated-mirror.v1.schema.json
    lazyseries-host-event-vocabulary.v1.json
    lazyseries-host-evidence-defs.v1.schema.json
    lazyseries-host-evidence.v1.js
    lazyseries-host-observation.v1.schema.json
    lazyseries-onboarding-receipt.v1.schema.json
    fixtures/host-evidence-v1/forged-authority.json
    fixtures/host-evidence-v1/forged-observed-pending-freshness.json
    fixtures/host-evidence-v1/malformed-event.json
    fixtures/host-evidence-v1/raw-prompt.json
    fixtures/host-evidence-v1/secret-payload.json
    fixtures/host-evidence-v1/stale-onboarding-receipt.json
    fixtures/host-evidence-v1/unsupported-event.json
    fixtures/host-evidence-v1/unsupported-onboarding-receipt.json
    fixtures/host-evidence-v1/valid-canonical-event.json
    fixtures/host-evidence-v1/valid-generated-mirror.json
    fixtures/host-evidence-v1/valid-host-observation.json
    fixtures/host-evidence-v1/valid-onboarding-receipt.json
    paired-candidate-contract.v1.schema.json
    paired-candidate-contract.v1.schema.json.sha256
    tests/paired-candidate-contract.test.js
    validate-paired-candidate.js
)

for relative in "${SHARED_FILES[@]}"; do
    compare_file "$relative"
done

verify_sidecar() {
    local file="$1" sidecar expected named actual
    sidecar="$file.sha256"
    expected="$(awk 'NR == 1 { print $1 }' "$sidecar")"
    named="$(awk 'NR == 1 { print $2 }' "$sidecar")"
    [ "$named" = "$(basename "$file")" ] || fail "malformed checksum sidecar: $sidecar"
    actual="$(shasum -a 256 "$file" | awk '{ print $1 }')"
    [ "$expected" = "$actual" ] || fail "checksum drift: $file"
}

for root in "$BUDDY_CONTRACTS" "$TRAE_CONTRACTS"; do
    verify_sidecar "$root/lazyseries-capability-readiness.v1.json"
    verify_sidecar "$root/lazyseries-capability-readiness.v2.json"
    verify_sidecar "$root/lazy-harness-lifecycle.v1.schema.json"
    verify_sidecar "$root/lazy-harness-lifecycle.v1.example.json"
    verify_sidecar "$root/lazy-harness-active.v2.schema.json"
    verify_sidecar "$root/lazy-harness-lifecycle.v2.schema.json"
    verify_sidecar "$root/paired-candidate-contract.v1.schema.json"
done

verify_fixture_sums() {
    local directory="$1" sums expected relative actual
    sums="$directory/sha256sums.txt"
    while read -r expected relative; do
        [ -n "$expected" ] || continue
        case "$relative" in ""|/*|*..*) fail "malformed fixture checksum path: $sums" ;; esac
        [ -f "$directory/$relative" ] || fail "missing checksummed fixture: $directory/$relative"
        actual="$(shasum -a 256 "$directory/$relative" | awk '{ print $1 }')"
        [ "$expected" = "$actual" ] || fail "fixture checksum drift: $directory/$relative"
    done < "$sums"
}

for root in "$BUDDY_CONTRACTS" "$TRAE_CONTRACTS"; do
    verify_fixture_sums "$root/fixtures/readiness-v2"
    verify_fixture_sums "$root/fixtures/lifecycle-v1"
    verify_fixture_sums "$root/fixtures/lifecycle-v2"
done

node - "$LAZYBUDDY_ROOT" "$LAZYTRAE_ROOT" "${SHARED_FILES[@]}" <<'NODE'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [buddyRoot, traeRoot, ...sharedFiles] = process.argv.slice(2);
const buddyContracts = path.join(buddyRoot, 'lazybuddy-plugin', 'contracts');
const traeContracts = path.join(traeRoot, 'lazytrae-plugin', 'packages', 'cli', 'contracts');
const fail = (message) => { process.stderr.write(`FAIL: ${message}\n`); process.exit(1); };
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`invalid JSON: ${file}: ${error.message}`); }
};

for (const root of [buddyContracts, traeContracts]) {
  for (const relative of sharedFiles.filter((file) => file.endsWith('.json') && file !== 'fixtures/lifecycle-v1/malformed-json.json')) {
    readJson(path.join(root, relative));
  }
}

const versionFiles = [
  [path.join(buddyRoot, 'lazybuddy-plugin', '.codebuddy-plugin', 'plugin.json'), (value) => value.version],
  [path.join(buddyRoot, 'lazybuddy-plugin', '.workbuddy-plugin', 'plugin.json'), (value) => value.version],
  [path.join(buddyRoot, 'lazybuddy-plugin', 'tooling', 'package.json'), (value) => value.version],
  [path.join(buddyRoot, '.codebuddy-plugin', 'marketplace.json'), (value) => value.plugins?.[0]?.version],
  [path.join(traeRoot, 'lazytrae-plugin', 'packages', 'cli', 'package.json'), (value) => value.version],
  [path.join(traeRoot, 'lazytrae-plugin', 'packages', 'cli', 'tooling', 'package.json'), (value) => value.version],
  [path.join(traeRoot, 'lazytrae-plugin', 'packages', 'mcp', 'package.json'), (value) => value.version],
];
const [authorityFile, authoritySelector] = versionFiles[0];
const version = authoritySelector(readJson(authorityFile));
if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail(`invalid authoritative version: ${authorityFile}`);
for (const [file, select] of versionFiles) {
  if (select(readJson(file)) !== version) fail(`authoritative version drift: ${file}`);
}
for (const root of [buddyRoot, traeRoot]) {
  const releaseNote = path.join(root, `RELEASE_NOTES-v${version}.md`);
  if (!fs.statSync(releaseNote, { throwIfNoEntry: false })?.isFile()) fail(`missing current release note: ${releaseNote}`);
}

const requiredTerms = [
  'Package readiness', 'Host observation', 'Local-first', 'Package-built capability',
  'Host-native capability', 'Base MCP declaration', 'Tooling dependency',
];
for (const root of [buddyRoot, traeRoot]) {
  const file = path.join(root, 'docs', 'reference', 'terminology.md');
  const terms = new Set(fs.readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    const match = line.match(/^\| \*\*(.+?)\*\* \|/);
    return match ? [match[1].replaceAll('`', '')] : [];
  }));
  for (const term of requiredTerms) if (!terms.has(term)) fail(`structured terminology drift: ${file}: ${term}`);
}
process.stdout.write(`versions and structured terminology: PASS (${version})\n`);
NODE

run_bounded() {
    local label="$1" stdout="$TMP/$1.stdout" stderr="$TMP/$1.stderr" status
    shift
    set +e
    perl -MPOSIX=:sys_wait_h -e '
        use strict;
        use warnings;
        my $timeout = shift @ARGV;
        my $pid = fork();
        die "fork failed: $!" unless defined $pid;
        if ($pid == 0) {
            setpgrp(0, 0) or die "setpgrp failed: $!";
            exec @ARGV;
            die "exec failed: $!";
        }
        my $stop = sub {
            kill "TERM", -$pid;
            select undef, undef, undef, 0.2;
            kill "KILL", -$pid;
            waitpid($pid, 0);
        };
        $SIG{INT} = sub { $stop->(); exit 130; };
        $SIG{TERM} = sub { $stop->(); exit 130; };
        $SIG{HUP} = sub { $stop->(); exit 130; };
        my $deadline = time + $timeout;
        while (1) {
            my $done = waitpid($pid, WNOHANG);
            if ($done == $pid) {
                my $child_status = $?;
                exit 1 if $child_status & 127;
                exit($child_status >> 8);
            }
            if (time >= $deadline) {
                $stop->();
                print STDERR "TIMEOUT: bounded validator exceeded ${timeout}s\n";
                exit 124;
            }
            select undef, undef, undef, 0.05;
        }
    ' "$TIMEOUT" "$@" >"$stdout" 2>"$stderr"
    status=$?
    set -e
    cat "$stdout"
    cat "$stderr" >&2
    if [ "$status" -ne 0 ]; then
        fail "bounded validator failed: $label"
    fi
}

run_bounded "v017-readiness" bash "$RUNNER_PLUGIN/tests/v017-capability-readiness-contract-parity.sh" \
    --lazybuddy-root "$LAZYBUDDY_ROOT" --lazytrae-root "$LAZYTRAE_ROOT"
run_bounded "v2-readiness" bash "$RUNNER_PLUGIN/tests/v2-capability-readiness-contract-parity.sh" \
    --lazybuddy-root "$LAZYBUDDY_ROOT" --lazytrae-root "$LAZYTRAE_ROOT"
run_bounded "buddy-lifecycle-v1" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$BUDDY_PLUGIN/tests/lifecycle-contract.test.js"
run_bounded "trae-lifecycle-v1" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$TRAE_CLI/test/lifecycle-contract.test.js"
run_bounded "buddy-lifecycle-v2" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$BUDDY_PLUGIN/tests/lifecycle-v2-contract.test.js" "$BUDDY_PLUGIN/tests/lifecycle-v2.test.js"
run_bounded "trae-lifecycle-v2" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$TRAE_CLI/test/lifecycle-v2-contract.test.js" "$TRAE_CLI/test/lifecycle-v2.test.js"
run_bounded "buddy-host-evidence" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$BUDDY_CONTRACTS/host-evidence-contract.test.js"
run_bounded "trae-host-evidence" env NODE_PATH="$TOOLING_MODULES" node --test \
    "$TRAE_CONTRACTS/host-evidence-contract.test.js"
run_bounded "paired-candidate-schema" env NODE_PATH="$TOOLING_MODULES" node -e '
    const fs = require("node:fs");
    const Ajv2020 = require("ajv/dist/2020");
    const schema = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    new Ajv2020({ allErrors: true, strict: false }).compile(schema);
' "$BUDDY_CONTRACTS/paired-candidate-contract.v1.schema.json"
[ "$(git -C "$LAZYBUDDY_ROOT" rev-parse HEAD)" = "$BUDDY_HEAD" ] || fail "LazyBuddy HEAD mutated: $LAZYBUDDY_ROOT"
[ "$(git -C "$LAZYBUDDY_ROOT" rev-parse HEAD^{tree})" = "$BUDDY_TREE" ] || fail "LazyBuddy tree mutated: $LAZYBUDDY_ROOT"
[ -z "$(git -C "$LAZYBUDDY_ROOT" status --porcelain --untracked-files=all)" ] || fail "LazyBuddy root mutated: $LAZYBUDDY_ROOT"
[ "$(git -C "$LAZYTRAE_ROOT" rev-parse HEAD)" = "$TRAE_HEAD" ] || fail "LazyTrae HEAD mutated: $LAZYTRAE_ROOT"
[ "$(git -C "$LAZYTRAE_ROOT" rev-parse HEAD^{tree})" = "$TRAE_TREE" ] || fail "LazyTrae tree mutated: $LAZYTRAE_ROOT"
[ -z "$(git -C "$LAZYTRAE_ROOT" status --porcelain --untracked-files=all)" ] || fail "LazyTrae root mutated: $LAZYTRAE_ROOT"

printf 'PASS: bounded explicit-root six-host parity (Buddy %s, Trae %s)\n' "$BUDDY_HEAD" "$TRAE_HEAD"
