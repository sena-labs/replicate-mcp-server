import importlib.util
import contextlib
import io
import json
import pathlib
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[2] / "scripts/monitor_hosted.py"
spec = importlib.util.spec_from_file_location("monitor_hosted", path)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def test_sensitive_values_never_appear_in_counts(self):
        token = "r8_" + "x" * 40
        raw = json.dumps({"request": {"host": "example.test", "uri": "/mcp?key=" + token,
                         "headers": {"X-Replicate-Api-Token": [token]}}})
        result = monitor.inspect_logs(raw, "example.test")
        self.assertEqual(result["credential_patterns"], 1)
        self.assertEqual(result["credential_headers"], 1)
        self.assertEqual(result["request_queries"], 1)
        self.assertNotIn(token, json.dumps(result))

    def test_clean_logs_are_healthy(self):
        result = monitor.inspect_logs(json.dumps({"request": {"host": "example.test", "uri": "/mcp"}}), "example.test")
        self.assertFalse(any(result.values()))

    def test_plain_stack_trace_and_application_query_are_detected(self):
        raw = "RangeError: Maximum call stack size exceeded\n" + json.dumps({"url": "/mcp?replicate_api_token=canary"})
        result = monitor.inspect_logs(raw, "example.test")
        self.assertEqual(result["stack_overflows"], 1)
        self.assertEqual(result["request_queries"], 1)

    def test_restart_and_recreation_are_distinct(self):
        previous = {"id": "one", "status": "running", "restarts": 2}
        self.assertEqual(monitor.container_issues(previous, previous), [])
        self.assertEqual(monitor.container_issues({**previous, "restarts": 3}, previous), ["container_restarted"])
        self.assertEqual(monitor.container_issues({**previous, "id": "two", "restarts": 0}, previous), ["container_recreated"])
        self.assertEqual(monitor.container_issues({**previous, "status": "exited"}, previous), ["container_not_running"])

    def test_failed_inspection_is_redacted_and_next_sample_recovers(self):
        token = "r8_" + "y" * 40

        def health(*args, **kwargs):
            response = io.BytesIO(b'{"status":"ok","token_pool_size":0}')
            response.status = 200
            return response

        def command(*args):
            if args[1] == "inspect":
                return types.SimpleNamespace(stdout=json.dumps([{
                    "Id": "fixed", "State": {"Status": "running"}, "RestartCount": 0,
                }]), stderr="")
            return types.SimpleNamespace(stdout="", stderr="")

        with tempfile.TemporaryDirectory() as directory, patch.dict(monitor.os.environ, {
            "STATE_DIRECTORY": directory, "REPLICATE_MONITOR_CONTAINERS": "replicate-mcp",
        }), patch.object(monitor.urllib.request, "urlopen", side_effect=health):
            output = io.StringIO()
            with patch.object(monitor, "command", side_effect=subprocess.CalledProcessError(1, "docker", output=token)), contextlib.redirect_stdout(output):
                self.assertEqual(monitor.main(), 1)
            path = pathlib.Path(directory) / "state.json"
            self.assertNotIn(token, output.getvalue() + path.read_text())
            self.assertEqual(json.loads(path.read_text())["event"], "alert")
            with patch.object(monitor, "command", side_effect=command), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(monitor.main(), 0)
            self.assertEqual(json.loads(path.read_text())["event"], "recovered")


if __name__ == "__main__":
    unittest.main()
