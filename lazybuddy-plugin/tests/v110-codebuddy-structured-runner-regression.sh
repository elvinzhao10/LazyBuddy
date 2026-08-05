#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
RUNNER="$PLUGIN_ROOT/scripts/lazybuddy-codebuddy-run.py"
TMP=$(mktemp -d /private/tmp/lazybuddy-codebuddy-runner.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

mkdir -p "$TMP/project with spaces"
git -C "$TMP/project with spaces" init -q
git -C "$TMP/project with spaces" config user.email test@example.invalid
git -C "$TMP/project with spaces" config user.name Test
printf 'fixture\n' > "$TMP/project with spaces/tracked.txt"
printf '.lazybuddy/\n' > "$TMP/project with spaces/.gitignore"
git -C "$TMP/project with spaces" add tracked.txt
git -C "$TMP/project with spaces" add .gitignore
git -C "$TMP/project with spaces" commit -qm fixture
printf '{"mcpServers":{}}\n' > "$TMP/mcp config.json"
printf '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}\n' > "$TMP/schema.json"
printf 'spaces ; $(touch /private/tmp/todo13-injected) `false`\n' > "$TMP/prompt.txt"

cat > "$TMP/fake-codebuddy" <<'PY'
#!/usr/bin/env python3
import json, os, pathlib, sys, time
pathlib.Path(os.environ["ARGV_LOG"]).write_text(json.dumps(sys.argv[1:]), encoding="utf-8")
mode = os.environ.get("FAKE_MODE", "json")
if mode == "json":
    print(json.dumps({"session_id":"session-exact-13","result":"ok","structured_output":{"answer":"safe"},"future_field":{"kept":True,"untrusted":"$(touch /private/tmp/todo13-output-injected)"}}))
elif mode == "stream":
    print(json.dumps({"type":"system","subtype":"init","session_id":"session-stream-13","future":"kept"}))
    print(json.dumps({"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"par"}}}))
    print(json.dumps({"type":"result","session_id":"session-stream-13","result":"partial done","turns":2}))
elif mode == "malformed":
    print('{"type":"result"')
elif mode == "permission":
    print(json.dumps({"type":"permission_request","session_id":"session-permission","tool_name":"Bash"}))
elif mode == "missing-session":
    print(json.dumps({"result":"misleading success","structured_output":{"answer":"safe"}}))
elif mode == "schema":
    print(json.dumps({"session_id":"session-schema","result":"wrong","structured_output":{"answer":7}}))
elif mode == "nested-schema":
    print(json.dumps({"session_id":"session-nested-schema","result":"wrong","structured_output":{"answer":""}}))
elif mode == "integer-float":
    print('{"session_id":"session-integer-float","result":"ok","structured_output":{"answer":1.0}}')
elif mode == "nan":
    print('{"session_id":"session-nan","result":"misleading success","structured_output":{"answer":NaN}}')
elif mode == "enum-bool-top":
    print(json.dumps({"session_id":"session-enum-bool-top","result":"wrong","structured_output":True}))
elif mode == "const-bool-top":
    print(json.dumps({"session_id":"session-const-bool-top","result":"wrong","structured_output":True}))
elif mode == "enum-bool-nested":
    print(json.dumps({"session_id":"session-enum-bool-nested","result":"wrong","structured_output":{"answer":True}}))
elif mode == "const-bool-nested":
    print(json.dumps({"session_id":"session-const-bool-nested","result":"wrong","structured_output":{"answer":True}}))
elif mode == "turns":
    print(json.dumps({"session_id":"session-turns","result":"too many","num_turns":4,"structured_output":{"answer":"safe"}}))
elif mode == "nonzero":
    print(json.dumps({"session_id":"session-nonzero","result":"misleading success"}))
    raise SystemExit(9)
elif mode == "hang":
    time.sleep(10)
elif mode == "spoof":
    pathlib.Path(sys.argv[0]).write_text(pathlib.Path(sys.argv[0]).read_text()+"\n# changed\n")
    print(json.dumps({"session_id":"session-spoof","result":"misleading success","structured_output":{"answer":"safe"}}))
PY
chmod +x "$TMP/fake-codebuddy"

ARGV_LOG="$TMP/argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode plan --permission-prompt-tool 'mcp__approval__ask exact' \
  --worktree 'feature exact' --result-file "$TMP/result.json" \
  --stdout-file "$TMP/stdout.json" --stderr-file "$TMP/stderr.txt"
python3 - "$TMP/argv.json" "$TMP/prompt.txt" "$TMP/result.json" <<'PY'
import json, pathlib, sys
argv=json.loads(pathlib.Path(sys.argv[1]).read_text())
prompt=pathlib.Path(sys.argv[2]).read_text()
expected=['-p','--input-format','text','--output-format','json','--max-turns','3','--permission-mode','default','--subagent-permission-mode','plan','--mcp-config',str(pathlib.Path(sys.argv[1]).parent/'mcp config.json'),'--strict-mcp-config','--json-schema','{"properties":{"answer":{"type":"string"}},"required":["answer"],"type":"object"}','--permission-prompt-tool','mcp__approval__ask exact','--worktree','feature exact',prompt]
assert argv == expected, (argv, expected)
result=json.loads(pathlib.Path(sys.argv[3]).read_text())
assert result['status']=='pass' and result['session_id']=='session-exact-13'
assert result['response']['future_field']['kept'] is True
assert result['response']['future_field']['untrusted'].startswith('$(touch ')
PY
test ! -e /private/tmp/todo13-injected || fail 'prompt metacharacters executed'
test ! -e /private/tmp/todo13-output-injected || fail 'output prompt injection executed'
pass 'text/json exact argv preserves spaces, metacharacters, schema and unknown fields'

printf '{"type":"user","message":{"role":"user","content":"hello"}}\n' > "$TMP/input.jsonl"
ARGV_LOG="$TMP/stream-argv.json" FAKE_MODE=stream python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/input.jsonl" --input-format stream-json --output-format stream-json \
  --include-partial-messages --resume 'session resume exact' --max-turns 2 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode dontAsk \
  --subagent-permission-mode default --result-file "$TMP/stream-result.json" \
  --stdout-file "$TMP/stream.stdout" --stderr-file "$TMP/stream.stderr"
python3 - "$TMP/stream-argv.json" "$TMP/stream-result.json" <<'PY'
import json, pathlib, sys
argv=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert argv == ['-p','--input-format','stream-json','--output-format','stream-json','--max-turns','2','--permission-mode','dontAsk','--subagent-permission-mode','default','--mcp-config',str(pathlib.Path(sys.argv[1]).parent/'mcp config.json'),'--strict-mcp-config','--include-partial-messages','--resume','session resume exact']
result=json.loads(pathlib.Path(sys.argv[2]).read_text())
assert result['status']=='pass' and result['session_id']=='session-stream-13'
assert result['events'][0]['future']=='kept' and result['events'][1]['event']['delta']['text']=='par'
PY
pass 'stream-json input/output preserves events, partials, and exact resume ID'

printf '{"type":"user"\n' > "$TMP/malformed-input.jsonl"
rm -f "$TMP/malformed-input-argv.json"
if ARGV_LOG="$TMP/malformed-input-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/malformed-input.jsonl" --input-format stream-json --output-format json \
  --max-turns 2 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode default --subagent-permission-mode default \
  --result-file "$TMP/malformed-input-result.json" --stdout-file "$TMP/malformed-input.stdout" \
  --stderr-file "$TMP/malformed-input.stderr"; then
  fail 'malformed stream input unexpectedly succeeded'
fi
python3 - "$TMP/malformed-input-result.json" <<'PY'
import json, pathlib, sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['reason']=='malformed_stream_input'
PY
test ! -e "$TMP/malformed-input-argv.json" || fail 'malformed stream input reached CodeBuddy subprocess'
if ARGV_LOG="$TMP/bypass-argv.json" python3 "$RUNNER" --binary "$TMP/fake-codebuddy" \
  --cwd "$TMP/project with spaces" --input-file "$TMP/prompt.txt" --input-format text \
  --output-format json --max-turns 2 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode bypassPermissions --subagent-permission-mode default \
  --result-file "$TMP/bypass-result.json" --stdout-file "$TMP/bypass.stdout" \
  --stderr-file "$TMP/bypass.stderr" 2>/dev/null; then
  fail 'permission bypass mode unexpectedly accepted'
fi
test ! -e "$TMP/bypass-argv.json" || fail 'permission bypass reached CodeBuddy subprocess'
pass 'malformed stream input and bypass permission profile fail before launch'

printf '{"type":"object","properties":{"answer":{"type":"string","minLength":1}},"required":["answer"]}\n' > "$TMP/nested-schema.json"
if ARGV_LOG="$TMP/nested-schema-argv.json" FAKE_MODE=nested-schema python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/nested-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --result-file "$TMP/nested-schema-result.json" \
  --stdout-file "$TMP/nested-schema.stdout" --stderr-file "$TMP/nested-schema.stderr"; then
  fail 'nested minLength violation unexpectedly succeeded'
fi
python3 - "$TMP/nested-schema-result.json" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert result['reason']=='schema_mismatch', result
PY
test -e "$TMP/nested-schema-argv.json" || fail 'nested minLength schema did not reach CodeBuddy subprocess'
pass 'nested minLength is enforced by the schema engine'

printf '{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"]}\n' > "$TMP/integer-schema.json"
ARGV_LOG="$TMP/integer-float-argv.json" FAKE_MODE=integer-float python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/integer-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --result-file "$TMP/integer-float-result.json" \
  --stdout-file "$TMP/integer-float.stdout" --stderr-file "$TMP/integer-float.stderr"
python3 - "$TMP/integer-float-result.json" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert result['status']=='pass' and result['session_id']=='session-integer-float', result
PY
pass 'JSON number 1.0 satisfies integer schema semantics'

printf '{"type":"object","properties":{"answer":{"type":"number"}},"required":["answer"]}\n' > "$TMP/number-schema.json"
if ARGV_LOG="$TMP/nan-argv.json" FAKE_MODE=nan python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/number-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --result-file "$TMP/nan-result.json" \
  --stdout-file "$TMP/nan.stdout" --stderr-file "$TMP/nan.stderr"; then
  fail 'non-finite JSON output unexpectedly succeeded'
fi
python3 - "$TMP/nan-result.json" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert result['reason']=='malformed_json'
PY
test -e "$TMP/nan-argv.json" || fail 'NaN output did not reach the real child boundary'
pass 'NaN structured output fails closed at JSON boundary'

printf '{"type":"object","additionalProperties":"nonsense"}\n' > "$TMP/invalid-schema.json"
rm -f "$TMP/invalid-schema-argv.json"
if ARGV_LOG="$TMP/invalid-schema-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/invalid-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --result-file "$TMP/invalid-schema-result.json" \
  --stdout-file "$TMP/invalid-schema.stdout" --stderr-file "$TMP/invalid-schema.stderr"; then
  fail 'invalid schema value unexpectedly succeeded'
fi
python3 - "$TMP/invalid-schema-result.json" <<'PY'
import json, pathlib, sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['reason']=='invalid_json_schema'
PY
test ! -e "$TMP/invalid-schema-argv.json" || fail 'invalid schema reached CodeBuddy subprocess'
pass 'invalid schema value types fail closed before launch'

printf '{"type":"number","const":NaN}\n' > "$TMP/nan-schema.json"
rm -f "$TMP/nan-schema-argv.json"
if ARGV_LOG="$TMP/nan-schema-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/nan-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --result-file "$TMP/nan-schema-result.json" \
  --stdout-file "$TMP/nan-schema.stdout" --stderr-file "$TMP/nan-schema.stderr"; then
  fail 'non-finite schema unexpectedly succeeded'
fi
python3 - "$TMP/nan-schema-result.json" <<'PY'
import json, pathlib, sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['reason']=='invalid_json_schema'
PY
test ! -e "$TMP/nan-schema-argv.json" || fail 'NaN schema reached CodeBuddy subprocess'
pass 'NaN schema fails closed before launch'

printf '{"type":"user","message":{"role":"user","content":"NaN"},"value":NaN}\n' > "$TMP/nan-input.jsonl"
rm -f "$TMP/nan-input-argv.json"
if ARGV_LOG="$TMP/nan-input-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/nan-input.jsonl" --input-format stream-json --output-format json \
  --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode default --subagent-permission-mode default \
  --result-file "$TMP/nan-input-result.json" --stdout-file "$TMP/nan-input.stdout" \
  --stderr-file "$TMP/nan-input.stderr"; then
  fail 'non-finite JSONL input unexpectedly succeeded'
fi
python3 - "$TMP/nan-input-result.json" <<'PY'
import json, pathlib, sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['reason']=='malformed_stream_input'
PY
test ! -e "$TMP/nan-input-argv.json" || fail 'NaN JSONL input reached CodeBuddy subprocess'
pass 'NaN JSONL input fails closed before launch'

if ARGV_LOG="$TMP/nan-stream-argv.json" FAKE_MODE=nan python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/input.jsonl" --input-format stream-json --output-format stream-json \
  --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode default --subagent-permission-mode default \
  --result-file "$TMP/nan-stream-result.json" --stdout-file "$TMP/nan-stream.stdout" \
  --stderr-file "$TMP/nan-stream.stderr"; then
  fail 'non-finite JSONL output unexpectedly succeeded'
fi
python3 - "$TMP/nan-stream-result.json" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value['reason']=='malformed_jsonl', value
PY
pass 'NaN JSONL output fails closed at JSON boundary'

rm -f "$TMP/missing-input-argv.json"
if ARGV_LOG="$TMP/missing-input-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/missing-prompt.txt" --input-format text --output-format json \
  --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode default --subagent-permission-mode default \
  --result-file "$TMP/missing-input-result.json" --stdout-file "$TMP/missing-input.stdout" \
  --stderr-file "$TMP/missing-input.stderr"; then
  fail 'missing text input unexpectedly succeeded'
fi
python3 - "$TMP/missing-input-result.json" <<'PY'
import json, pathlib, sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())['reason']=='adapter_io_error'
PY
test ! -e "$TMP/missing-input-argv.json" || fail 'missing text input reached CodeBuddy subprocess'
pass 'missing text input emits typed failure without launch'

CWD="$TMP/project with spaces" bash "$PLUGIN_ROOT/scripts/state/create-run.sh" todo13 'structured runner' >/dev/null
STATE="$TMP/project with spaces/.lazybuddy/runs/todo13/state.json"
ARGV_LOG="$TMP/bound-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --state-file "$STATE" \
  --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
  --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/bound-result.json" \
  --stdout-file "$TMP/bound.stdout" --stderr-file "$TMP/bound.stderr"
python3 - "$STATE" <<'PY'
import json, pathlib, sys
state=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state['session_ids']==['session-exact-13']
assert state['runtime_fingerprints'][0]['host']=='codebuddy-cli'
PY
pass 'successful exact session ID is persisted through existing runtime binding state'
cp "$TMP/fake-codebuddy" "$TMP/fake-codebuddy.bound"

cp "$STATE" "$TMP/nested-state-before.json"
if ARGV_LOG="$TMP/nested-bound-argv.json" FAKE_MODE=nested-schema python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/nested-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --state-file "$STATE" \
  --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
  --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/nested-bound-result.json" \
  --stdout-file "$TMP/nested-bound.stdout" --stderr-file "$TMP/nested-bound.stderr"; then
  fail 'nested minLength failure persisted a session'
fi
cmp "$TMP/nested-state-before.json" "$STATE" || fail 'nested minLength failure mutated session state'
pass 'nested minLength failure does not persist a session'

CWD="$TMP/project with spaces" bash "$PLUGIN_ROOT/scripts/state/create-run.sh" todo13integer 'integer schema' >/dev/null
INTEGER_STATE="$TMP/project with spaces/.lazybuddy/runs/todo13integer/state.json"
ARGV_LOG="$TMP/integer-bound-argv.json" FAKE_MODE=integer-float python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --json-schema-file "$TMP/integer-schema.json" --max-turns 3 --timeout 3 \
  --mcp-config "$TMP/mcp config.json" --permission-mode default \
  --subagent-permission-mode default --state-file "$INTEGER_STATE" \
  --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
  --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/integer-bound-result.json" \
  --stdout-file "$TMP/integer-bound.stdout" --stderr-file "$TMP/integer-bound.stderr"
python3 - "$INTEGER_STATE" <<'PY'
import json, pathlib, sys
state=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert state['session_ids']==['session-integer-float'], state
PY
pass 'successful JSON 1.0 integer validation persists its exact session ID'

printf '{"enum":[1]}\n' > "$TMP/enum-bool-top-schema.json"
printf '{"const":1}\n' > "$TMP/const-bool-top-schema.json"
printf '{"type":"object","properties":{"answer":{"enum":[1]}},"required":["answer"]}\n' > "$TMP/enum-bool-nested-schema.json"
printf '{"type":"object","properties":{"answer":{"const":1}},"required":["answer"]}\n' > "$TMP/const-bool-nested-schema.json"
for schema_case in enum-bool-top const-bool-top enum-bool-nested const-bool-nested; do
  cp "$STATE" "$TMP/$schema_case-state-before.json"
  if ARGV_LOG="$TMP/$schema_case-argv.json" FAKE_MODE="$schema_case" python3 "$RUNNER" \
    --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
    --input-file "$TMP/prompt.txt" --input-format text --output-format json \
    --json-schema-file "$TMP/$schema_case-schema.json" --max-turns 3 --timeout 3 \
    --mcp-config "$TMP/mcp config.json" --permission-mode default \
    --subagent-permission-mode default --state-file "$STATE" \
    --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
    --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/$schema_case-result.json" \
    --stdout-file "$TMP/$schema_case.stdout" --stderr-file "$TMP/$schema_case.stderr"; then
    fail "$schema_case unexpectedly succeeded"
  fi
  python3 - "$TMP/$schema_case-result.json" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert result['reason']=='schema_mismatch', result
PY
  cmp "$TMP/$schema_case-state-before.json" "$STATE" || fail "$schema_case mutated session state"
done
pass 'JSON Schema const/enum distinguish bool from number at top-level and nested values'

cp "$STATE" "$TMP/state-before-failures.json"
for mode in malformed permission missing-session schema turns nonzero hang spoof; do
  rm -f "$TMP/failure-result.json"
  output_format=json
  schema_args=(--json-schema-file "$TMP/schema.json")
  expected_reason=''
  if [ "$mode" = malformed ] || [ "$mode" = permission ]; then
    output_format=stream-json
    schema_args=()
  fi
  case "$mode" in
    malformed) expected_reason=malformed_jsonl ;;
    permission) expected_reason=permission_required ;;
    missing-session) expected_reason=missing_session ;;
    schema) expected_reason=schema_mismatch ;;
    turns) expected_reason=turn_exhaustion ;;
    nonzero) expected_reason=exit_9 ;;
    hang) expected_reason=deadline_exceeded ;;
    spoof) expected_reason=executable_changed ;;
  esac
  if ARGV_LOG="$TMP/$mode-argv.json" FAKE_MODE="$mode" python3 "$RUNNER" \
    --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
    --input-file "$TMP/prompt.txt" --input-format text \
    --output-format "$output_format" ${schema_args[@]+"${schema_args[@]}"} --max-turns 3 --timeout 1 \
    --mcp-config "$TMP/mcp config.json" --permission-mode default \
    --subagent-permission-mode default --result-file "$TMP/failure-result.json" \
    --stdout-file "$TMP/$mode.stdout" --stderr-file "$TMP/$mode.stderr"; then
    fail "$mode unexpectedly succeeded"
  fi
  python3 - "$TMP/failure-result.json" "$expected_reason" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value['status'] != 'pass' and value['reason']==sys.argv[2], value
