"""Test-only CLI fault injection, restricted to the current owned fixture tree.

The QA runner supplies this directory through an individual child's PYTHONPATH.
Normal CLI execution does not import it or expose a fault-injection operation.
"""
import errno
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

review_root = os.environ.get("PROJECT_REVIEW_ROOT", "")
review_suite = os.environ.get("PROJECT_REVIEW_SUITE_ROOT", "")
review_fault = os.environ.get("PROJECT_REVIEW_FAULT", "")
root = Path(review_root)
suite = Path(review_suite)
enabled = (
    bool(review_fault)
    and root.is_absolute()
    and suite.is_absolute()
    and suite.name.startswith("lazybuddy-project-review-")
    and suite.resolve() == suite
    and suite.parent == Path(tempfile.gettempdir()).resolve()
    and root.resolve() == root
    and root != suite
    and root.is_relative_to(suite)
)

if enabled:
    store = root / ".lazybuddy/project"
    original_replace = os.replace
    original_open = os.open
    original_mkdir = os.mkdir
    original_run = subprocess.run
    original_fsync = os.fsync
    injected = False

    def same_directory(descriptor, expected):
        if descriptor is None:
            return False
        try:
            actual = os.fstat(descriptor)
            present = os.stat(expected, follow_symlinks=False)
        except OSError:
            return False
        return (
            stat.S_ISDIR(actual.st_mode)
            and stat.S_ISDIR(present.st_mode)
            and (actual.st_dev, actual.st_ino) == (present.st_dev, present.st_ino)
        )

    def scoped_fd(kwargs):
        return same_directory(kwargs.get("dst_dir_fd", kwargs.get("dir_fd")), store)

    def replace(source, destination, *args, **kwargs):
        if destination == "state.json" and scoped_fd(kwargs):
            if review_fault == "before_state_publish":
                os._exit(86)
            result = original_replace(source, destination, *args, **kwargs)
            if review_fault == "after_state_publish":
                os._exit(86)
            return result
        return original_replace(source, destination, *args, **kwargs)

    def opening(name, flags, *args, **kwargs):
        descriptor = original_open(name, flags, *args, **kwargs)
        if review_fault == "owner_open" and name == "owner.json" and flags & os.O_CREAT and scoped_fd(kwargs):
            os._exit(86)
        return descriptor

    def mkdir(name, *args, **kwargs):
        result = original_mkdir(name, *args, **kwargs)
        if review_fault == "after_project_mkdir" and name == "project" and same_directory(kwargs.get("dir_fd"), root / ".lazybuddy"):
            os._exit(86)
        return result

    def fsync(descriptor):
        if review_fault == "state_fsync_error":
            actual = os.fstat(descriptor)
            for candidate in store.glob(".state.json.*"):
                present = candidate.lstat()
                if stat.S_ISREG(present.st_mode) and (actual.st_dev, actual.st_ino) == (present.st_dev, present.st_ino):
                    raise OSError(errno.ENOSPC, "review injected full filesystem")
        return original_fsync(descriptor)

    def run(*args, **kwargs):
        global injected
        result = original_run(*args, **kwargs)
        try:
            request = json.loads(kwargs.get("input", b"{}"))
        except (ValueError, TypeError):
            request = {}
        if not injected and request.get("action") == "command" and result.returncode == 0:
            injected = True
            if review_fault == "edit_source":
                (root / "docs/requirements.md").write_text("# External concurrent change\n")
            elif review_fault == "edit_state":
                (store / "state.json").write_text("external editor state sentinel\n")
            elif review_fault == "replace_store":
                store.rename(root / ".lazybuddy/project-before")
                store.mkdir(mode=0o700)
                (store / "unowned.txt").write_text("external directory sentinel\n")
            elif review_fault == "replace_source_with_symlink":
                source = root / "docs/requirements.md"
                source.unlink()
                source.symlink_to(root / ".lazybuddy/dashboard/secret.md")
        return result

    os.replace = replace
    os.open = opening
    os.mkdir = mkdir
    os.fsync = fsync
    subprocess.run = run
