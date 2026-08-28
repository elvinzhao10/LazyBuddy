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
socket_pid=""
socket_base=""
cleanup() {
    if [ -n "$socket_pid" ]; then
        kill "$socket_pid" 2>/dev/null || true
        wait "$socket_pid" 2>/dev/null || true
    fi
    if [ -n "$socket_base" ]; then
        chmod -R u+w "$socket_base" 2>/dev/null || true
        rm -rf "$socket_base"
    fi
    chmod -R u+w "$TMP" 2>/dev/null || true
    rm -rf "$TMP"
}
trap cleanup EXIT HUP INT TERM

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
[ "$(find "$TMP/concurrent-out" -maxdepth 1 -type d -name 'live-test-v1.2.0-*' | wc -l | tr -d ' ')" = 2 ] || fail "concurrent assembly published partial layout"

mkdir "$TMP/crash-out"
expect_failure crash-before-rename INJECTED_FAILURE env LAZYBUDDY_PAIRED_FAIL_BEFORE_RENAME=1 \
    node "$SCRIPT" assemble --lazybuddy-root "$BUDDY_ROOT" --lazytrae-root "$TRAE_ROOT" \
    --lazybuddy-artifact-root "$BUDDY_ARTIFACTS" --lazytrae-artifact-root "$TRAE_ARTIFACTS" \
    --output-root "$TMP/crash-out"
[ -z "$(find "$TMP/crash-out" -mindepth 1 -print -quit)" ] || fail "crash left output residue"

mkdir "$TMP/signal-bin" "$TMP/signal-out"
signal_ready="$TMP/signal-ready"
signal_count="$TMP/signal-count"
signal_child_pid="$TMP/signal-child-pid"
printf '%s\n' '#!/bin/sh' 'set -eu' \
    'count=$(cat "$TODO33_GIT_COUNT" 2>/dev/null || printf 0)' \
    'count=$((count + 1))' \
    'printf "%s\\n" "$count" > "$TODO33_GIT_COUNT"' \
    'if [ "$count" -eq 9 ]; then' \
    '  printf "%s\\n" "$$" > "$TODO33_GIT_CHILD_PID"' \
    '  : > "$TODO33_GIT_READY"' \
    '  sleep 5' \
    'fi' \
    'exec /usr/bin/git "$@"' > "$TMP/signal-bin/git"
chmod 0755 "$TMP/signal-bin/git"
PATH="$TMP/signal-bin:$PATH" TODO33_GIT_COUNT="$signal_count" TODO33_GIT_CHILD_PID="$signal_child_pid" TODO33_GIT_READY="$signal_ready" \
    node "$SCRIPT" assemble --lazybuddy-root "$BUDDY_ROOT" --lazytrae-root "$TRAE_ROOT" \
    --lazybuddy-artifact-root "$BUDDY_ARTIFACTS" --lazytrae-artifact-root "$TRAE_ARTIFACTS" \
    --output-root "$TMP/signal-out" >"$TMP/signal.out" 2>"$TMP/signal.err" &
signal_pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ -f "$signal_ready" ] && break
    sleep 0.1
done
[ -f "$signal_ready" ] || fail "signal fixture did not reach the second source check"
kill -TERM "$signal_pid"
set +e
wait "$signal_pid"
signal_rc=$?
set -e
[ "$signal_rc" -eq 143 ] || fail "SIGTERM exit was $signal_rc, expected 143"
grep -F 'ASSEMBLY_INTERRUPTED: SIGTERM' "$TMP/signal.err" >/dev/null || fail "SIGTERM omitted interruption code"
[ -z "$(find "$TMP/signal-out" -mindepth 1 -print -quit)" ] || fail "SIGTERM left output residue"
signal_child="$(cat "$signal_child_pid")"
sleep 0.1
! kill -0 "$signal_child" 2>/dev/null || fail "SIGTERM left bounded git child $signal_child"
printf 'PASS: real SIGTERM cleaned owned stage, lock, and git child\n'

copy_artifacts() {
    local name="$1"
    mkdir "$TMP/$name-buddy" "$TMP/$name-trae"
    cp -R "$BUDDY_ARTIFACTS/." "$TMP/$name-buddy/"
    cp -R "$TRAE_ARTIFACTS/." "$TMP/$name-trae/"
}

set_manifest_archive_path() {
    local root="$1" product="$2" archive_path="$3"
    node -e '
const fs = require("node:fs");
const [root, product, archive] = process.argv.slice(1);
const manifestPath = `${root}/manifest.json`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const value = archive === "__NUL__" ? "\0" : archive;
if (product === "buddy") manifest.archive_path = value;
else manifest.artifact.file = value;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
' "$root" "$product" "$archive_path"
}

