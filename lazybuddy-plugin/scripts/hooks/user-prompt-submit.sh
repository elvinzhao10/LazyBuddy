#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd -P -- "$SCRIPT_DIR/../.." && pwd -P)}"

INPUT="$(cat)"
FRESHNESS="$(python3 -c 'import json,sys; value=json.load(sys.stdin).get("runtime_freshness"); print("" if value is None else json.dumps(value,separators=(",",":")))' <<<"$INPUT" 2>/dev/null || true)"
if [ -z "$FRESHNESS" ]; then
  exec python3 "$PLUGIN_ROOT/tooling/lazybuddy_adaptive_runtime.py" <<<"$INPUT"
fi

if ! RESULT="$(node "$PLUGIN_ROOT/scripts/runtime-freshness-entry.js" resume <<<"$FRESHNESS" 2>/dev/null)"; then
  RESULT='{"status":"blocked","completion":"blocked","reason":"malformed-runtime-context"}'
fi
STATUS="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","blocked"))' <<<"$RESULT")"
if [ "$STATUS" != "resumed" ]; then
  BLOCKED="capacity"
  [ "$STATUS" = "stale" ] && BLOCKED="stale-context"
  python3 - "$BLOCKED" "$RESULT" <<'PYEOF'
import json, sys
blocked, result = sys.argv[1], json.loads(sys.argv[2])
print(json.dumps({"continuation":"stale-rejected","dispatched":f"blocked:{blocked}","kind":"lazybuddy-adaptive-directive","persistence":f"skipped:{blocked}","runtimeFreshness":result},separators=(",",":"),sort_keys=True))
PYEOF
  exit 0
fi

DIRECTIVE="$(python3 "$PLUGIN_ROOT/tooling/lazybuddy_adaptive_runtime.py" <<<"$INPUT")"
[ -n "$DIRECTIVE" ] || exit 0
python3 - "$RESULT" "$DIRECTIVE" <<'PYEOF'
import json, sys
result, directive = json.loads(sys.argv[1]), json.loads(sys.argv[2])
directive["continuation"] = "resumed"
directive["runtimeFreshness"] = result
print(json.dumps(directive,ensure_ascii=False,separators=(",",":"),sort_keys=True))
PYEOF
