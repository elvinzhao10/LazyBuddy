#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph-install-timeout.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
cleanup() {
    if [ "${LAZYBUDDY_KEEP_TEST_FIXTURES:-}" = 1 ]; then
        printf 'KEEP fixture: %s\n' "$TMP" >&2
        return
    fi
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# The lifecycle test owns a dedicated process group and the Python watchdog
# terminates that group.  Never add raw-PID cleanup here: a stale child.pid
# could be reused by an unrelated process after the group has exited.
python3 - "$0" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
unsafe = 'kill -TERM ' + '"$(cat "$TMP/child.pid")"'
def has_unsafe_raw_pid_signal(text: str) -> bool:
    return unsafe in text

if not has_unsafe_raw_pid_signal(unsafe):
    raise SystemExit("raw-PID cleanup guard self-test failed")
if has_unsafe_raw_pid_signal(source):
    raise SystemExit("unsafe raw child.pid signal found; use the owned process group")
PY

TARGET="$TMP/project"
TOOLING_ROOT="$TMP/tools"
FAKE_BIN="$TMP/bin"
mkdir "$TARGET" "$FAKE_BIN"

cat > "$FAKE_BIN/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$PWD/node_modules/partial"
printf 'partial install\n' > "$PWD/node_modules/partial/sentinel"
if [ -n "${LAZYBUDDY_CODEGRAPH_STAGE_READY_PATH:-}" ]; then
    : > "$LAZYBUDDY_CODEGRAPH_STAGE_READY_PATH"
fi
if [ -n "${LAZYBUDDY_CODEGRAPH_STAGE_CONTINUE_PATH:-}" ]; then
    while [ ! -e "$LAZYBUDDY_CODEGRAPH_STAGE_CONTINUE_PATH" ]; do sleep 0.01; done
fi
if [ "${LAZYBUDDY_CODEGRAPH_FAKE_NPM_MODE:-hang}" = success ]; then
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64) suffix=darwin-arm64 ;;
        Darwin-x86_64) suffix=darwin-x64 ;;
        Linux-aarch64|Linux-arm64) suffix=linux-arm64 ;;
        Linux-x86_64) suffix=linux-x64 ;;
        *) exit 1 ;;
    esac
    binary="$PWD/node_modules/@colbymchenry/codegraph-$suffix/bin/codegraph"
    mkdir -p "$(dirname "$binary")"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$binary"
    chmod +x "$binary"
    exit 0
fi
( while :; do sleep 1; done ) &
printf '%s\n' "$!" > "$LAZYBUDDY_CODEGRAPH_HANG_PID"
wait
SH
chmod +x "$FAKE_BIN/npm"

python3 - "$LIFECYCLE" "$TARGET" "$TOOLING_ROOT" "$FAKE_BIN" "$TMP" <<'PY'
import os
import signal
import subprocess
import sys
import time

lifecycle, target, tooling_root, fake_bin, tmp = sys.argv[1:]

def staging_paths() -> list[str]:
    return [name for name in os.listdir(tmp) if name.startswith(".lazybuddy-codegraph-install.")]

def wait_for(path: str) -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if os.path.exists(path):
            return
        time.sleep(0.02)
    raise SystemExit(f"fake npm did not reach staging point: {path}")

def invoke(root: str, mode: str, add_unknown: bool = False) -> tuple[str, str]:
    pid_path = f"{tmp}/child-{os.path.basename(root)}.pid"
    stage_ready = f"{tmp}/stage-ready-{os.path.basename(root)}"
    environment = os.environ | {
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "LAZYBUDDY_CODEGRAPH_INSTALL_TIMEOUT_SECONDS": "1",
        "LAZYBUDDY_CODEGRAPH_HANG_PID": pid_path,
        "LAZYBUDDY_CODEGRAPH_FAKE_NPM_MODE": mode,
        "LAZYBUDDY_CODEGRAPH_STAGE_READY_PATH": stage_ready,
        "LAZYBUDDY_CODEGRAPH_EXTERNAL_FILE": f"{tmp}/external-{os.path.basename(root)}.txt",
    }
    process = subprocess.Popen(
        ["bash", lifecycle, "codegraph-install", "--target", target, "--tooling-root", root],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env=environment,
    )
    if add_unknown:
        wait_for(stage_ready)
        os.mkdir(f"{root}/user-owned")
        with open(f"{root}/user-owned/keep.txt", "w", encoding="utf-8") as destination:
            destination.write("preserve me\n")
        with open(environment["LAZYBUDDY_CODEGRAPH_EXTERNAL_FILE"], "w", encoding="utf-8") as destination:
            destination.write("outside root\n")
        os.symlink(environment["LAZYBUDDY_CODEGRAPH_EXTERNAL_FILE"], f"{root}/package.json")
        os.symlink("user-owned", f"{root}/user-owned-link")
    try:
        stdout, stderr = process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise SystemExit("codegraph-install did not return before the outer watchdog")
    if mode == "success":
        if process.returncode != 0:
            raise SystemExit(f"expected successful retry, got {process.returncode}: {stdout}{stderr}")
        return stdout, stderr
    if process.returncode != 124:
        raise SystemExit(f"expected exit 124, got {process.returncode}: {stdout}{stderr}")
    if "CODEGRAPH_INSTALL_TIMEOUT" not in stderr:
        raise SystemExit(f"missing typed timeout: {stdout}{stderr}")
    deadline = time.monotonic() + 2
    while os.path.exists(pid_path) and time.monotonic() < deadline:
        pid = int(open(pid_path, encoding="utf-8").read().strip())
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        if os.path.exists(pid_path):
            raise SystemExit(f"npm descendant remained alive: {open(pid_path).read().strip()}")
    if os.path.exists(f"{root}/.lazybuddy-codegraph-receipt.json"):
        raise SystemExit("timeout left a CodeGraph receipt")
    return stdout, stderr

