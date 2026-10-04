"""Read bounded regular files through pinned directory descriptors."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: python3 service-read.py CANONICAL_ROOT RELATIVE_PATH BYTE_LIMIT
from __future__ import annotations

import os
import stat
import sys
from contextlib import ExitStack
from pathlib import Path


class UnsafeReferenceError(Exception):
    """The reference cannot be proven to belong to its pinned root."""


def read(root: str, relative: str, limit: int) -> bytes:
    """Pin every ancestor and withhold bytes if any identity changes."""
    if not 0 < limit <= 8 * 1024 * 1024 or not relative or "\\" in relative:
        raise UnsafeReferenceError
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts) or str(Path(root).resolve()) != root:
        raise UnsafeReferenceError
    identities: list[tuple[Path, os.stat_result]] = []
    with ExitStack() as stack:
        descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
        stack.callback(os.close, descriptor)
        current = Path("/")
        for part in [*Path(root).parts[1:], *parts[:-1]]:
            descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            stack.callback(os.close, descriptor)
            current /= part
            identities.append((current, os.fstat(descriptor)))
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        handle = stack.enter_context(os.fdopen(descriptor, "rb"))
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
            raise UnsafeReferenceError
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
        if len(content) != before.st_size or (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (before.st_size, before.st_mtime_ns, before.st_ctime_ns):
            raise UnsafeReferenceError
        identities.append((current / parts[-1], before))
        for path, prior in identities:
            present = path.lstat()
            if (present.st_dev, present.st_ino) != (prior.st_dev, prior.st_ino) or stat.S_ISLNK(present.st_mode):
                raise UnsafeReferenceError
        return content


if __name__ == "__main__":
    try:
        if len(sys.argv) != 4:
            raise UnsafeReferenceError
        sys.stdout.buffer.write(read(sys.argv[1], sys.argv[2], int(sys.argv[3])))
    except (OSError, ValueError, UnsafeReferenceError):
        sys.stderr.write("UNSAFE_REFERENCE\n")
        sys.exit(65)
