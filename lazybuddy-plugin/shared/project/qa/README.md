# Project store boundary QA

Run from the repository root:

```sh
node --test lazybuddy-plugin/shared/project/qa/store-boundary.test.mjs
```

This suite invokes the real project CLI against temporary fixture repositories.
It requires the same Node and Python runtime as that CLI. The descriptor checks
use portable POSIX file identities and do not rely on Linux `/proc`.

The 24 groups check unsafe and protected paths, linked files and directories,
project identity, corrupted state, original-source freshness, concurrent command
revisions, idempotent replay, atomic state publication, external edits during a
command, and native-run identity references. Existing native run, receipt,
dashboard, queue, and host-setting fixture bytes must remain unchanged.

Crash and external-edit cases load `fault-hooks/sitecustomize.py` only through
the individual test child's `PYTHONPATH`. The hook requires an explicit fixture
root inside the current test suite's temporary directory. It never enables a
production CLI flag, native host action, or remote operation. Each fixture suite
cleans up only its original temporary root after checking that root's identity.

## Bootstrap limitation under test

Atomic, replayable state commands require completed owner initialization. A
process stopped after creating the project directory but before writing its
owner record leaves an unidentifiable directory. A process stopped after opening
the owner file can leave an incomplete owner record. Retrying those cases must
fail closed with `PROJECT_DIRECTORY_COLLISION` or `INVALID_JSON`; the CLI must
preserve the directory and existing native state for review. The suite records
these outcomes as `BOOTSTRAP_RESIDUAL` and does not claim automatic recovery from
an unidentifiable or incomplete owner record.

After ownership is initialized, a stop immediately before or after state-file
publication must leave a complete old or new state with the corresponding
receipt. Replaying the command must produce one saved revision and one receipt.
