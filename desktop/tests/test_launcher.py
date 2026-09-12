import importlib.util
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pytest


SPEC = importlib.util.spec_from_file_location("zhishu_launcher", Path(__file__).parents[1] / "launcher.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


@pytest.fixture
def crypt():
    if sys.platform != "win32":
        pytest.skip("Requires real Windows DPAPI")
    return pytest.importorskip("win32crypt")


def database(directory, credentials=False):
    from app.db import Base, User, UserAiConfig, utcnow
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    engine = create_engine(f"sqlite:///{(directory / 'zhishu.db').as_posix()}")
    Base.metadata.create_all(engine)
    if credentials:
        with Session(engine) as session:
            session.add(User(id="test", created_at=utcnow()))
            session.flush()
            session.add(UserAiConfig(user_id="test", version=1, base_url="https://example.com/v1", model="test", timeout_ms=1000, encrypted_key="saved-ciphertext", nonce="nonce", auth_tag="tag", updated_at=utcnow()))
            session.commit()
    engine.dispose()


def test_real_dpapi_contract_and_persistence(tmp_path, crypt):
    blob = launcher.protect_key(b"x" * 32, crypt)
    assert isinstance(blob, bytes)
    assert launcher.unprotect_key(blob, crypt) == b"x" * 32
    first = launcher.load_or_create_key(tmp_path, crypt)
    assert len(first) == 32
    assert launcher.load_or_create_key(tmp_path, crypt) == first


def test_corruption_is_not_replaced(tmp_path, crypt):
    (tmp_path / launcher.KEY_FILE).write_bytes(b"corrupt")
    with pytest.raises(RuntimeError, match="不要删除"):
        launcher.load_or_create_key(tmp_path, crypt)
    assert (tmp_path / launcher.KEY_FILE).read_bytes() == b"corrupt"


def test_empty_key_recovery_with_actual_schema(tmp_path, crypt):
    database(tmp_path)
    before = (tmp_path / "zhishu.db").read_bytes()
    (tmp_path / launcher.KEY_FILE).touch()
    key = launcher.load_or_create_key(tmp_path, crypt)
    assert launcher.load_or_create_key(tmp_path, crypt) == key
    assert (tmp_path / "zhishu.db").read_bytes() == before


@pytest.mark.parametrize("empty", [True, False])
def test_credentials_block_empty_or_missing_key(tmp_path, crypt, empty):
    database(tmp_path, credentials=True)
    before = (tmp_path / "zhishu.db").read_bytes()
    path = tmp_path / launcher.KEY_FILE
    if empty:
        path.touch()
    with pytest.raises(RuntimeError, match="从备份恢复"):
        launcher.load_or_create_key(tmp_path, crypt)
    assert (tmp_path / "zhishu.db").read_bytes() == before
    assert path.read_bytes() == b"" if empty else not path.exists()


@pytest.mark.parametrize("unknown_schema", [True, False])
def test_unreadable_or_unknown_database_blocks_recovery(tmp_path, crypt, unknown_schema):
    path = tmp_path / "zhishu.db"
    if unknown_schema:
        with sqlite3.connect(path) as connection:
            connection.execute("CREATE TABLE unknown (secret TEXT)")
    else:
        path.write_bytes(b"broken database")
    with pytest.raises(RuntimeError, match="无法安全重建"):
        launcher.load_or_create_key(tmp_path, crypt)
    assert not (tmp_path / launcher.KEY_FILE).exists()


def test_atomic_replace_failure_preserves_empty_key(tmp_path, crypt, monkeypatch):
    path = tmp_path / launcher.KEY_FILE
    path.touch()
    def fail(*args):
        raise OSError("simulated replace failure")
    monkeypatch.setattr(launcher.os, "replace", fail)
    with pytest.raises(RuntimeError, match="保存"):
        launcher.load_or_create_key(tmp_path, crypt)
    assert path.read_bytes() == b""
    assert not list(tmp_path.glob("master-key-*.tmp"))


def concurrent_key(directory):
    import win32crypt
    return launcher.load_or_create_key(Path(directory), win32crypt)


def test_concurrent_processes_share_key(tmp_path, crypt):
    with ProcessPoolExecutor(max_workers=4) as pool:
        keys = list(pool.map(concurrent_key, [str(tmp_path)] * 8))
    assert len(set(keys)) == 1


def test_wait_for_ready_accepts_only_a_ready_response():
    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): pass
    launcher.wait_for_ready("http://example.test/readyz", timeout=0.1, opener=lambda *_args, **_kwargs: Response())
