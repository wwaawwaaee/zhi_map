import asyncio
import json
import time
import tracemalloc
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.db import User, Workspace, utcnow
from app.domain.workspace import seed_state
from app.migrations import upgrade
from app.repository import Repository, entries, heads
from app import history_transfer
from app.services import ApiError


@pytest.fixture
def storage(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + (tmp_path / "history.db").as_posix())
    upgrade(engine)
    monkeypatch.setattr(history_transfer, "engine", engine)
    with Session(engine) as db:
        db.add_all(
            [User(id="a", created_at=utcnow()), User(id="b", created_at=utcnow())]
        )
        db.commit()
        Repository(db, "a").ensure()
        Repository(db, "b").ensure()
    yield engine
    engine.dispose()


def test_legacy_migration_retains_original_and_restart(storage):
    state = seed_state()
    original = json.dumps(state, ensure_ascii=False)
    with Session(storage) as db:
        db.execute(heads.delete().where(heads.c.user_id == "a"))
        row = db.get(Workspace, "a")
        row.state = original
        db.commit()
        repo = Repository(db, "a")
        assert repo.snapshot()["state"] == state
        state["branches"][0]["draft"] = "changed"
        repo.replace(state, 0)
        assert db.get(Workspace, "a").state == original
        assert Repository(db, "b").topics(40, -1)["items"] == []
    upgrade(storage)
    with Session(storage) as db:
        assert Repository(db, "a").snapshot()["state"] == state
        assert (
            db.scalar(text("SELECT version_num FROM alembic_version"))
            == "0004_delete_tombstones"
        )


def make_history(path, topics=100, per_topic=100):
    with path.open("wb") as file:
        file.write(
            history_transfer.encode(
                {"type": "manifest", "schemaVersion": 3, "active": "b0"}
            )
        )
        file.write(
            history_transfer.encode(
                {"type": "session", "data": {"id": "s", "title": "stress"}}
            )
        )
        for b in range(topics):
            file.write(
                history_transfer.encode(
                    {
                        "type": "branch",
                        "data": {
                            "id": f"b{b}",
                            "sessionId": "s",
                            "title": f"Topic {b}",
                            "tags": [],
                            "parent": None,
                            "kept": False,
                            "draft": "",
                        },
                    }
                )
            )
        for b in range(topics):
            for e in range(per_topic):
                file.write(
                    history_transfer.encode(
                        {
                            "type": "entry",
                            "branchId": f"b{b}",
                            "data": {
                                "id": f"e{b}-{e}",
                                "role": "user" if e % 2 == 0 else "assistant",
                                "kind": "message",
                                "inherited": False,
                                "text": "Unicode 😀 中文 " + "history " * 100,
                                "source": {
                                    "sessionId": "s",
                                    "sessionTitle": "stress",
                                    "branchId": f"b{b}",
                                    "branchTitle": f"Topic {b}",
                                    "messageId": f"e{b}-{e}",
                                },
                            },
                        }
                    )
                )
        file.write(
            history_transfer.encode({"type": "end", "entries": topics * per_topic})
        )


class Upload:
    def __init__(self, path, interrupt=False):
        self.path, self.interrupt = path, interrupt

    async def stream(self):
        with self.path.open("rb") as file:
            while chunk := file.read(8192):
                yield chunk
                if self.interrupt:
                    raise asyncio.CancelledError()