PY
done
cmp "$TMP/state-before-failures.json" "$STATE" || fail 'failed invocation persisted session state'
pass 'malformed JSONL, permission stall, missing session, schema mismatch, turn exhaustion, nonzero and timeout fail closed'

touch "$TMP/cancel"
for attempt in 1 2; do
  if ARGV_LOG="$TMP/cancel-$attempt-argv.json" FAKE_MODE=hang python3 "$RUNNER" \
    --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
    --input-file "$TMP/prompt.txt" --input-format text --output-format json \
    --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
    --permission-mode default --subagent-permission-mode default --cancel-file "$TMP/cancel" \
    --state-file "$STATE" --binding-root "$PLUGIN_ROOT" \
    --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" --probe-file "$PLUGIN_ROOT/README.md" \
    --result-file "$TMP/cancel-$attempt-result.json" --stdout-file "$TMP/cancel-$attempt.stdout" \
    --stderr-file "$TMP/cancel-$attempt.stderr"; then
    fail "cancel attempt $attempt unexpectedly succeeded"
  fi
  python3 - "$TMP/cancel-$attempt-result.json" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert result['status']=='cancelled' and result['reason']=='cancellation_requested'
PY
done
cmp "$TMP/state-before-failures.json" "$STATE" || fail 'cancelled invocation persisted session state'
pass 'repeated cancellation terminates bounded invocations without persisting a session'

