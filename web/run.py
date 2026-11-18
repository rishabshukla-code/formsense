"""Start everything the web app needs, then open it in the browser.

1. LiveKit server in dev mode (tools/livekit/livekit-server.exe, or one on PATH)
2. The voice agent worker (src/agent.py dev)
3. The web server (web/server.py) on http://localhost:3000

Press Ctrl+C to stop all three.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("WEB_PORT", "3000"))
PY = sys.executable


def find_livekit_server() -> str:
    exe = "livekit-server.exe" if os.name == "nt" else "livekit-server"
    bundled = ROOT / "tools" / "livekit" / exe
    if bundled.exists():
        return str(bundled)
    on_path = shutil.which("livekit-server")
    if on_path:
        return on_path
    sys.exit(
        "livekit-server not found. Put it in tools/livekit/ or install it "
        "(https://github.com/livekit/livekit/releases)."
    )


def wait_for_port(port: int, name: str, timeout: float = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.3)
    raise RuntimeError(f"{name} did not start on port {port}")


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":  # also stops the agent's job subprocesses
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True
        )
    else:
        proc.terminate()


def start_agent(env: dict) -> tuple[subprocess.Popen, threading.Event]:
    """Start the agent worker, echo its log, and flag when LiveKit has registered it.

    Until then LiveKit has no agent to send into new rooms, so a click on
    Start talking would wait forever.
    """
    ready = threading.Event()
    proc = subprocess.Popen(
        [PY, "src/agent.py", "dev"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    def pump() -> None:
        # Keep reading no matter what: if this loop stops, the agent blocks as
        # soon as its output pipe fills up.
        for line in proc.stdout:
            if "registered worker" in line:
                ready.set()
            try:
                print(line, end="", flush=True)
            except Exception:
                pass

    threading.Thread(target=pump, daemon=True).start()
    return proc, ready


def main() -> None:
    if not (ROOT / ".env.local").exists():
        sys.exit("Missing .env.local. Copy .env.example and add ASSEMBLYAI_API_KEY.")

    # Agent logs contain characters (like "·") that older Windows encodings
    # can't print; show a placeholder instead of crashing.
    sys.stdout.reconfigure(errors="replace")

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    env.pop("HTTPS_PROXY", None)  # LiveKit's worker would route localhost through it
    procs: list[subprocess.Popen] = []
    try:
        print("Starting LiveKit server…", flush=True)
        procs.append(
            subprocess.Popen(
                [find_livekit_server(), "--dev", "--bind", "127.0.0.1"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait_for_port(7880, "LiveKit server")

        print("Starting voice agent… (this can take up to a minute)", flush=True)
        agent, agent_ready = start_agent(env)
        procs.append(agent)

        print("Starting web app…", flush=True)
        procs.append(subprocess.Popen([PY, "web/server.py"], cwd=ROOT, env=env))
        wait_for_port(PORT, "Web app")

        deadline = time.time() + 120
        while not agent_ready.wait(0.5):
            if agent.poll() is not None or time.time() > deadline:
                raise RuntimeError("The voice agent did not start. See the log above.")

        url = f"http://localhost:{PORT}"
        print(f"\nReady: {url}  (Ctrl+C to stop)\n", flush=True)
        if os.environ.get("NO_BROWSER") != "1":
            webbrowser.open(url)

        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        print("A process exited; shutting down.", flush=True)
    except KeyboardInterrupt:
        print("\nStopping…", flush=True)
    except RuntimeError as err:
        print(f"\n{err}", flush=True)
    finally:
        for p in reversed(procs):
            stop(p)


if __name__ == "__main__":
    main()
