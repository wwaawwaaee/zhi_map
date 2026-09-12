"""Windows desktop host for 知树."""
from __future__ import annotations

import base64
import logging
import json
import platform
import os
import socket
import sqlite3
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


APP_NAME = "Zhishu"
KEY_FILE = "master-key.dpapi"


def app_directory() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("未找到 LOCALAPPDATA，无法创建知树数据目录。")
    directory = Path(local_app_data) / APP_NAME
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def configure_logging(directory: Path) -> logging.Logger:
    log_directory = directory / "logs"
    log_directory.mkdir(exist_ok=True)
    logger = logging.getLogger(APP_NAME)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.FileHandler(log_directory / "desktop.log", encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s pid=%(process)d %(message)s"))
        logger.addHandler(handler)
    return logger


def protect_key(key: bytes, crypt) -> bytes:
    return crypt.CryptProtectData(key, "Zhishu desktop master key", None, None, None, 0)


def unprotect_key(blob: bytes, crypt) -> bytes:
    return crypt.CryptUnprotectData(blob, None, None, None, 0)[1]


def load_or_create_key(directory: Path, crypt) -> bytes:
    # Serialize cooperating processes before checking/replacing the key. Windows
    # releases this byte-range lock even when a process crashes.
    import msvcrt
    with (directory / "master-key.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"\0")
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            return _load_or_create_key(directory, crypt)
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def assert_no_saved_credentials(directory: Path) -> None:
    database = directory / "zhishu.db"
    if not database.exists():
        return
    try:
        # Read-only: never create, migrate, or repair a user's database here.
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "user_ai_configs" in tables:
                # Any configuration row blocks recovery, including malformed rows.
                if connection.execute("SELECT 1 FROM user_ai_configs LIMIT 1").fetchone():
                    raise ValueError("数据库中已有模型凭据")
            elif tables:
                raise ValueError("数据库结构无法确认")
    except (sqlite3.Error, ValueError) as exc:
        raise RuntimeError(
            f"无法安全重建知树本地密钥：{database}。{exc}。"
            "请从备份恢复 master-key.dpapi，或使用原 Windows 用户登录；保留数据库和密钥文件。"
        ) from exc


def _load_or_create_key(directory: Path, crypt) -> bytes:
    key_path = directory / KEY_FILE
    if key_path.exists() and key_path.stat().st_size:
        try:
            key = unprotect_key(key_path.read_bytes(), crypt)
        except Exception as exc:
            raise RuntimeError(
                f"无法解密知树本地密钥：{key_path}。请使用创建该数据的 Windows 用户登录，"
                "或从备份恢复此文件；不要删除它，否则已保存的模型密钥将无法读取。"
            ) from exc
        if len(key) != 32:
            raise RuntimeError(f"知树本地密钥无效：{key_path}。请从备份恢复该文件。")
        return key
    # The old write_bytes(int) bug could leave an empty file. Recover only
    # after proving there are no credentials; also protect a missing key.
    assert_no_saved_credentials(directory)
    key = os.urandom(32)
    temporary = None
    try:
        blob = protect_key(key, crypt)
        if not isinstance(blob, bytes) or not blob:
            raise TypeError("Windows DPAPI did not return encrypted bytes")
        with tempfile.NamedTemporaryFile(dir=directory, prefix="master-key-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(blob)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, key_path)
    except Exception as exc:
        raise RuntimeError(f"无法用 Windows DPAPI 保存知树本地密钥：{key_path}。") from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return key


def package_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


def configure_environment(directory: Path, key: bytes) -> None:
    # This runs before importing app.main, whose settings are initialized at import time.
    os.environ["APP_ENV"] = "production"
    os.environ["DATABASE_URL"] = f"sqlite:///{(directory / 'zhishu.db').as_posix()}"
    os.environ["DATA_ENCRYPTION_KEY"] = base64.b64encode(key).decode("ascii")
    os.environ["WEB_DIST"] = str(package_root() / "apps" / "web" / "dist")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_ready(url: str, timeout: float = 10, opener=urlopen) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with opener(url, timeout=1) as response:
                if response.status == 200:
                    return
                last_error = RuntimeError(f"服务返回 HTTP {response.status}")
        except (OSError, URLError) as exc:
            last_error = exc
        time.sleep(0.1)
    raise RuntimeError(f"知树服务未能在 {timeout:g} 秒内启动：{last_error}")


def show_error(message: str) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "知树无法启动", 0x10)
    except Exception:
        pass


def run_server(port: int):
    import logging
    import uvicorn
    from app.main import app
    desktop_logger = logging.getLogger(APP_NAME)
    uvicorn_logger = logging.getLogger("uvicorn.error")
    for handler in desktop_logger.handlers:
        uvicorn_logger.addHandler(handler)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", log_config=None))
    thread = threading.Thread(target=server.run, name="zhishu-api")
    thread.start()
    return server, thread


def main() -> int:
    if sys.platform != "win32":
        show_error("知树桌面版仅支持 Windows。请使用 Windows 10 或 Windows 11 运行 Zhishu.exe。")
        return 1
    directory: Path | None = None
    logger = logging.getLogger(APP_NAME)
    server = thread = None
    try:
        directory = app_directory()
        logger = configure_logging(directory)
        root = package_root()
        metadata = root / "build-info.json"
        build = json.loads(metadata.read_text(encoding="utf-8")) if metadata.exists() else {"build_id": "source/unversioned"}
        assets = root / "apps" / "web" / "dist"
        logger.info("Startup build=%s exe=%s cwd=%s root=%s architecture=%s Python=%s assets=%s index_exists=%s",
                    build.get("build_id"), sys.executable, Path.cwd(), root, platform.machine(), platform.python_version(), assets, (assets / "index.html").is_file())
        if not (assets / "index.html").is_file():
            raise RuntimeError("缺少网页资源，请重新完整解压发布 ZIP（保留 _internal 文件夹）。")
        if getattr(sys, "frozen", False):
            # Pydantic reads .env relative to CWD. Never inherit an unrelated
            # launch directory's backend/model settings in the desktop bundle.
            os.chdir(root)
        import win32crypt
        configure_environment(directory, load_or_create_key(directory, win32crypt))
        logger.info("Desktop key loaded; starting local server")
        port = free_port()
        server, thread = run_server(port)
        wait_for_ready(f"http://127.0.0.1:{port}/readyz")
        logger.info("Local server ready on port %s; opening WebView2", port)
        import webview
        for handler in logger.handlers:
            logging.getLogger("pywebview").addHandler(handler)
        import pythonnet
        pythonnet.load("netfx")
        logger.info("Native runtime=%s pythonnet=%s webview=%s", pythonnet.get_runtime_info(), pythonnet.__file__, webview.__file__)
        debug_port = os.environ.get("ZHISHU_WEBVIEW_DEBUG_PORT")
        if debug_port:
            webview.settings["REMOTE_DEBUGGING_PORT"] = int(debug_port)
        window = webview.create_window("知树", f"http://127.0.0.1:{port}", min_size=(900, 600))
        window.events.loaded += lambda: logger.info("WebView page loaded build=%s", build.get("build_id"))
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(directory / "browser-profile"))
        logger.info("Desktop window closed")
        return 0
    except Exception as exc:
        logger.exception("Desktop startup failed")
        log_path = directory / "logs" / "desktop.log" if directory else "不可用"
        show_error(f"{exc}\n\n详细日志：{log_path}")
        return 1
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
