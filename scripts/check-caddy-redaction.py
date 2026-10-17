#!/usr/bin/env python3
"""Exercise access AND proxy-error redaction in an isolated Caddy container.

Usage: python3 scripts/check-caddy-redaction.py [Caddy image]
No host ports, API calls, or real credentials are used.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import time
import uuid


def command(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else "caddy:2-alpine"
    name = "replicate-log-check-" + uuid.uuid4().hex[:10]
    source = pathlib.Path(__file__).resolve().parents[1] / "deploy/Caddyfile"
    # Reuse the exact production formatter rather than duplicating its policy.
    text = source.read_text()
    start = text.index("format filter {")
    depth, end = 0, start
    for end in range(text.index("{", start), len(text)):
        if text[end] == "{":
            depth += 1
        elif text[end] == "}":
            depth -= 1
            if depth == 0:
                break
    formatter = text[start:end + 1]
    assert "request>headers delete" in formatter
    config = """{
      admin off
      auto_https off
      log default {\nFORMAT\n}
    }
    :18088 {
      log {\noutput stdout\nFORMAT\n}
      handle /fail {
        reverse_proxy 127.0.0.1:1
      }
      handle {
        respond "ok"
      }
    }
    """.replace("FORMAT", formatter)
    marker = "credential-canary-" + uuid.uuid4().hex
    try:
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "Caddyfile"
            path.write_text(config)
            command("docker", "create", "--name", name, "--network", "none", "--entrypoint", "caddy", image,
                    "run", "--config", "/tmp/Caddyfile", "--adapter", "caddyfile")
            command("docker", "cp", str(path), name + ":/tmp/Caddyfile")
            command("docker", "start", name)
            for _ in range(40):
                ready = command("docker", "exec", name, "wget", "-qO-",
                                "http://127.0.0.1:18088/ready", check=False)
                if ready.returncode == 0:
                    break
                time.sleep(0.1)
            else:
                logs = command("docker", "logs", name)
                raise RuntimeError("Caddy did not become ready: " + logs.stderr + logs.stdout)
            for path in ("/ok", "/fail"):
                command("docker", "exec", name, "wget", "-qO-",
                        "--header=X-Replicate-Api-Token: " + marker,
                        "http://127.0.0.1:18088" + path + "?replicate_api_token=" + marker,
                        check=False)
            command("docker", "stop", "--time", "2", name)
            logs = command("docker", "logs", name)
            raw = logs.stdout + logs.stderr
            assert marker not in raw, "Credential canary leaked into Caddy logs"
            records = []
            for line in raw.splitlines():
                try:
                    records.append(json.loads(line))
                except ValueError:
                    pass
            access = [r for r in records if r.get("logger", "").startswith("http.log.access")]
            errors = [r for r in records if r.get("logger", "").startswith("http.log.error")]
            assert any(r.get("status") == 200 for r in access)
            assert any(r.get("status") == 502 for r in access)
            assert errors, "No runtime proxy error was exercised"
            for record in access + errors:
                request = record.get("request", {})
                assert "headers" not in request
                assert "?" not in request.get("uri", "")
            print("PASS: access 200/502 and runtime error logs redact header/query canaries")
    finally:
        command("docker", "rm", "-f", name, check=False)


if __name__ == "__main__":
    main()