def invoke_with_replaced_root(replacement: str) -> None:
    root = f"{tmp}/tools-replaced-{replacement}"
    stage_ready = f"{tmp}/stage-ready-replaced-{replacement}"
    stage_continue = f"{tmp}/stage-continue-replaced-{replacement}"
    external = f"{tmp}/external-replaced-{replacement}.txt"
    environment = os.environ | {
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "LAZYBUDDY_CODEGRAPH_INSTALL_TIMEOUT_SECONDS": "5",
        "LAZYBUDDY_CODEGRAPH_FAKE_NPM_MODE": "success",
        "LAZYBUDDY_CODEGRAPH_STAGE_READY_PATH": stage_ready,
        "LAZYBUDDY_CODEGRAPH_STAGE_CONTINUE_PATH": stage_continue,
    }
    process = subprocess.Popen(
        ["bash", lifecycle, "codegraph-install", "--target", target, "--tooling-root", root],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env=environment,
    )
    wait_for(stage_ready)
    if replacement == "directory":
        os.mkdir(root)
        caller_directory_identity = os.lstat(root).st_dev, os.lstat(root).st_ino
    else:
        with open(external, "w", encoding="utf-8") as destination:
            destination.write("preserve me\\n")
        os.symlink(external, root)
    with open(stage_continue, "w", encoding="utf-8") as destination:
        destination.write("continue\\n")
    stdout, stderr = process.communicate(timeout=5)
    if process.returncode == 0:
        raise SystemExit(f"promotion replaced concurrent {replacement}: {stdout}{stderr}")
    if "CODEGRAPH_INSTALL_ROOT_COLLISION" not in stderr:
        raise SystemExit(f"replacement failure was not typed: {stdout}{stderr}")
    if replacement == "directory":
        if (os.lstat(root).st_dev, os.lstat(root).st_ino) != caller_directory_identity:
            raise SystemExit("promotion replaced the concurrent empty caller directory")
        if os.listdir(root):
            raise SystemExit("failed promotion wrote into the concurrent caller directory")
        if os.path.exists(f"{root}/.lazybuddy-tooling-receipt.json"):
            raise SystemExit("failed promotion wrote a receipt into the caller directory")
    else:
        if not os.path.islink(root):
            raise SystemExit("promotion replaced the concurrent caller symlink")
        if open(external, encoding="utf-8").read() != "preserve me\\n":
            raise SystemExit("promotion altered the caller symlink target")
    if staging_paths():
        raise SystemExit(f"failed promotion retained private staging entries: {staging_paths()}")

