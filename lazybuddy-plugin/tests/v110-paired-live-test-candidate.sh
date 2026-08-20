#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

BUDDY_ROOT=""
TRAE_ROOT=""
BUDDY_ARTIFACTS=""
TRAE_ARTIFACTS=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazybuddy-root) BUDDY_ROOT="${2:-}"; shift 2 ;;
        --lazytrae-root) TRAE_ROOT="${2:-}"; shift 2 ;;
        --lazybuddy-artifact-root) BUDDY_ARTIFACTS="${2:-}"; shift 2 ;;
        --lazytrae-artifact-root) TRAE_ARTIFACTS="${2:-}"; shift 2 ;;
        *) fail "unknown argument: $1" ;;
    esac
done
for value in "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS"; do
    case "$value" in /*) ;; *) fail "all roots must be absolute" ;; esac
done

SCRIPT="$(cd "$(dirname "$0")/../scripts" && pwd -P)/paired-live-test-candidate.js"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/paired-live-test-regression.XXXXXX")"
trap 'chmod -R u+w "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT HUP INT TERM

assemble() {
    node "$SCRIPT" assemble \
        --lazybuddy-root "$1" --lazytrae-root "$2" \
        --lazybuddy-artifact-root "$3" --lazytrae-artifact-root "$4" \
        --output-root "$5"
}

expect_failure() {
    local label="$1" expected="$2"
    shift 2
    set +e
    "$@" >"$TMP/$label.out" 2>"$TMP/$label.err"
    local rc=$?
    set -e
    [ "$rc" -ne 0 ] || fail "$label unexpectedly passed"
    grep -F "$expected" "$TMP/$label.err" >/dev/null || {
        cat "$TMP/$label.err" >&2
        fail "$label omitted $expected"
    }
    printf 'PASS: %s refused rc=%s code=%s\n' "$label" "$rc" "$expected"
}

for run in a b c d e; do
    mkdir "$TMP/out-$run"
    result="$(assemble "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/out-$run")"
    candidate_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).candidate_path)' "$result")"
    if [ "$run" = a ]; then
        first_path="$candidate_path"
    else
        [ "$(basename "$first_path")" = "$(basename "$candidate_path")" ] || fail "nondeterministic candidate name on run $run"
        diff -r "$first_path" "$candidate_path" >/dev/null || fail "nondeterministic candidate bytes on run $run"
    fi
done
node "$SCRIPT" verify --candidate "$first_path" >/dev/null
expect_failure existing-destination DESTINATION_EXISTS assemble \
    "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/out-a"

mkdir "$TMP/concurrent-out"
set +e
assemble "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/concurrent-out" >"$TMP/concurrent-1.out" 2>"$TMP/concurrent-1.err" &
pid1=$!
assemble "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/concurrent-out" >"$TMP/concurrent-2.out" 2>"$TMP/concurrent-2.err" &
pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
[ $(( (rc1 == 0) + (rc2 == 0) )) -eq 1 ] || fail "concurrent assembly did not produce exactly one winner: $rc1/$rc2"
grep -F DESTINATION_EXISTS "$TMP/concurrent-1.err" "$TMP/concurrent-2.err" >/dev/null || fail "concurrent loser omitted DESTINATION_EXISTS"
[ "$(find "$TMP/concurrent-out" -maxdepth 1 -type d -name 'live-test-v1.1.0-*' | wc -l | tr -d ' ')" = 2 ] || fail "concurrent assembly published partial layout"

mkdir "$TMP/crash-out"
expect_failure crash-before-rename INJECTED_FAILURE env LAZYBUDDY_PAIRED_FAIL_BEFORE_RENAME=1 \
    node "$SCRIPT" assemble --lazybuddy-root "$BUDDY_ROOT" --lazytrae-root "$TRAE_ROOT" \
    --lazybuddy-artifact-root "$BUDDY_ARTIFACTS" --lazytrae-artifact-root "$TRAE_ARTIFACTS" \
    --output-root "$TMP/crash-out"
[ -z "$(find "$TMP/crash-out" -mindepth 1 -print -quit)" ] || fail "crash left output residue"

copy_artifacts() {
    local name="$1"
    mkdir "$TMP/$name-buddy" "$TMP/$name-trae"
    cp -R "$BUDDY_ARTIFACTS/." "$TMP/$name-buddy/"
    cp -R "$TRAE_ARTIFACTS/." "$TMP/$name-trae/"
}

for kind in symlink hardlink fifo; do
    copy_artifacts "$kind"
    target="$TMP/$kind-buddy/injected"
    case "$kind" in
        symlink) ln -s /dev/null "$target" ;;
        hardlink) ln "$TMP/$kind-buddy/manifest.json" "$target" ;;
        fifo) mkfifo "$target" ;;
    esac
    mkdir "$TMP/$kind-out"
    expected=LINKED_FILE
    [ "$kind" = fifo ] && expected=NONREGULAR_FILE
    expect_failure "$kind" "$expected" assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
        "$TMP/$kind-buddy" "$TMP/$kind-trae" "$TMP/$kind-out"
done

copy_artifacts digest
printf 'x' >> "$TMP/digest-buddy/lazybuddy-v1.1.0.tar.gz"
mkdir "$TMP/digest-out"
expect_failure digest-mismatch ARCHIVE_DIGEST_MISMATCH assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
    "$TMP/digest-buddy" "$TMP/digest-trae" "$TMP/digest-out"

copy_artifacts moved
mv "$TMP/moved-trae/lazytrae-ai-v1.1.0.tgz" "$TMP/moved-trae/moved.tgz"
mkdir "$TMP/moved-out"
expect_failure moved-artifact MISSING_ARTIFACT assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
    "$TMP/moved-buddy" "$TMP/moved-trae" "$TMP/moved-out"

git clone --quiet --shared "$BUDDY_ROOT" "$TMP/dirty-buddy"
printf 'dirty\n' > "$TMP/dirty-buddy/untracked"
mkdir "$TMP/dirty-out"
expect_failure dirty-source DIRTY_SOURCE assemble "$TMP/dirty-buddy" "$TRAE_ROOT" \
    "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/dirty-out"

git clone --quiet --shared "$BUDDY_ROOT" "$TMP/wrong-buddy"
git -C "$TMP/wrong-buddy" -c user.name=Fixture -c user.email=fixture.invalid commit --allow-empty -m wrong >/dev/null
mkdir "$TMP/wrong-out"
expect_failure wrong-source SOURCE_SHA_MISMATCH assemble "$TMP/wrong-buddy" "$TRAE_ROOT" \
    "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$TMP/wrong-out"

injection_out="$TMP/path with spaces ; touch SHOULD_NOT_EXIST"
mkdir "$injection_out"
assemble "$BUDDY_ROOT" "$TRAE_ROOT" "$BUDDY_ARTIFACTS" "$TRAE_ARTIFACTS" "$injection_out" >/dev/null
[ ! -e "$TMP/SHOULD_NOT_EXIST" ] || fail "shell-shaped output path executed"

if grep -E "require\(['\"].*lazytrae|spawnSync\([^,]+,.*lazytrae" "$SCRIPT" "$(dirname "$SCRIPT")/paired-live-test-lib.js" >/dev/null; then
    fail "assembler imports or executes LazyTrae runtime code"
fi

tampered="$first_path/LazyBuddy/lazybuddy-v1.1.0.tar.gz"
chmod u+w "$tampered"
printf 'x' >> "$tampered"
chmod 0444 "$tampered"
expect_failure final-tamper "LazyBuddy/lazybuddy-v1.1.0.tar.gz" \
    node "$SCRIPT" verify --candidate "$first_path"

printf 'PASS: paired live-test candidate assembler boundary\n'
