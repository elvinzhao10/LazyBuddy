"""Exercise installed shell and MCP boundaries using isolated projects."""
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PLUGIN = Path(__file__).resolve().parents[1]
PRODUCT = PLUGIN.name.split("-")[0]


class RunIntegrity(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="lazy-v134-")
        self.root = Path(self.fixture.name)
        binary = self.root / "bin"
        binary.mkdir()
        (binary / "python3").symlink_to(sys.executable)
        self.env = dict(os.environ, CWD=str(self.root), PATH=str(binary) + os.pathsep + os.environ["PATH"], PYTHONDONTWRITEBYTECODE="1")
        for key in ("CLAUDE_PLUGIN_ROOT", "CODEBUDDY_PLUGIN_ROOT", "QODER_PLUGIN_ROOT", "KIMI_PLUGIN_ROOT", "LAZYZCODE_PLUGIN_ROOT", "LAZYDEEPSEEK_PLUGIN_ROOT"):
            self.env.pop(key, None)
        self.run_dir = self.root / ("." + PRODUCT) / "runs" / "probe"
        self.run_dir.mkdir(parents=True)

    def tearDown(self):
        self.fixture.cleanup()

    def seed(self, tasks, maximum=10):
        state = {"schema_version": "2", "run_id": "probe", "objective": "original", "status": "executing", "tasks": tasks,
                 "iteration": {"count": 0, "max": maximum}, "progress": {}}
        (self.run_dir / "state.json").write_text(json.dumps(state))
        (self.run_dir / "events.jsonl").write_text("")
        (self.run_dir / ".revision").write_text("7\n")

    def shell(self, script, *args, data=None):
        return subprocess.run(["bash", str(PLUGIN / script), *args], env=self.env, input=data, text=True, capture_output=True, timeout=15)

    def test_blocked_is_not_complete(self):
        self.seed([{"id": "wait", "status": "queued", "depends_on": ["missing"]}])
        result = self.shell("scripts/loop/run-cycle.sh", "probe")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["status"], "blocked")

    def test_paused_or_blocked_run_cannot_claim(self):
        for status in ("paused", "blocked", "awaiting-human", "verifying"):
            self.seed([{"id": "one", "status": "queued"}])
            target = self.run_dir / "state.json"
            state = json.loads(target.read_text())
            state["status"] = status
            target.write_text(json.dumps(state))
            before = target.read_bytes()
            result = self.shell("scripts/loop/run-cycle.sh", "probe")
            self.assertEqual(json.loads(result.stdout)["status"], "blocked")
            self.assertEqual(target.read_bytes(), before)

    def test_zero_cap_prevents_claim(self):
        self.seed([{"id": "one", "status": "queued"}], maximum=0)
        result = self.shell("scripts/loop/run-cycle.sh", "probe")
        self.assertEqual(json.loads(result.stdout)["reason"], "iteration_limit")
        self.assertEqual(json.loads((self.run_dir / "state.json").read_text())["tasks"][0]["status"], "queued")

    def test_two_callers_claim_once(self):
        self.seed([{"id": 'quoted"task', "status": "queued"}])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            answers = list(executor.map(lambda _: self.shell("scripts/loop/next-task.sh", "probe"), range(2)))
        successes = [answer for answer in answers if answer.returncode == 0]
        self.assertEqual(len(successes), 1, [answer.stdout + answer.stderr for answer in answers])
        self.assertEqual(json.loads(successes[0].stdout)["id"], 'quoted"task')
        self.assertEqual((self.run_dir / ".revision").read_text().strip(), "8")

    def test_empty_queue_has_no_completion_authority(self):
        self.seed([{"id": "one", "status": "done"}])
        result = self.shell("scripts/loop/run-cycle.sh", "probe")
        self.assertEqual(json.loads(result.stdout), {"status": "exhausted", "reason": "queue_empty", "completion_authority": False})

    def test_repeat_create_preserves_history(self):
        self.seed([{"id": "existing", "status": "done"}])
        before = (self.run_dir / "state.json").read_bytes()
        self.assertEqual(self.shell("scripts/state/create-run.sh", "probe", "original").returncode, 0)
        self.assertEqual((self.run_dir / "state.json").read_bytes(), before)
        self.assertNotEqual(self.shell("scripts/state/create-run.sh", "probe", "different").returncode, 0)
        self.assertEqual((self.run_dir / "state.json").read_bytes(), before)

    def test_malformed_tool_preserves_process_and_mcp_content(self):
        self.seed([{"id": "one", "status": "done"}])
        frames = [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "run_check", "arguments": {"run_id": "probe", "task_id": "one"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "summarize_verification", "arguments": {"run_id": "probe"}}},
        ]
        result = self.shell("mcp/verification/server.sh", data="".join(json.dumps(frame) + "\n" for frame in frames))
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(replies[0]["error"]["code"], -32602)
        summary = json.loads(replies[1]["result"]["content"][0]["text"])
        self.assertEqual(summary["completed_tasks"], 1)

    def test_session_resume_scans_past_terminal_run(self):
        self.seed([])
        target = self.run_dir / "state.json"
        state = json.loads(target.read_text())
        state["status"] = "complete"
        target.write_text(json.dumps(state))
        active = self.run_dir.parent / "z-active"
        active.mkdir()
        state.update(run_id="z-active", status="executing", plan_name="ACTIVE_PROBE")
        (active / "state.json").write_text(json.dumps(state))
        result = self.shell("scripts/hooks/session-start.sh", data=json.dumps({"cwd": str(self.root), "session_id": "fixture"}))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ACTIVE_PROBE", result.stdout)

    def test_legacy_task_text_is_data(self):
        if PRODUCT not in ("lazybuddy", "lazyqoder"):
            self.skipTest("legacy task hook is not declared by this product")
        self.seed([{"id": "one", "status": "done"}])
        marker = self.root / "injection-marker"
        subject = "x''', '__probe': __import__('pathlib').Path(" + repr(str(marker)) + ").write_text('executed'), 'tail': '''x"
        payload = {"cwd": str(self.root), "task_id": "fixture", "task_subject": subject}
        result = self.shell("scripts/hooks/task-completed.sh", data=json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())
        state = json.loads((self.run_dir / "state.json").read_text())
        self.assertEqual(state["progress"]["completed_checkboxes"], 1)
        events = [json.loads(line) for line in (self.run_dir / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events[-1]["subject"], subject[:200])

    def test_legacy_evidence_rejects_sibling_prefix(self):
        if PRODUCT not in ("lazybuddy", "lazyqoder"):
            self.skipTest("legacy subagent gate is not declared by this product")
        outside = self.root / ("." + PRODUCT + "-evil") / "evidence.md"
        outside.parent.mkdir()
        outside.write_text("outside evidence")
        payload = {"cwd": str(self.root), "session_id": "fixture", "agent_id": "fixture", "agent_type": "implementer",
                   "last_assistant_message": "EVIDENCE_RECORDED: " + str(outside)}
        result = self.shell("scripts/hooks/subagent-stop.sh", data=json.dumps(payload))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)["continue"])

    def test_permission_hook_respects_transaction_lock(self):
        self.seed([])
        before = (self.run_dir / "state.json").read_bytes()
        consumer = "hooks/permission-record.js" if PRODUCT == "lazykimi" else "scripts/hooks/lifecycle-event.js"
        payload = {"cwd": str(self.root), "session_id": "fixture", "permission_mode": "default", "request_id": "fixture-request", "tool_name": "Bash", "reason": "fixture", "hook_event_name": "PermissionRequest"}
        with (self.run_dir / ".transaction.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = subprocess.run(["node", str(PLUGIN / consumer)], input=json.dumps(payload), text=True, env=self.env, capture_output=True, timeout=12)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((self.run_dir / "state.json").read_bytes(), before)
            self.assertEqual((self.run_dir / ".revision").read_text().strip(), "7")


if __name__ == "__main__":
    unittest.main()