def invoke_with_forced_promotion_error() -> None:
    root = f"{tmp}/tools-forced-promotion-error"
    stage_ready = f"{tmp}/stage-ready-forced-promotion-error"
    stage_continue = f"{tmp}/stage-continue-forced-promotion-error"
    import_root = f"{tmp}/forced-promotion-error-import"
    os.mkdir(import_root)
    with open(f"{import_root}/ctypes.py", "w", encoding="utf-8") as destination:
        destination.write("""import errno
c_int = int
c_char_p = bytes
c_uint = int
class RenameAtx:
    argtypes = None
    restype = None
    def __call__(self, *args):
        return -1
class Library:
    renameatx_np = RenameAtx()
def CDLL(*args, **kwargs):
    return Library()
def get_errno():
    return errno.EIO
""")
    environment = os.environ | {
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "LAZYBUDDY_CODEGRAPH_INSTALL_TIMEOUT_SECONDS": "5",
        "LAZYBUDDY_CODEGRAPH_FAKE_NPM_MODE": "success",
        "LAZYBUDDY_CODEGRAPH_STAGE_READY_PATH": stage_ready,
        "LAZYBUDDY_CODEGRAPH_STAGE_CONTINUE_PATH": stage_continue,
    }
    process = subprocess.Popen(
        ["bash", lifecycle, "codegraph-install", "--target", target, "--tooling-root", root],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        cwd=import_root,
        env=environment,
    )
    wait_for(stage_ready)
    with open(stage_continue, "w", encoding="utf-8") as destination:
        destination.write("continue\\n")
    stdout, stderr = process.communicate(timeout=5)
    if process.returncode == 0:
        raise SystemExit(f"forced primitive failure unexpectedly promoted: {stdout}{stderr}")
    if "CODEGRAPH_INSTALL_NO_CLOBBER_UNAVAILABLE" not in stderr:
        raise SystemExit(f"forced primitive failure was not preserved: {stdout}{stderr}")
    if "CODEGRAPH_INSTALL_ROOT_COLLISION" in stderr:
        raise SystemExit(f"forced primitive failure was flattened to a collision: {stdout}{stderr}")
    if os.path.lexists(root):
        raise SystemExit("forced primitive failure created a tooling-root pathname")
    if staging_paths():
        raise SystemExit(f"forced primitive failure retained private staging entries: {staging_paths()}")

for replacement in ("directory", "symlink"):
    invoke_with_replaced_root(replacement)

invoke_with_forced_promotion_error()

retry_root = f"{tmp}/tools-clean-retry"
stdout, _ = invoke(retry_root, "success")
if "STATE: not-initialized" not in stdout:
    raise SystemExit(f"clean retry did not promote the verified package: {stdout}")
if not os.path.isfile(f"{retry_root}/.lazybuddy-tooling-receipt.json"):
    raise SystemExit("clean retry did not write the owned tooling receipt")

invoke(tooling_root, "hang")
if os.path.lexists(tooling_root):
    raise SystemExit("timeout left a tooling-root pathname")
if staging_paths():
    raise SystemExit(f"timeout left private staging entries: {staging_paths()}")

stdout, _ = invoke(tooling_root, "success")
if "STATE: not-initialized" not in stdout:
    raise SystemExit(f"successful retry did not produce CodeGraph ready-to-init state: {stdout}")
if not os.path.isfile(f"{tooling_root}/.lazybuddy-tooling-receipt.json"):
    raise SystemExit("successful retry did not write the owned tooling receipt")
if staging_paths():
    raise SystemExit(f"successful promotion retained private staging entries: {staging_paths()}")

tampered_root = f"{tmp}/tools-with-unknown-entry"
os.mkdir(tampered_root)
os.mkdir(f"{tampered_root}/user-owned")
with open(f"{tampered_root}/user-owned/keep.txt", "w", encoding="utf-8") as destination:
    destination.write("preserve me\n")
external = f"{tmp}/external-{os.path.basename(tampered_root)}.txt"
with open(external, "w", encoding="utf-8") as destination:
    destination.write("outside root\n")
os.symlink(external, f"{tampered_root}/package.json")
os.symlink("user-owned", f"{tampered_root}/user-owned-link")
expected = {"package.json", "user-owned", "user-owned-link"}
actual = set(os.listdir(tampered_root))
if actual != expected:
    raise SystemExit(f"pre-existing caller entries changed before refusal: {actual}")
if open(f"{tampered_root}/user-owned/keep.txt", encoding="utf-8").read() != "preserve me\n":
    raise SystemExit("rollback deleted or altered the unknown concurrent entry")
if not os.path.islink(f"{tampered_root}/user-owned-link"):
    raise SystemExit("rollback altered the unknown symlink entry")
if not os.path.islink(f"{tampered_root}/package.json"):
    raise SystemExit("rollback removed the tampered symlink instead of retaining it")
if open(external, encoding="utf-8").read() != "outside root\n":
    raise SystemExit("refusal followed or altered the caller symlink target")
refused = subprocess.run(
    ["bash", lifecycle, "codegraph-install", "--target", target, "--tooling-root", tampered_root],
    text=True,
    capture_output=True,
    env=os.environ | {"PATH": f"{fake_bin}:/usr/bin:/bin"},
)
if refused.returncode != 2 or "must be absent" not in refused.stderr:
    raise SystemExit(f"unknown root was not safely refused: {refused.returncode}: {refused.stdout}{refused.stderr}")
if set(os.listdir(tampered_root)) != expected:
    raise SystemExit("refused retry changed concurrent unknown entries")
if staging_paths():
    raise SystemExit(f"concurrent timeout left private staging entries: {staging_paths()}")
PY

printf 'PASS: CodeGraph install timeout, retry, and ownership boundaries are safe\n'