printf 'dirty\n' >> "$TMP/project with spaces/tracked.txt"
if ARGV_LOG="$TMP/stale-argv.json" python3 "$RUNNER" \
  --binary "$TMP/fake-codebuddy" --cwd "$TMP/project with spaces" \
  --input-file "$TMP/prompt.txt" --input-format text --output-format json \
  --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
  --permission-mode default --subagent-permission-mode default --state-file "$STATE" \
  --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
  --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/stale-result.json" \
  --stdout-file "$TMP/stale.stdout" --stderr-file "$TMP/stale.stderr"; then
  fail 'dirty worktree reused stale session binding'
fi
python3 - "$STATE" "$TMP/stale-result.json" <<'PY'
import json, pathlib, sys
state=json.loads(pathlib.Path(sys.argv[1]).read_text())
result=json.loads(pathlib.Path(sys.argv[2]).read_text())
assert state['session_ids']==['session-exact-13']
assert result['reason']=='session_binding_failed'
PY
pass 'dirty/stale worktree invalidates exact session reuse without state mutation'

git -C "$TMP/project with spaces" checkout -- tracked.txt
cp "$TMP/fake-codebuddy.bound" "$TMP/fake-codebuddy"
cp "$TMP/fake-codebuddy.bound" "$TMP/fake-codebuddy.original"
for stale_case in stale-session stale-binary stale-worktree stale-revision; do
  rm -f "$TMP/$stale_case-argv.json"
  case "$stale_case" in
    stale-session) resume_id='missing-session-13'; stale_cwd="$TMP/project with spaces" ;;
    stale-binary) printf '\n# stale binary\n' >> "$TMP/fake-codebuddy"; resume_id='session-exact-13'; stale_cwd="$TMP/project with spaces" ;;
    stale-worktree)
      git clone -q "$TMP/project with spaces" "$TMP/alternate-project"
      resume_id='session-exact-13'; stale_cwd="$TMP/alternate-project" ;;
    stale-revision) printf 'dirty revision\n' >> "$TMP/project with spaces/tracked.txt"; resume_id='session-exact-13'; stale_cwd="$TMP/project with spaces" ;;
  esac
  if ARGV_LOG="$TMP/$stale_case-argv.json" FAKE_MODE=json python3 "$RUNNER" \
    --binary "$TMP/fake-codebuddy" --cwd "$stale_cwd" --resume "$resume_id" \
    --input-file "$TMP/prompt.txt" --input-format text --output-format json \
    --max-turns 3 --timeout 3 --mcp-config "$TMP/mcp config.json" \
    --permission-mode default --subagent-permission-mode default --state-file "$STATE" \
    --binding-root "$PLUGIN_ROOT" --asset-file "$PLUGIN_ROOT/asset-source-manifest.v1.json" \
    --probe-file "$PLUGIN_ROOT/README.md" --result-file "$TMP/$stale_case-result.json" \
    --stdout-file "$TMP/$stale_case.stdout" --stderr-file "$TMP/$stale_case.stderr"; then
    fail "$stale_case resume unexpectedly succeeded"
  fi
  python3 - "$TMP/$stale_case-result.json" "$stale_case" <<'PY'
import json, pathlib, sys
result=json.loads(pathlib.Path(sys.argv[1]).read_text())
expected={'stale-session':'stale_session','stale-binary':'stale_binary','stale-worktree':'stale_worktree','stale-revision':'stale_revision'}[sys.argv[2]]
assert result['reason']==expected, (result, expected)
PY
  test ! -e "$TMP/$stale_case-argv.json" || fail "$stale_case resume reached CodeBuddy subprocess"
  case "$stale_case" in
    stale-binary) cp "$TMP/fake-codebuddy.original" "$TMP/fake-codebuddy" ;;
    stale-worktree) rm -rf "$TMP/alternate-project" ;;
    stale-revision) git -C "$TMP/project with spaces" checkout -- tracked.txt ;;
  esac
done
pass 'stale resume session, binary, worktree and revision refuse before launch'

printf 'PASS: structured CodeBuddy runner regression\n'
