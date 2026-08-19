#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

BUDDY_ROOT=""
TRAE_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazybuddy-root) BUDDY_ROOT="${2:-}"; shift 2 ;;
        --lazytrae-root) TRAE_ROOT="${2:-}"; shift 2 ;;
        *) fail "unknown argument: $1" ;;
    esac
done
case "$BUDDY_ROOT" in /*) ;; *) fail "--lazybuddy-root must be absolute" ;; esac
case "$TRAE_ROOT" in /*) ;; *) fail "--lazytrae-root must be absolute" ;; esac
[ -d "$BUDDY_ROOT" ] || fail "missing LazyBuddy root: $BUDDY_ROOT"
[ -d "$TRAE_ROOT" ] || fail "missing LazyTrae root: $TRAE_ROOT"
BUDDY_ROOT="$(cd "$BUDDY_ROOT" && pwd -P)"
TRAE_ROOT="$(cd "$TRAE_ROOT" && pwd -P)"
AGGREGATE="$(cd "$(dirname "$0")" && pwd -P)/v110-six-host-contract-parity.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-six-host-regression.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

clone_trae() {
    local name="$1" root
    root="$TMP/$name"
    git clone --quiet --shared "$TRAE_ROOT" "$root"
    printf '%s\n' "$root"
}

commit_mutation() {
    local root="$1"
    git -C "$root" add -A
    git -C "$root" -c user.name=Parity -c user.email=parity.invalid commit --quiet -m fixture
}

expect_failure() {
    local label="$1" root="$2" affected="$3" output status
    output="$TMP/$label.log"
    set +e
    SIX_HOST_PARITY_TIMEOUT_SECONDS="${4:-20}" bash "$AGGREGATE" \
        --lazybuddy-root "$BUDDY_ROOT" --lazytrae-root "$root" >"$output" 2>&1
    status=$?
    set -e
    [ "$status" -ne 0 ] || fail "$label unexpectedly passed"
    grep -F "$affected" "$output" >/dev/null || {
        cat "$output" >&2
        fail "$label omitted affected path: $affected"
    }
    printf 'PASS: %s rejected rc=%s path=%s\n' "$label" "$status" "$affected"
}

mutate_byte() {
    local root="$1" relative="$2"
    perl -0pi -e 'substr($_, 0, 1) = substr($_, 0, 1) eq "{" ? "[" : "{"' "$root/$relative"
    commit_mutation "$root"
    expect_failure "$(printf '%s' "$relative" | tr '/.' '__')" "$root" "$root/$relative"
}

root="$(clone_trae readiness-v2)"
mutate_byte "$root" lazytrae-plugin/packages/cli/contracts/lazyseries-capability-readiness.v2.json

root="$(clone_trae lifecycle-v2)"
mutate_byte "$root" lazytrae-plugin/packages/cli/contracts/lazy-harness-lifecycle.v2.schema.json

root="$(clone_trae event-schema)"
mutate_byte "$root" lazytrae-plugin/packages/cli/contracts/lazyseries-canonical-event.v1.schema.json

root="$(clone_trae evidence-schema)"
mutate_byte "$root" lazytrae-plugin/packages/cli/contracts/lazyseries-host-observation.v1.schema.json

root="$(clone_trae candidate-schema)"
mutate_byte "$root" lazytrae-plugin/packages/cli/contracts/paired-candidate-contract.v1.schema.json

root="$(clone_trae host-ids)"
host_file="$root/lazytrae-plugin/packages/cli/contracts/lazyseries-host-event-vocabulary.v1.json"
perl -0pi -e 's/"trae-cli"/"trae-clx"/' "$host_file"
commit_mutation "$root"
expect_failure host-ids "$root" "$host_file"

root="$(clone_trae missing-v1-migration)"
migration_file="$root/lazytrae-plugin/packages/cli/contracts/fixtures/lifecycle-v1/manifest.json"
git -C "$root" rm --quiet "$migration_file"
commit_mutation "$root"
expect_failure missing-v1-migration "$root" "$migration_file"

root="$(clone_trae sidecar)"
sidecar="$root/lazytrae-plugin/packages/cli/contracts/lazy-harness-active.v2.schema.json.sha256"
perl -0pi -e 'substr($_, 0, 1) = substr($_, 0, 1) eq "0" ? "1" : "0"' "$sidecar"
commit_mutation "$root"
expect_failure sidecar "$root" "$sidecar"

root="$(clone_trae version)"
version_file="$root/lazytrae-plugin/packages/cli/package.json"
node -e 'const fs=require("node:fs");const file=process.argv[1];const value=JSON.parse(fs.readFileSync(file));value.version="1.1.1";fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);' "$version_file"
commit_mutation "$root"
expect_failure version "$root" "$version_file"

root="$(clone_trae terminology)"
terms_file="$root/docs/reference/terminology.md"
perl -0pi -e 's/Host-native capability/Host native capability/' "$terms_file"
commit_mutation "$root"
expect_failure terminology "$root" "$terms_file"

root="$(clone_trae dirty)"
printf '\n' >> "$root/docs/reference/terminology.md"
expect_failure dirty "$root" "$root"

mkdir "$TMP/malformed"
expect_failure malformed "$TMP/malformed" "$TMP/malformed"
expect_failure missing "$TMP/absent" "$TMP/absent"

root="$(clone_trae misleading)"
test_file="$root/lazytrae-plugin/packages/cli/test/lifecycle-v2-contract.test.js"
printf '\nprocess.stderr.write("PASS: misleading child\\n"); process.exitCode = 7;\n' >> "$test_file"
commit_mutation "$root"
expect_failure misleading "$root" "bounded validator failed: trae-lifecycle-v2"
grep -F 'PASS: misleading child' "$TMP/misleading.log" >/dev/null || fail "misleading child marker was not exercised"

root="$(clone_trae hung)"
test_file="$root/lazytrae-plugin/packages/cli/test/lifecycle-v2-contract.test.js"
printf '\nsetInterval(() => {}, 1000);\n' >> "$test_file"
commit_mutation "$root"
expect_failure hung "$root" 'TIMEOUT: bounded validator exceeded 1s' 1

printf 'PASS: six-host parity adversarial boundary regression\n'
