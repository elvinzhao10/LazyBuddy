#!/usr/bin/env python3
import ntpath
import os
import sys


class PathBoundaryError(ValueError):
    pass


def resolve_repo_path(root: str, raw_path: str) -> str:
    if not raw_path or os.path.isabs(raw_path) or ntpath.isabs(raw_path):
        raise PathBoundaryError("path is outside project root")
    if ".." in raw_path.replace("\\", "/").split("/"):
        raise PathBoundaryError("path is outside project root")
    canonical_root = os.path.realpath(root)
    candidate = os.path.realpath(os.path.join(canonical_root, raw_path))
    try:
        contained = os.path.commonpath((canonical_root, candidate)) == canonical_root
    except ValueError as exc:
        raise PathBoundaryError("path is outside project root") from exc
    if not contained:
        raise PathBoundaryError("path is outside project root")
    return candidate


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    try:
        print(resolve_repo_path(sys.argv[1], sys.argv[2]))
    except PathBoundaryError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
