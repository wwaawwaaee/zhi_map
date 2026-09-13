"""Opt-in Windows packaged WebView2 test; never uses the real user's app data.

Run: py desktop/tests/packaged_smoke.py --parent <existing temporary directory>
Requires playwright, Pillow and pywin32 in the test interpreter.
"""
import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import zipfile
from urllib.request import urlopen

import win32con
import win32api
import win32crypt
import win32gui
import win32process
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import ImageGrab
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def inspect_existing_state():
    """Read only: never start the app against the user's real profile."""
    directory = Path(os.environ["LOCALAPPDATA"]) / "Zhishu"
    hashes = {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in directory.rglob("*") if p.is_file()}
    report = {"directory": str(directory), "files_hashed": len(hashes)}
    key = directory / "master-key.dpapi"
    if key.is_file() and key.stat().st_size:
        report["dpapi_key_valid"] = len(win32crypt.CryptUnprotectData(key.read_bytes(), None, None, None, 0)[1]) == 32
    db = directory / "zhishu.db"
    if db.is_file():
        with sqlite3.connect(db.as_uri() + "?mode=ro&immutable=1", uri=True) as connection:
            report["database_integrity"] = connection.execute("PRAGMA quick_check").fetchone()[0]
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            report["row_counts"] = {name: connection.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
                                    for name in ("users", "auth_sessions", "user_ai_configs") if name in tables}
    return hashes, report


