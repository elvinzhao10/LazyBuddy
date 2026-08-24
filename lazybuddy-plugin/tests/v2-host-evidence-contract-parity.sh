#!/usr/bin/env bash
set -euo pipefail

BUDDY_CONTRACTS="$(cd "$(dirname "$0")/../contracts" && pwd)"
TRAE_ROOT="${LAZYTRAE_ROOT:?LAZYTRAE_ROOT must name the LazyTrae repository root}"
TRAE_CONTRACTS="$TRAE_ROOT/lazytrae-plugin/packages/cli/contracts"

files=(
  host-evidence-contract.test.js
  lazyseries-canonical-event.v1.schema.json
  lazyseries-generated-mirror.v1.schema.json
  lazyseries-host-event-vocabulary.v1.json
  lazyseries-host-evidence-defs.v1.schema.json
  lazyseries-host-evidence.v1.js
  lazyseries-host-observation.v1.schema.json
  lazyseries-onboarding-receipt.v1.schema.json
)

while IFS= read -r fixture; do
  files+=("${fixture#"$BUDDY_CONTRACTS/"}")
done < <(find "$BUDDY_CONTRACTS/fixtures/host-evidence-v1" -type f -print | LC_ALL=C sort)

for file in "${files[@]}"; do
  cmp "$BUDDY_CONTRACTS/$file" "$TRAE_CONTRACTS/$file"
done

printf 'host evidence contract parity: PASS (%s files)\n' "${#files[@]}"
