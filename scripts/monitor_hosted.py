#!/usr/bin/env python3
"""One credential-safe health sample; scheduled by replicate-mcp-monitor.timer."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def inspect_logs(raw, host):
    """Return counts only. Never retain or report original log payloads."""
    counts = {"stack_overflows": 0, "credential_patterns": 0,
              "credential_headers": 0, "request_queries": 0}
    for line in raw.splitlines():
        counts["stack_overflows"] += "Maximum call stack size exceeded" in line
        counts["credential_patterns"] += bool(re.search(r"r8_[A-Za-z0-9_-]{20,}", line))
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        request = entry.get("request", {})
        if not isinstance(request, dict):
            request = {}
        headers = request.get("headers", {})
        if isinstance(headers, dict):
            counts["credential_headers"] += any(
                key.lower() == "x-replicate-api-token" and bool(value)
                for key, value in headers.items()
            )
        if request.get("host") == host:
            counts["request_queries"] += "?" in str(request.get("uri", ""))
        counts["request_queries"] += "?" in str(entry.get("url", ""))
    return counts


def container_issues(current, previous):
    failures = []
    if current["status"] != "running":
        failures.append("container_not_running")
    if previous:
        if current["id"] != previous.get("id"):
            failures.append("container_recreated")
        elif current["restarts"] > previous.get("restarts", 0):
            failures.append("container_restarted")
    return failures


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          errors="replace", timeout=20)


def write_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)


def main():
    os.umask(0o077)
    state_dir = pathlib.Path(os.getenv("STATE_DIRECTORY", "/var/lib/replicate-mcp-monitor"))
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_file = state_dir / "state.json"
    previous = {}
    failures = []
    try:
        previous = json.loads(state_file.read_text())
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        failures.append("previous_state_unreadable")
    now = utc_now()
    # Bounded catch-up after host downtime; gaps are explicitly reported.
    since = now - datetime.timedelta(minutes=5)
    if previous.get("checked_at"):
        try:
            since = datetime.datetime.fromisoformat(previous["checked_at"])
            if (now - since).total_seconds() > 900:
                failures.append("monitoring_gap")
                since = now - datetime.timedelta(minutes=15)
        except (TypeError, ValueError):
            failures.append("previous_timestamp_invalid")
    url = os.getenv("REPLICATE_MONITOR_URL", "https://replicate-mcp.sena-labs.dev/health")
    host = urllib.parse.urlsplit(url).hostname
    names = os.getenv("REPLICATE_MONITOR_CONTAINERS", "replicate-mcp,replicate-mcp-caddy").split(",")
    report = {"checked_at": now.isoformat(), "log_since": since.isoformat(),
              "containers": {}, "log_counts": {}, "failures": failures}
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            report["health_http"] = response.status
            health = json.load(response)
            if response.status != 200 or health.get("status") != "ok":
                failures.append("https_health_failed")
            if health.get("token_pool_size") != 0:
                failures.append("public_server_token_pool_nonzero_or_unknown")
    except Exception:
        failures.append("https_health_unavailable")
    for name in names:
        try:
            item = json.loads(command("docker", "inspect", name).stdout)[0]
            current = {"id": item["Id"], "status": item["State"]["Status"],
                       "restarts": item["RestartCount"]}
            report["containers"][name] = current
            failures.extend(name + ":" + issue for issue in container_issues(
                current, previous.get("containers", {}).get(name)))
            logs = command("docker", "logs", "--since", since.isoformat(), name)
            counts = inspect_logs(logs.stdout + logs.stderr, host)
            report["log_counts"][name] = counts
            failures.extend(name + ":" + key for key, count in counts.items() if count)
        except Exception:
            # Exception text may contain subprocess payloads; emit a fixed code.
            failures.append(name + ":inspection_failed")
    report["ok"] = not failures
    if previous and previous.get("ok") is False and report["ok"]:
        report["event"] = "recovered"
    else:
        report["event"] = "healthy" if report["ok"] else "alert"
    write_json(state_file, report)
    print(json.dumps(report, separators=(",", ":")), flush=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
