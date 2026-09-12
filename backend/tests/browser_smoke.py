"""Exercise the built web client against a disposable FastAPI and SQLite instance."""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_server(url: str) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("FastAPI did not become ready within 20 seconds")


def main() -> None:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to build the web client")
    subprocess.run([npm, "run", "build:web"], cwd=ROOT, check=True)
    if not shutil.which("node"):
        raise RuntimeError("Node.js is required for the Playwright browser driver")
    port = free_port()
    with tempfile.TemporaryDirectory(prefix="zhishu-browser-", ignore_cleanup_errors=True) as directory:
        database = Path(directory) / "smoke.db"
        environment = os.environ | {
            "DATABASE_URL": f"sqlite:///{database.as_posix()}",
            "WEB_DIST": str(ROOT / "apps" / "web" / "dist"),
            "APP_ENV": "test",
        }
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=BACKEND,
            env=environment,
        )
        try:
            wait_for_server(f"http://127.0.0.1:{port}/healthz")
            subprocess.run(["node", str(BACKEND / "tests" / "browser_smoke_runner.mjs"), f"http://127.0.0.1:{port}"], cwd=ROOT, env=environment, check=True)
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
