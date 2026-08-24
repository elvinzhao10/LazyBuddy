#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --test "$PLUGIN_ROOT/contracts/host-evidence-contract.test.js"
