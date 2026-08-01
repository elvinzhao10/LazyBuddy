#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --test \
    "${PLUGIN_ROOT}/tests/lifecycle-entrypoint.test.js" \
    "${PLUGIN_ROOT}/tests/lifecycle-entrypoint-bootstrap.test.js" \
    "${PLUGIN_ROOT}/tests/lifecycle-host-handoff.test.js" \
    "${PLUGIN_ROOT}/tests/lifecycle-platform-fixtures.test.js"
