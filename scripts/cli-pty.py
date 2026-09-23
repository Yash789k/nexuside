"""POSIX terminal integration: python3 scripts/cli-pty.py [installed cli.cjs]."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import sys
import tempfile
import time

cli = str(Path(sys.argv[1] if len(sys.argv) > 1 else "dist/cli.cjs").resolve())
node = shutil.which("node")
assert node
results = []
evidence = Path("../nexuside-qa-evidence")
evidence.mkdir(exist_ok=True)


def scenario(name, responses, cancel=False):
    with tempfile.TemporaryDirectory(prefix="nexus pty 空間 ") as root:
        workspace = Path(root) / "demo files"
        env = {**os.environ, "NEXUS_CONFIG": str(Path(root) / "config.json"), "TERM": "xterm-256color"}
        pid, master = pty.fork()
        if pid == 0:
            os.execvpe(node, [node, cli, "demo", str(workspace), "--host"], env)
        transcript = b""
        answered = 0
        status = None
        deadline = time.monotonic() + 25
        try:
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError as exc:
                        if exc.errno == errno.EIO:
                            chunk = b""
                        else:
                            raise
                    transcript += chunk
                    count = transcript.count(b"Approve this action? [y/N]")
                    if count > answered:
                        if cancel:
                            os.write(master, b"\x03")
                        else:
                            os.write(master, responses[answered].encode() + b"\n")
                        answered += 1
                done, child_status = os.waitpid(pid, os.WNOHANG)
                if done:
                    status = child_status
                    break
            assert status is not None, "CLI did not exit within 25 seconds"
            code = os.waitstatus_to_exitcode(status)
            runs = list((workspace / ".nexus" / "runs").glob("*.json"))
            assert len(runs) == 1
            run = json.loads(runs[0].read_text())
            record = {"name": name, "exitCode": code, "prompts": answered, "runStatus": run["status"], "testCount": len(run["tests"])}
            results.append(record)
            if cancel:
                assert code == 130, record
                assert run["status"] == "cancelled", record
            else:
                assert code == 0, record
                assert answered == len(responses), record
                assert run["status"] == "completed", record
                assert len(run["tests"]) == 0, record
                assert "fibonacci" in (workspace / "src/fibonacci.mjs").read_text()
        finally:
            if status is None:
                os.killpg(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            os.close(master)
            (evidence / f"cli-pty-{name}.log").write_bytes(transcript)


try:
    scenario("approve-reject", ["y", "n"])
    scenario("cancel-pending", [], cancel=True)
finally:
    (evidence / "cli-pty.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