def native_modules(pid):
    handle = win32api.OpenProcess(win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
    try:
        modules = [win32process.GetModuleFileNameEx(handle, module) for module in win32process.EnumProcessModules(handle)]
        assert not any(str(ROOT).lower() in path.lower() or "c:\\python313" in path.lower() for path in modules), modules
        assert any(path.lower().endswith("webview2loader.dll") for path in modules)
        assert any(path.lower().endswith("clrloader.dll") for path in modules)
        return modules
    finally:
        handle.Close()


def window_for(pid):
    windows = []
    win32gui.EnumWindows(lambda hwnd, _: windows.append(hwnd) if win32process.GetWindowThreadProcessId(hwnd)[1] == pid and win32gui.IsWindowVisible(hwnd) else None, None)
    return windows[0] if windows else None


def verify_native_error(exe, directory, environment):
    local = directory / "native-error-data"
    app = local / "Zhishu"
    app.mkdir(parents=True)
    key = app / "master-key.dpapi"
    key.write_bytes(b"isolated-corrupt-key")
    process = subprocess.Popen([str(exe)], cwd=directory, env=environment | {"LOCALAPPDATA": str(local)})
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            hwnd = window_for(process.pid)
            if hwnd and win32gui.GetWindowText(hwnd) == "知树无法启动":
                break
            assert process.poll() is None, "Native error dialog was not shown"
            time.sleep(.1)
        else:
            raise AssertionError("No native error dialog")
        ImageGrab.grab(bbox=win32gui.GetWindowRect(hwnd)).save(directory / "native-error.png")
        buttons = []
        win32gui.EnumChildWindows(hwnd, lambda child, _: buttons.append(child) if win32gui.GetClassName(child).lower() == "button" else None, None)
        assert buttons, "Native error confirmation is missing"
        win32gui.PostMessage(buttons[0], win32con.BM_CLICK, 0, 0)
        assert process.wait(timeout=20) == 1
        assert key.read_bytes() == b"isolated-corrupt-key"
        assert "Desktop startup failed" in (app / "logs/desktop.log").read_text(encoding="utf-8")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def main():
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--inspect-existing", action="store_true", help="Opt in to read-only inspection of the real desktop profile")
    args = parser.parse_args()
    assert args.parent.is_dir()
    user_hashes, user_report = inspect_existing_state() if args.inspect_existing else ({}, {"skipped": True})
    directory = Path(tempfile.mkdtemp(prefix="zhishu-packaged-", dir=args.parent))
    # An unrelated launch directory must not supply backend configuration.
    (directory / ".env").write_text("AI_TIMEOUT_MS=not-an-integer\nDATABASE_URL=not-a-database\n", encoding="utf-8")
    appdata = directory / "Zhishu"
    appdata.mkdir()
    # Reproduce the legacy zero-byte file on first boot.
    (appdata / "master-key.dpapi").touch()
    archive = args.zip or directory / "baseline.zip"
    if not args.zip:
        source = ROOT / "desktop/dist/Zhishu"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(source.parent).as_posix())
    migrated = directory / "中文 空格 迁移"
    with zipfile.ZipFile(archive) as package:
        assert package.testzip() is None
        assert all(name.startswith("Zhishu/") and ".." not in Path(name).parts for name in package.namelist())
        package.extractall(migrated)
        hashes = {}
        for item in package.infolist():
            if not item.is_dir():
                digest = hashlib.sha256(package.read(item)).hexdigest()
                assert hashlib.sha256((migrated / item.filename).read_bytes()).hexdigest() == digest
                hashes[item.filename] = digest
    exe = migrated / "Zhishu/Zhishu.exe"
    evidence = {"directory": str(directory), "exe": str(exe), "zip_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "verified_files": len(hashes), "file_hashes": hashes, "existing_state_read_only": user_report, "exe_sha256": hashlib.sha256(exe.read_bytes()).hexdigest(), "runs": []}
    previous_cookie = previous_workspace = previous_key = None
    print(f"Evidence directory: {directory}", flush=True)
    with sync_playwright() as playwright:
        for cycle in range(2):
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                debug_port = sock.getsockname()[1]
            blocked = {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "APP_ENV", "HOST", "PORT", "DATABASE_URL", "DATA_ENCRYPTION_KEY", "WEB_DIST"}
            environment = {k: v for k, v in os.environ.items() if k.upper() not in blocked and not k.upper().startswith(("AI_", "UVICORN_", "PYTHONNET_", "DOTNET_"))}
            environment["PATH"] = str(Path(os.environ["SystemRoot"]) / "System32") + ";" + os.environ["SystemRoot"]
            environment.update(LOCALAPPDATA=str(directory), ZHISHU_WEBVIEW_DEBUG_PORT=str(debug_port))
            process = subprocess.Popen([str(exe)], cwd=directory, env=environment)
            browser = None
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    assert process.poll() is None, f"Packaged process exited during startup: {process.returncode}"
                    hwnd = window_for(process.pid)
                    if hwnd:
                        ImageGrab.grab(bbox=win32gui.GetWindowRect(hwnd)).save(directory / "startup-window.png")
                    try:
                        with urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=1) as response:
                            version = json.load(response)
                        break
                    except OSError:
                        time.sleep(.25)
                else:
                    hwnd = window_for(process.pid)
                    if hwnd:
                        ImageGrab.grab(bbox=win32gui.GetWindowRect(hwnd)).save(directory / "startup-failure.png")
                        print("Window:", win32gui.GetWindowText(hwnd))
                    print("Process TCP:", [line for line in subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout.splitlines() if line.split() and line.split()[-1] == str(process.pid)])
                    raise RuntimeError("WebView2 CDP did not become ready")
                browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{debug_port}")
                context = browser.contexts[0]
                page = context.pages[0]
                page.wait_for_url("http://127.0.0.1:*/", timeout=30000)
                page.locator("#create").wait_for()
                page.wait_for_load_state("networkidle")
                ready = page.evaluate("fetch('/readyz').then(r=>r.json())")
                assert ready["status"] == "ready"
                cookie = next(c for c in context.cookies() if c["name"] == "zhishu_session")
                assert cookie["secure"] and cookie["httpOnly"] and cookie["expires"] > time.time()
                if cycle == 0:
                    page.screenshot(path=str(directory / "homepage.png"))
                    page.locator("#create").click()
                    page.locator("#chat-header h1").filter(has_text="新的学习问题").wait_for()
                    # Use the visible settings form, not a synthetic API save.
                    page.locator("#settings-button").click()
                    page.locator("#ai-base-url").fill("https://api.openai.com/v1")
                    page.locator("#ai-model").fill("desktop-persistence-test")
                    page.locator("#ai-key").fill("sk-desktop-isolated-test-not-a-real-key")
                    with page.expect_response(lambda r: r.url.endswith('/api/ai/config') and r.request.method == 'POST') as saved:
                        page.locator("#save-ai-config").click()
                    assert saved.value.status == 200
                    page.wait_for_load_state("networkidle")
                    page.locator("#close-modal").click()
                    with page.expect_response(lambda r: '/api/workspace/actions' in r.url and r.request.method == 'POST' and r.request.post_data_json.get('type') == 'draft') as draft_saved:
                        page.locator("#draft").fill("打包持久化 😀 draft")
                    assert draft_saved.value.status == 200
                    # Exercise lazy-imported transfer modules and final SQL copy in
                    # the frozen binary, not the development Python interpreter.
                    transfer = page.evaluate("""async () => {
                        const v = await (await fetch('/api/workspace/view')).json();
                        const response = await fetch('/api/export/ndjson');
                        if (!response.ok) throw Error('Packaged export failed');
                        const text = await response.text();
                        if (!text.includes('打包持久化 😀 draft')) throw Error('Draft missing from packaged export');
                        const imported = await fetch('/api/import/ndjson?revision=' + v.revision, {method: 'POST', headers: {'content-type': 'application/x-ndjson'}, body: text});
                        return {status: imported.status, result: await imported.json()};
                    }""")
                    assert transfer["status"] == 200 and transfer["result"]["counts"]["branch"] == 1
                    page.reload(wait_until="networkidle")
                else:
                    assert cookie["value"] == previous_cookie, "Session changed across app restart"
                    page.locator("#chat-header h1").filter(has_text="新的学习问题").wait_for()
                    assert page.locator("#draft").input_value() == "打包持久化 😀 draft"
                workspace = page.evaluate("fetch('/api/workspace').then(r=>r.json())")
                config = page.evaluate("fetch('/api/ai/config').then(r=>r.json())")
                assert config["configured"] and config["model"] == "desktop-persistence-test"
                blob = (appdata / "master-key.dpapi").read_bytes()
                key = win32crypt.CryptUnprotectData(blob, None, None, None, 0)[1]
                assert len(key) == 32
                if cycle:
                    assert workspace == previous_workspace
                    assert blob == previous_key
                with sqlite3.connect(appdata / "zhishu.db") as db:
                    assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0004_delete_tombstones"
                    assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
                    row = db.execute("SELECT user_id,version,encrypted_key,nonce,auth_tag FROM user_ai_configs").fetchone()
                    plaintext = AESGCM(key).decrypt(base64.b64decode(row[3]), base64.b64decode(row[2]) + base64.b64decode(row[4]), f"{row[0]}:{row[1]}".encode())
                    assert plaintext == b"sk-desktop-isolated-test-not-a-real-key"
                    assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
                    assert db.execute("SELECT count(*) FROM auth_sessions").fetchone()[0] == 1
                page.screenshot(path=str(directory / f"webview-{cycle}.png"))
                hwnd = window_for(process.pid)
                assert hwnd, "No visible native GUI window"
                modules = native_modules(process.pid)
                (directory / f"native-modules-{cycle}.json").write_text(json.dumps(modules, ensure_ascii=False, indent=2), encoding="utf-8")
                ImageGrab.grab(bbox=win32gui.GetWindowRect(hwnd)).save(directory / f"native-window-{cycle}.png")
                evidence["runs"].append({"pid": process.pid, "url": page.url, "webview_version": version["Browser"], "ready": ready, "secure_cookie_accepted": True, "dpapi_blob_bytes": len(blob), "credential_decrypted": True, "same_identity": True, "workspace_revision": workspace["revision"]})
                previous_cookie, previous_workspace, previous_key = cookie["value"], workspace, blob
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                process.wait(timeout=20)
                assert process.returncode == 0
                evidence["runs"][-1]["exit_code"] = process.returncode
                time.sleep(2)
            finally:
                if process.poll() is None:
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, capture_output=True)
                    process.wait(timeout=10)
                if browser:
                    browser.close()
                if args.inspect_existing:
                    assert inspect_existing_state()[0] == user_hashes, "Real user data changed during isolated test"
                evidence["real_profile_accessed"] = args.inspect_existing
                if args.inspect_existing:
                    evidence["existing_state_unchanged"] = True
                (directory / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    verify_native_error(exe, directory, environment)
    evidence["native_error_dialog_verified"] = True
    if args.inspect_existing:
        assert inspect_existing_state()[0] == user_hashes
    (directory / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in evidence.items() if k != "file_hashes"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
