# Contributing to LazyBuddy

Thank you for improving LazyBuddy. Keep changes focused, preserve the package
boundary, and avoid adding host configuration, credentials, or generated local
state to commits.

## Before opening an issue

Search existing issues first. For a bug report, include the LazyBuddy version,
host version, operating system, exact reproduction steps, and sanitized output
from the verification command. Do not paste tokens, credentials, or private
workspace paths.

## Pull requests

Create one focused branch and describe the user-visible change, compatibility
impact, and verification in the pull request template. Keep pull requests
small and update documentation or `lazybuddy-plugin/CHANGELOG.md` when public
behavior changes.

Run these checks from the repository root before requesting review:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
bash lazybuddy-plugin/scripts/lazybuddy-smoke-test.sh
bash lazybuddy-plugin/scripts/lazybuddy-security-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh
```

The CI workflow runs the same release-relevant checks on every pull request.

## Releases

Use a version tag in the form `vX.Y.Z` only after the default-branch CI is
green and the changelog documents the user-facing change. The tag-release
workflow creates GitHub release notes from merged pull requests and labels.
Review the generated notes before publishing a prerelease or major release.