expect_archive_path_failure() {
    local label="$1" product="$2" archive_path="$3" expected="$4"
    copy_artifacts "$label"
    if [ "$product" = buddy ]; then
        set_manifest_archive_path "$TMP/$label-buddy" "$product" "$archive_path"
    else
        set_manifest_archive_path "$TMP/$label-trae" "$product" "$archive_path"
    fi
    mkdir "$TMP/$label-out"
    expect_failure "$label" "$expected" assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
        "$TMP/$label-buddy" "$TMP/$label-trae" "$TMP/$label-out"
    [ -z "$(find "$TMP/$label-out" -mindepth 1 -print -quit)" ] || fail "$label left output residue"
}

expect_archive_path_failure buddy-parent buddy ../todo33-benign-sibling-marker 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "../todo33-benign-sibling-marker"'
expect_archive_path_failure buddy-traversal buddy ../../escape 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "../../escape"'
expect_archive_path_failure buddy-empty buddy '' 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: ""'
expect_archive_path_failure buddy-absolute buddy /tmp/todo33-absolute 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "/tmp/todo33-absolute"'
expect_archive_path_failure buddy-dot buddy . 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "."'
expect_archive_path_failure buddy-dotdot buddy .. 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: ".."'
expect_archive_path_failure buddy-backslash buddy 'archive\\escape.tgz' 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "archive\\\\escape.tgz"'
expect_archive_path_failure buddy-nul buddy __NUL__ 'UNSAFE_ARCHIVE_PATH: LazyBuddy archive path: "\u0000"'
expect_archive_path_failure trae-parent trae ../todo33-benign-sibling-marker 'UNSAFE_ARCHIVE_PATH: LazyTrae archive path: "../todo33-benign-sibling-marker"'
expect_archive_path_failure trae-normalization trae 'nested//archive.tgz' 'UNSAFE_ARCHIVE_PATH: LazyTrae archive path: "nested//archive.tgz"'

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

copy_artifacts extra-regular
printf 'undeclared\n' > "$TMP/extra-regular-trae/extra-regular.txt"
mkdir "$TMP/extra-regular-out"
expect_failure extra-regular UNEXPECTED_ARTIFACT assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
    "$TMP/extra-regular-buddy" "$TMP/extra-regular-trae" "$TMP/extra-regular-out"

socket_base="$(mktemp -d /tmp/pltc-sock.XXXXXX)"
mkdir "$socket_base/buddy" "$socket_base/trae" "$socket_base/out"
cp -R "$BUDDY_ARTIFACTS/." "$socket_base/buddy/"
cp -R "$TRAE_ARTIFACTS/." "$socket_base/trae/"
python3 - "$socket_base/trae/s.sock" <<'PY' &
import socket
import sys
import time

server = socket.socket(socket.AF_UNIX)
server.bind(sys.argv[1])
server.listen(1)
time.sleep(30)
PY
socket_pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    [ -S "$socket_base/trae/s.sock" ] && break
    sleep 0.1
done
[ -S "$socket_base/trae/s.sock" ] || fail "socket fixture did not create Unix socket"
expect_failure socket NONREGULAR_FILE assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
    "$socket_base/buddy" "$socket_base/trae" "$socket_base/out"
kill "$socket_pid" 2>/dev/null || true
wait "$socket_pid" 2>/dev/null || true
socket_pid=""
chmod -R u+w "$socket_base" 2>/dev/null || true
rm -rf "$socket_base"
socket_base=""

copy_artifacts digest
printf 'x' >> "$TMP/digest-buddy/lazybuddy-v1.2.0.tar.gz"
mkdir "$TMP/digest-out"
expect_failure digest-mismatch ARCHIVE_DIGEST_MISMATCH assemble "$BUDDY_ROOT" "$TRAE_ROOT" \
    "$TMP/digest-buddy" "$TMP/digest-trae" "$TMP/digest-out"

copy_artifacts moved
rm "$TMP/moved-trae/lazytrae-ai-v1.2.0.tgz"
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

tampered="$first_path/LazyBuddy/lazybuddy-v1.2.0.tar.gz"
chmod u+w "$tampered"
printf 'x' >> "$tampered"
chmod 0444 "$tampered"
expect_failure final-tamper "LazyBuddy/lazybuddy-v1.2.0.tar.gz" \
    node "$SCRIPT" verify --candidate "$first_path"

printf 'PASS: paired live-test candidate assembler boundary\n'