def test_ten_thousand_roundtrip_bounded_and_atomic(storage, tmp_path):
    source, exported = tmp_path / "source.ndjson", tmp_path / "export.ndjson"
    make_history(source)

    async def run():
        with Session(storage) as db:
            result = await history_transfer.import_history(Upload(source), "a", 0, db)
            assert result["counts"]["entry"] == 10000
            response = history_transfer.export("a", db)
            with exported.open("wb") as file:
                async for chunk in response.body_iterator:
                    file.write(chunk)
            await history_transfer.import_history(Upload(exported), "b", 0, db)
            before = db.scalar(
                select(Workspace.version).where(Workspace.user_id == "a")
            )
            with pytest.raises(asyncio.CancelledError):
                await history_transfer.import_history(
                    Upload(source, interrupt=True), "a", before, db
                )
            with pytest.raises(ApiError) as stale:
                await history_transfer.import_history(Upload(source), "a", 0, db)
            assert stale.value.status == 409
            assert (
                db.scalar(select(Workspace.version).where(Workspace.user_id == "a"))
                == before
            )
            page = Repository(db, "a").topics(40, -1)
            assert len(page["items"]) == 40 and page["nextCursor"] == 39
            assert len(Repository(db, "a").page("b0", 40, -1)["items"]) == 40
            with pytest.raises(ApiError):
                Repository(db, "a").page("foreign", 40, -1)
            # Compare ordered raw records in bounded batches, not whole histories.
            left = db.scalars(
                select(entries.c.data)
                .where(entries.c.user_id == "a")
                .order_by(entries.c.branch_id, entries.c.position)
            ).yield_per(100)
            right = db.scalars(
                select(entries.c.data)
                .where(entries.c.user_id == "b")
                .order_by(entries.c.branch_id, entries.c.position)
            ).yield_per(100)
            assert all(a == b for a, b in zip(left, right, strict=True))

    tracemalloc.start()
    started = time.perf_counter()
    asyncio.run(run())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    print(
        f"\nSTRESS topics=100 entries=10000 bytes={source.stat().st_size} peak_python_mib={peak / 1024**2:.2f} seconds={time.perf_counter() - started:.2f}"
    )
    assert peak < 32 * 1024**2


def test_incomplete_upload_keeps_existing(storage, tmp_path):
    path = tmp_path / "bad.ndjson"
    path.write_bytes(
        history_transfer.encode(
            {"type": "manifest", "schemaVersion": 3, "active": None}
        )
    )

    async def run():
        with Session(storage) as db:
            with pytest.raises(ApiError) as invalid:
                await history_transfer.import_history(Upload(path), "a", 0, db)
            assert invalid.value.status == 400
            assert Repository(db, "a").snapshot()["revision"] == 0

    asyncio.run(run())


def test_invalid_staged_source_does_not_replace_workspace(storage, tmp_path):
    path = tmp_path / "invalid-source.ndjson"
    make_history(path, topics=1, per_topic=1)
    records = [json.loads(line) for line in path.read_bytes().splitlines()]
    records[-2]["data"]["source"] = {}
    path.write_bytes(b"".join(history_transfer.encode(record) for record in records))
    with Session(storage) as db:
        repo = Repository(db, "a"); repo.replace(seed_state(), 0)
        before = repo.snapshot()
        with pytest.raises(ApiError) as invalid:
            asyncio.run(history_transfer.import_history(Upload(path), "a", 1, db))
        assert invalid.value.status == 400
        assert repo.snapshot() == before


def test_export_keeps_one_snapshot_across_concurrent_write(storage):
    with storage.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    async def run():
        with Session(storage) as db:
            repo = Repository(db, "a"); original = seed_state(); repo.replace(original, 0)
            response = history_transfer.export("a", db)
            manifest = json.loads(await anext(response.body_iterator))
            with Session(storage) as writer:
                Repository(writer, "a").replace({"version": 2, "active": None, "sessions": [], "branches": []}, 1)
            remaining = [json.loads(raw) async for raw in response.body_iterator]
            assert manifest["active"] == original["active"]
            assert sum(r["type"] == "branch" for r in remaining) == 2
            assert remaining[-1]["entries"] == 6
    asyncio.run(run())


def test_upgrade_existing_schema_preserves_legacy_credential_fields(tmp_path):
    from alembic import command
    from alembic.config import Config
    engine = create_engine("sqlite:///" + (tmp_path / "legacy.db").as_posix())
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    original = json.dumps(seed_state(), ensure_ascii=False)
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0001_initial")
            connection.execute(text("INSERT INTO users VALUES ('legacy', '2026-01-01')"))
            connection.execute(text("INSERT INTO workspaces VALUES ('legacy', :state, 7, '2026-01-01')"), {"state": original})
            connection.execute(text("INSERT INTO user_ai_configs VALUES ('legacy', 3, 'https://example.com/v1', 'old-model', 9000, 'ciphertext', 'nonce', 'tag', '2026-01-01')"))
        upgrade(engine)
        with Session(engine) as db:
            assert tuple(db.execute(text("SELECT version,encrypted_key,nonce,auth_tag,provider,max_tokens,temperature FROM user_ai_configs")).one()) == (3, "ciphertext", "nonce", "tag", "openai", 4096, None)
            repo = Repository(db, "legacy")
            assert repo.snapshot() == {"state": json.loads(original), "revision": 7}
            assert db.get(Workspace, "legacy").state == original
    finally:
        engine.dispose()
