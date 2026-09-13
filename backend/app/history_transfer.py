"""Disk-staged NDJSON transfers, bounded independently of history size."""

import json
import os
import sqlite3
import tempfile

from fastapi.responses import StreamingResponse
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from .db import Workspace, engine, utcnow
from .repository import Repository, heads, sessions, branches, entries
from .services import error

MAX_RECORD = 1024 * 1024
MAX_TRANSFER = 2 * 1024 * 1024 * 1024


def encode(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"
    if len(raw) > MAX_RECORD:
        error(413, "单条备份记录超过 1 MiB 限制。")
    return raw


def export(uid, database):
    Repository(database, uid).ensure()
    database.rollback()

    def records():
        with Session(engine) as reader:
            # sqlite legacy transaction mode does not BEGIN for SELECT. Keep all
            # streamed tables in one real read snapshot across concurrent writes.
            reader.execute(text("BEGIN"))
            yield encode(
                {
                    "type": "manifest",
                    "schemaVersion": 3,
                    "active": reader.scalar(
                        select(heads.c.active).where(heads.c.user_id == uid)
                    ),
                }
            )
            for table, kind in ((sessions, "session"), (branches, "branch")):
                result = (
                    reader.execute(
                        select(table)
                        .where(table.c.user_id == uid)
                        .order_by(table.c.position)
                    )
                    .mappings()
                    .yield_per(100)
                )
                for row in result:
                    yield encode({"type": kind, "data": json.loads(row["data"])})
            result = (
                reader.execute(
                    select(entries)
                    .where(entries.c.user_id == uid)
                    .order_by(entries.c.branch_id, entries.c.position)
                )
                .mappings()
                .yield_per(100)
            )
            count = 0
            for row in result:
                yield encode(
                    {
                        "type": "entry",
                        "branchId": row["branch_id"],
                        "data": json.loads(row["data"]),
                    }
                )
                count += 1
            yield encode({"type": "end", "entries": count})

    return StreamingResponse(
        records(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": 'attachment; filename="zhishu-history.ndjson"'},
    )


async def lines(request):
    buffer, total = bytearray(), 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_TRANSFER:
            error(413, "备份超过 2 GiB 限制。")
        # ASGI chunks may themselves be large; never concatenate a whole upload.
        for offset in range(0, len(chunk), 65536):
            buffer.extend(chunk[offset : offset + 65536])
            while (end := buffer.find(b"\n")) >= 0:
                if end + 1 > MAX_RECORD:
                    error(413, "单条备份记录超过 1 MiB 限制。")
                raw = bytes(buffer[:end])
                del buffer[: end + 1]
                try:
                    yield json.loads(raw)
                except (ValueError, UnicodeError):
                    error(400, "NDJSON 记录无效。")
            if len(buffer) > MAX_RECORD:
                error(413, "单条备份记录超过 1 MiB 限制。")
    if buffer:
        error(400, "备份末行未完整结束。")


async def import_history(request, uid, revision, database):
    Repository(database, uid).ensure()
    database.rollback()
    fd, path = tempfile.mkstemp(prefix="zhishu-import-", suffix=".db")
    os.close(fd)
    stage = sqlite3.connect(path)
    try:
        stage.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE sessions(id TEXT PRIMARY KEY, position INTEGER, data TEXT);
            CREATE TABLE branches(id TEXT PRIMARY KEY, position INTEGER, data TEXT, session_id TEXT REFERENCES sessions(id));
            CREATE TABLE entries(branch_id TEXT REFERENCES branches(id), position INTEGER, id TEXT, data TEXT, PRIMARY KEY(branch_id,position), UNIQUE(branch_id,id));
        """)
        counts = {"session": 0, "branch": 0, "entry": 0}
        manifest, ended = None, False
        async for record in lines(request):
            if not isinstance(record, dict) or ended:
                error(400, "备份记录顺序无效。")
            kind = record.get("type")
            if manifest is None:
                if (
                    kind != "manifest"
                    or record.get("schemaVersion") != 3
                    or not isinstance(record.get("active"), (str, type(None)))
                ):
                    error(400, "缺少版本 3 备份清单。")
                manifest = record
                continue
            if kind == "end":
                if record.get("entries") != counts["entry"]:
                    error(400, "备份记录数不匹配。")
                ended = True
                continue
            if kind not in counts:
                error(400, "未知备份记录类型。")
            data = record.get("data")
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("id"), str)
                or not data["id"]
            ):
                error(400, "备份记录标识无效。")
            raw = json.dumps(data, ensure_ascii=False)
            if kind == "session":
                if not isinstance(data.get("title"), str):
                    error(400, "会话标题无效。")
                stage.execute(
                    "INSERT INTO sessions VALUES(?,?,?)",
                    (data["id"], counts[kind], raw),
                )
            elif kind == "branch":
                if (
                    not isinstance(data.get("title"), str)
                    or not isinstance(data.get("tags"), list)
                    or not isinstance(data.get("sessionId"), str)
                    or any(not isinstance(tag, str) for tag in data.get("tags", []))
                    or not isinstance(data.get("draft"), str)
                    or not isinstance(data.get("kept"), bool)
                    or (data.get("parent") is not None and not isinstance(data.get("parent"), dict))
                    or ("selection" in data and (not isinstance(data["selection"], dict) or not isinstance(data["selection"].get("text"), str)))
                    or "entries" in data
                ):
                    error(400, "主题元数据无效。")
                stage.execute(
                    "INSERT INTO branches VALUES(?,?,?,?)",
                    (data["id"], counts[kind], raw, data.get("sessionId")),
                )
            else:
                if (
                    data.get("role") not in ("user", "assistant")
                    or data.get("kind") not in ("message", "reference")
                    or not isinstance(data.get("text"), str)
                    or not isinstance(data.get("source"), dict)
                    or any(not isinstance(data.get("source", {}).get(key), str) for key in ("sessionId", "sessionTitle", "branchId", "branchTitle", "messageId"))
                    or not isinstance(data.get("inherited"), bool)
                ):
                    error(400, "消息格式无效。")
                bid = record.get("branchId")
                if not isinstance(bid, str):
                    error(400, "消息所属主题无效。")
                position = stage.execute(
                    "SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE branch_id=?",
                    (bid,),
                ).fetchone()[0]
                stage.execute(
                    "INSERT INTO entries VALUES(?,?,?,?)",
                    (bid, position, data["id"], raw),
                )
            counts[kind] += 1
            if sum(counts.values()) % 100 == 0:
                stage.commit()
        if not ended or manifest is None:
            error(400, "备份中断：缺少结束记录。")
        active = manifest["active"]
        if (
            active is not None
            and not stage.execute(
                "SELECT 1 FROM branches WHERE id=?", (active,)
            ).fetchone()
        ):
            error(400, "活动主题不存在。")
        stage.commit()
        stage.close()
        # Copy on disk within one atomic final transaction. Parsing and validation
        # have finished before taking the main database's write lock.
        with engine.connect() as writer:
            writer.execute(text("ATTACH DATABASE :path AS incoming"), {"path": path})
            writer.commit()
            try:
                with writer.begin():
                    changed = writer.execute(
                        update(Workspace)
                        .where(Workspace.user_id == uid, Workspace.version == revision)
                        .values(version=revision + 1, updated_at=utcnow())
                    ).rowcount
                    if changed != 1:
                        error(409, "工作区已更新，导入未应用。")
                    for name in (
                        "history_entries",
                        "history_branches",
                        "history_sessions",
                    ):
                        writer.execute(
                            text(f"DELETE FROM {name} WHERE user_id=:uid"), {"uid": uid}
                        )
                    writer.execute(
                        text(
                            "INSERT INTO history_sessions SELECT :uid,id,position,data FROM incoming.sessions"
                        ),
                        {"uid": uid},
                    )
                    writer.execute(
                        text(
                            "INSERT INTO history_branches SELECT :uid,id,position,0,data FROM incoming.branches"
                        ),
                        {"uid": uid},
                    )
                    writer.execute(
                        text(
                            "INSERT INTO history_entries SELECT :uid,branch_id,position,id,data FROM incoming.entries"
                        ),
                        {"uid": uid},
                    )
                    writer.execute(
                        update(heads)
                        .where(heads.c.user_id == uid)
                        .values(active=active)
                    )
            finally:
                writer.execute(text("DETACH DATABASE incoming"))
                writer.commit()
        return {"revision": revision + 1, "counts": counts}
    except sqlite3.IntegrityError:
        error(400, "备份包含重复标识或无效的来源关系。")
    finally:
        stage.close()
        os.unlink(path)
