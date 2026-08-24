#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node --check "$PLUGIN_ROOT/scripts/lazybuddy-workbuddy-observation.js"
node --check "$PLUGIN_ROOT/scripts/lifecycle/workbuddy-observation.js"
node --check "$PLUGIN_ROOT/scripts/lifecycle/workbuddy-observation-contract.js"
node --test \
  "$PLUGIN_ROOT/tests/workbuddy-observation-bundle.test.js" \
  "$PLUGIN_ROOT/tests/workbuddy-connector-reference.test.js"
