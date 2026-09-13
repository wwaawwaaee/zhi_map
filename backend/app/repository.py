"""Normalized history storage. Legacy workspace.state is retained as migration backup."""

import json
import time
import uuid

from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    delete,
    insert,
    select,
    update,
    func,
    cast,
    LargeBinary,
)

from .db import Base, Workspace, utcnow
from .domain import empty_state, validate_state, transition
from .services import error

heads = Table(
    "history_heads",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("active", String, nullable=True),
)
sessions = Table(
    "history_sessions",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("id", String, primary_key=True),
    Column("position", Integer, nullable=False),
    Column("data", Text, nullable=False),
)
branches = Table(
    "history_branches",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("id", String, primary_key=True),
    Column("position", Integer, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("data", Text, nullable=False),
)
entries = Table(
    "history_entries",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("branch_id", String, primary_key=True),
    Column("position", Integer, primary_key=True),
    Column("id", String, nullable=False),
    Column("data", Text, nullable=False),
)


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


tombstones = Table(
    "history_tombstones", Base.metadata,
    Column("token", String, primary_key=True),
    Column("user_id", ForeignKey("users.id"), nullable=False),
    Column("expires", Integer, nullable=False),
    Column("data", Text, nullable=False),
)


class Repository:
    def __init__(self, db, uid):
        self.db, self.uid = db, uid

    def owned(self, table):
        return table.c.user_id == self.uid

    def ensure(self):
        if self.db.execute(select(heads.c.user_id).where(self.owned(heads))).first():
            return
        row = self.db.get(Workspace, self.uid)
        if row is None:
            row = Workspace(
                user_id=self.uid,
                state=dump(empty_state()),
                version=0,
                updated_at=utcnow(),
            )
            self.db.add(row)
            self.db.flush()
        # Validate before writing; transaction rollback leaves the legacy row intact.
        if len(row.state.encode("utf-8")) > 8 * 1024 * 1024:
            error(413, "旧 JSON 自动迁移限制 8 MiB；请从文件转换为 NDJSON。")
        state = validate_state(json.loads(row.state))
        self.db.execute(insert(heads).values(user_id=self.uid, active=state["active"]))
        self.sync(state)
        self.db.commit()

    def sync_rows(self, table, values, key, condition=None):
        condition = self.owned(table) if condition is None else condition
        old = {
            row[key]: dict(row)
            for row in self.db.execute(select(table).where(condition)).mappings()
        }
        remaining = set(old)
        changed = False
        for value in values:
            identity = value[key]
            remaining.discard(identity)
            if identity not in old:
                changed = True
                self.db.execute(insert(table).values(**value))
            elif any(old[identity][k] != v for k, v in value.items()):
                changed = True
                if table is branches:
                    value["revision"] = old[identity]["revision"] + 1
                self.db.execute(
                    update(table)
                    .where(condition, table.c[key] == identity)
                    .values(**value)
                )
        for identity in remaining:
            changed = True
            self.db.execute(delete(table).where(condition, table.c[key] == identity))
        return changed

    def sync(self, state, loaded=None):
        self.sync_rows(
            sessions,
            [
                {"user_id": self.uid, "id": s["id"], "position": i, "data": dump(s)}
                for i, s in enumerate(state["sessions"])
            ],
            "id",
        )
        old_revs = dict(
            self.db.execute(
                select(branches.c.id, branches.c.revision).where(self.owned(branches))
            ).all()
        )
        self.sync_rows(
            branches,
            [
                {
                    "user_id": self.uid,
                    "id": b["id"],
                    "position": i,
                    "revision": old_revs.get(b["id"], 0),
                    "data": dump({k: v for k, v in b.items() if k != "entries"}),
                }
                for i, b in enumerate(state["branches"])
            ],
            "id",
        )
        ids = [b["id"] for b in state["branches"]]
        self.db.execute(
            delete(entries).where(self.owned(entries), entries.c.branch_id.not_in(ids))
        )
        for b in state["branches"]:
            if loaded is not None and b["id"] not in loaded and b["id"] in old_revs:
                continue
            changed = self.sync_rows(
                entries,
                [
                    {
                        "user_id": self.uid,
                        "branch_id": b["id"],
                        "position": i,
                        "id": e["id"],
                        "data": dump(e),
                    }
                    for i, e in enumerate(b["entries"])
                ],
                "position",
                self.owned(entries) & (entries.c.branch_id == b["id"]),
            )
            if changed:
                self.db.execute(
                    update(branches)
                    .where(self.owned(branches), branches.c.id == b["id"])
                    .values(revision=branches.c.revision + 1)
                )
        self.db.execute(
            update(heads).where(self.owned(heads)).values(active=state["active"])
        )

    def snapshot(self, loaded=None):
        self.ensure()
        if loaded is None:
            self.check_size()
        state = empty_state()
        state["active"] = self.db.scalar(
            select(heads.c.active).where(self.owned(heads))
        )
        state["sessions"] = [
            json.loads(s)
            for s in self.db.scalars(
                select(sessions.c.data)
                .where(self.owned(sessions))
                .order_by(sessions.c.position)
            )
        ]
        for row in self.db.execute(
            select(branches.c.id, branches.c.data)
            .where(self.owned(branches))
            .order_by(branches.c.position)
        ):
            branch = json.loads(row.data)
            branch["entries"] = (
                [
                    json.loads(e)
                    for e in self.db.scalars(
                        select(entries.c.data)
                        .where(self.owned(entries), entries.c.branch_id == row.id)
                        .order_by(entries.c.position)
                    )
                ]
                if loaded is None or row.id in loaded
                else []
            )
            state["branches"].append(branch)
        return {
            "state": state,
            "revision": self.db.scalar(
                select(Workspace.version).where(Workspace.user_id == self.uid)
            ),
        }

    def replace(self, state, revision, loaded=None):
        changed = self.db.execute(
            update(Workspace)
            .where(Workspace.user_id == self.uid, Workspace.version == revision)
            .values(version=revision + 1, updated_at=utcnow())
        ).rowcount
        if changed != 1:
            error(409, "工作区已被其他请求更新，请刷新后重试。")
        self.sync(state, loaded)
        self.db.commit()
        return revision + 1

    def view(self):
        self.ensure()
        return {"revision": self.db.scalar(select(Workspace.version).where(Workspace.user_id == self.uid)),
                "active": self.db.scalar(select(heads.c.active).where(self.owned(heads)))}

    def meta(self, branch_id):
        self.ensure()
        row = self.db.execute(select(branches).where(self.owned(branches), branches.c.id == branch_id)).mappings().first()
        if not row:
            error(404, "主题不存在。")
        return {**json.loads(row["data"]), "revision": row["revision"]}

    def check_size(self, branch_ids=None, maximum=8 * 1024 * 1024):
        query = select(func.coalesce(func.sum(func.length(cast(entries.c.data, LargeBinary))), 0)).where(self.owned(entries))
        if branch_ids is not None:
            query = query.where(entries.c.branch_id.in_(branch_ids))
        size = self.db.scalar(query)
        for table in (branches, sessions):
            extra = select(func.coalesce(func.sum(func.length(cast(table.c.data, LargeBinary))), 0)).where(self.owned(table))
            if branch_ids is not None:
                if table is sessions:
                    continue
                extra = extra.where(branches.c.id.in_(branch_ids))
            size += self.db.scalar(extra)
        if size > maximum:
            error(413, "此兼容操作超过 8 MiB 历史预算；请使用分页或 NDJSON。")

    def context(self, branch_id):
        meta = self.meta(branch_id)
        selection = (meta.get("selection") or {}).get("text", "")
        selected, used = [], len(selection)
        truncated = False
        for raw in self.db.scalars(select(entries.c.data).where(self.owned(entries), entries.c.branch_id == branch_id).order_by(entries.c.position.desc()).limit(100)):
            entry = json.loads(raw)
            used += len(entry["text"])
            if used > 64000:
                if not selected:
                    error(413, "选区与最新问题超过 AI 上下文 64,000 字符预算；请缩短后重试。")
                truncated = True
                break
            selected.append(entry)
        if len(selected) == 100:
            truncated = self.db.scalar(select(func.count()).select_from(entries).where(self.owned(entries), entries.c.branch_id == branch_id)) > 100
        return {**meta, "entries": list(reversed(selected)), "contextTruncated": truncated}

    def incremental(self, payload, compact):
        bid = payload.get("branchId") or self.view()["active"]
        branch = self.meta(bid)
        branch.pop("revision", None)
        last = self.db.execute(select(entries).where(self.owned(entries), entries.c.branch_id == bid).order_by(entries.c.position.desc()).limit(1)).mappings().first()
        branch["entries"] = [json.loads(last["data"])] if last else []
        session = self.db.scalar(select(sessions.c.data).where(self.owned(sessions), sessions.c.id == branch["sessionId"]))
        before_ids = {e["id"] for e in branch["entries"]}
        state = transition({"version": 2, "active": bid, "sessions": [json.loads(session)], "branches": [branch]}, payload)
        updated = state["branches"][0]
        if self.db.execute(update(Workspace).where(Workspace.user_id == self.uid, Workspace.version == payload["revision"]).values(version=payload["revision"] + 1, updated_at=utcnow())).rowcount != 1:
            error(409, "工作区已更新，请刷新后重试。")
        position = last["position"] + 1 if last else 0
        ids = []
        for e in updated.pop("entries"):
            if e["id"] not in before_ids:
                self.db.execute(insert(entries).values(user_id=self.uid, branch_id=bid, position=position, id=e["id"], data=dump(e)))
                ids.append(e["id"])
                position += 1
        if payload["type"] == "retryToDraft" and last:
            self.db.execute(delete(entries).where(self.owned(entries), entries.c.branch_id == bid, entries.c.position == last["position"]))
        self.db.execute(update(branches).where(self.owned(branches), branches.c.id == bid).values(data=dump(updated), revision=branches.c.revision + 1))
        self.db.commit()
        return {**self.view(), "affectedIds": [bid], "entryIds": ids} if compact else self.snapshot()

    def fork(self, payload, compact):
        from .domain.utf16 import utf16_slice
        bid = payload.get("branchId") or self.view()["active"]
        branch = self.meta(bid)
        anchor_id = payload.get("entryId") if payload["type"] == "fork" else (payload.get("selection") or {}).get("entryId")
        anchor = self.db.execute(select(entries).where(self.owned(entries), entries.c.branch_id == bid, entries.c.id == anchor_id)).mappings().first()
        if not anchor:
            error(400, "截点已失效。")
        condition = self.owned(entries) & (entries.c.branch_id == bid) & (entries.c.position <= anchor["position"])
        scope = payload.get("contextScope")
        if payload["type"] == "expand":
            if scope is not None:
                if not isinstance(scope, dict) or scope.get("mode") not in {"all", "none"}:
                    error(400, "上下文范围无效。")
                excluded = scope.get("excludedIds", [])
                if not isinstance(excluded, list) or len(excluded) > 200 or any(not isinstance(x, str) for x in excluded):
                    error(400, "最多排除 200 条背景。")
                found = set(self.db.scalars(select(entries.c.id).where(condition, entries.c.id.in_(excluded))))
                if found != set(excluded):
                    error(400, "上下文选择已失效。")
                condition &= entries.c.id.not_in(excluded) if scope["mode"] == "all" else False
            else:
                ids = payload.get("contextIds", [])
                if not isinstance(ids, list) or len(ids) > 200 or any(not isinstance(x, str) for x in ids):
                    error(400, "显式选择最多 200 条背景；全部选择请使用 scope。")
                if set(self.db.scalars(select(entries.c.id).where(condition, entries.c.id.in_(ids)))) != set(ids):
                    error(400, "上下文选择已失效。")
                condition &= entries.c.id.in_(ids)
        # Validate selection using the existing UTF-16 domain rules on only its anchor.
        branch["entries"] = [json.loads(anchor["data"])]
        session = json.loads(self.db.scalar(select(sessions.c.data).where(self.owned(sessions), sessions.c.id == branch["sessionId"])))
        small_payload = {k: v for k, v in payload.items() if k != "contextScope"}
        small_payload["contextIds"] = []
        state = transition({"version": 2, "active": bid, "sessions": [session], "branches": [branch]}, small_payload)
        child = state["branches"][-1]
        pending = [e for e in child.pop("entries") if not e["inherited"]]
        if self.db.execute(update(Workspace).where(Workspace.user_id == self.uid, Workspace.version == payload["revision"]).values(version=payload["revision"] + 1, updated_at=utcnow())).rowcount != 1:
            error(409, "工作区已更新，请刷新后重试。")
        position = (self.db.scalar(select(func.max(branches.c.position)).where(self.owned(branches))) or 0) + 1
        self.db.execute(insert(branches).values(user_id=self.uid, id=child["id"], position=position, revision=0, data=dump(child)))
        offset = 0
        # Server cursor iteration; copying a large prefix never constructs an id or entry list.
        for row in self.db.execute(select(entries.c.data, entries.c.id).where(condition).order_by(entries.c.position).execution_options(yield_per=40)):
            e = json.loads(row.data)
            if row.id == anchor_id and payload["type"] == "expand":
                end = payload["selection"]["end"]
                base = e.get("range", {}).get("start", 0)
                e["text"] = utf16_slice(e["text"], 0, end)
                e["range"] = {"start": base, "end": base + end}
            e.update(id=str(uuid.uuid4()), inherited=True)
            self.db.execute(insert(entries).values(user_id=self.uid, branch_id=child["id"], position=offset, id=e["id"], data=dump(e)))
            offset += 1
        for e in pending:
            self.db.execute(insert(entries).values(user_id=self.uid, branch_id=child["id"], position=offset, id=e["id"], data=dump(e)))
            offset += 1
        self.db.execute(update(heads).where(self.owned(heads)).values(active=child["id"]))
        self.db.commit()
        return {**self.view(), "affectedIds": [child["id"]], "entryIds": [e["id"] for e in pending]} if compact else self.snapshot()

    def action(self, payload, compact=True):
        self.ensure()
        if payload["type"] in {"fork", "expand"}:
            return self.fork(payload, compact)
        if payload["type"] in {"send", "answer", "draft", "retryToDraft", "keep"}:
            return self.incremental(payload, compact)
        if payload["type"] in {"reference", "resolveHistory", "removeReference"}:
            return self.references(payload, compact)
        active = self.db.scalar(select(heads.c.active).where(self.owned(heads)))
        loaded = {payload.get("branchId") or active, payload.get("sourceId")}
        # Metadata actions never materialize history. Other legacy transitions have
        # an explicit per-operation budget until they are converted to SQL.
        if payload["type"] in {"create", "switch", "draft", "metadata", "keep", "delete", "sample"}:
            loaded = set()
        self.check_size(loaded)
        current = self.snapshot(loaded)
        if current["revision"] != payload["revision"]:
            error(409, "工作区已被其他请求更新，请刷新后重试。")
        token = None
        if payload["type"] == "delete" and payload.get("kind") != "session":
            target = payload.get("targetId")
            self.check_size({target})
            meta = self.meta(target)
            saved = {"revision": payload["revision"] + 1, "branch": {k: v for k, v in meta.items() if k != "revision"},
                     "entries": [json.loads(x) for x in self.db.scalars(select(entries.c.data).where(self.owned(entries), entries.c.branch_id == target).order_by(entries.c.position))]}
            token = str(uuid.uuid4())
            self.db.execute(delete(tombstones).where(tombstones.c.expires <= int(time.time())))
            self.db.execute(delete(tombstones).where(self.owned(tombstones)))
            self.db.execute(insert(tombstones).values(token=token, user_id=self.uid, expires=int(time.time()) + 600, data=dump(saved)))
        state = transition(current["state"], payload)
        self.replace(state, payload["revision"], loaded)
        if compact:
            return {**self.view(), "affectedIds": list({x for x in loaded | {payload.get('branchId'), state['active']} if x}), "undoToken": token}
        return self.snapshot()

    def references(self, payload, compact):
        bid = payload.get("branchId") or self.view()["active"]
        target = self.meta(bid)
        target.pop("revision", None)
        target["entries"] = []
        source_id = payload.get("sourceId")
        sources = []
        if payload["type"] == "removeReference":
            raw = self.db.scalar(select(entries.c.data).where(self.owned(entries), entries.c.branch_id == bid, entries.c.id == payload.get("entryId")))
            if raw:
                target["entries"] = [json.loads(raw)]
        elif source_id:
            ids = payload.get("selectedIds", [])
            if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(i, str) for i in ids):
                error(400, "每次最多引用 100 条。")
            source = self.meta(source_id)
            source["entries"] = [json.loads(x) for x in self.db.scalars(select(entries.c.data).where(self.owned(entries), entries.c.branch_id == source_id, entries.c.id.in_(ids)).order_by(entries.c.position))]
            # Duplicate validation consults all target history in SQL, never in Python/browser.
            for e in source["entries"]:
                duplicate = self.db.scalar(select(entries.c.id).where(self.owned(entries), entries.c.branch_id == bid,
                    func.json_extract(entries.c.data, '$.source.branchId') == e["source"]["branchId"],
                    func.json_extract(entries.c.data, '$.source.messageId') == e["source"]["messageId"]).limit(1))
                if duplicate:
                    error(400, "来源选择已失效或重复。")
            sources.append(source)
        session = json.loads(self.db.scalar(select(sessions.c.data).where(self.owned(sessions), sessions.c.id == target["sessionId"])))
        state = transition({"version": 2, "active": bid, "sessions": [session], "branches": [target] + sources}, payload)
        updated = state["branches"][0]
        if self.db.execute(update(Workspace).where(Workspace.user_id == self.uid, Workspace.version == payload["revision"]).values(version=payload["revision"] + 1, updated_at=utcnow())).rowcount != 1:
            error(409, "工作区已更新，请刷新后重试。")
        items = updated.pop("entries")
        if payload["type"] == "removeReference":
            self.db.execute(delete(entries).where(self.owned(entries), entries.c.branch_id == bid, entries.c.id == payload.get("entryId")))
        else:
            maximum = self.db.scalar(select(func.max(entries.c.position)).where(self.owned(entries), entries.c.branch_id == bid))
            offset = maximum + 1 if maximum is not None else 0
            for e in items:
                self.db.execute(insert(entries).values(user_id=self.uid, branch_id=bid, position=offset, id=e["id"], data=dump(e)))
                offset += 1
        self.db.execute(update(branches).where(self.owned(branches), branches.c.id == bid).values(data=dump(updated), revision=branches.c.revision + 1))
        self.db.commit()
        return {**self.view(), "affectedIds": [bid], "entryIds": [e["id"] for e in items]} if compact else self.snapshot()

    def undo(self, token, revision):
        current = self.view()
        if current["revision"] != revision:
            error(409, "工作区已更新，请刷新后重试。")
        row = self.db.execute(select(tombstones).where(self.owned(tombstones), tombstones.c.token == token, tombstones.c.expires > int(time.time()))).mappings().first()
        if not row:
            error(404, "撤销已过期或已使用。")
        saved = json.loads(row["data"])
        if saved.get("revision") != revision:
            error(409, "撤销已失效：删除后发生了其他修改。")
        state = self.snapshot(set())["state"]
        branch = saved["branch"]
        if any(b["id"] == branch["id"] for b in state["branches"]):
            error(409, "主题已存在。")
        if not any(s["id"] == branch["sessionId"] for s in state["sessions"]):
            error(409, "原会话已删除，无法撤销。")
        branch["entries"] = saved["entries"]
        state["branches"].append(branch)
        state["active"] = branch["id"]
        self.db.execute(delete(tombstones).where(self.owned(tombstones), tombstones.c.token == token))
        self.replace(state, revision, {branch["id"]})
        return {**self.view(), "affectedIds": [branch["id"]]}

    def topics(self, limit, cursor, search=""):
        self.ensure()
        rows = (
            self.db.execute(
                select(branches)
                .where(self.owned(branches), branches.c.position > cursor, branches.c.data.contains(search, autoescape=True))
                .order_by(branches.c.position)
                .limit(limit + 1)
            )
            .mappings()
            .all()
        )
        return {
            "items": [
                {k: v for k, v in {**json.loads(r["data"]), "revision": r["revision"]}.items() if k in {"id", "sessionId", "title", "tags", "parent", "kept", "revision"}}
                for r in rows[:limit]
            ],
            "nextCursor": rows[limit - 1]["position"] if len(rows) > limit else None,
        }

    def page(self, branch_id, limit, cursor, anchor=None, before=None):
        self.ensure()
        if not self.db.execute(
            select(branches.c.id).where(
                self.owned(branches), branches.c.id == branch_id
            )
        ).first():
            error(404, "主题不存在。")
        if anchor:
            position = self.db.scalar(select(entries.c.position).where(self.owned(entries), entries.c.branch_id == branch_id, entries.c.id == anchor))
            if position is None:
                error(404, "原文已不存在。")
            cursor = (position // limit) * limit - 1
        end = None
        if before:
            end = self.db.scalar(select(entries.c.position).where(self.owned(entries), entries.c.branch_id == branch_id, entries.c.id == before))
            if end is None:
                error(404, "截点不存在。")
        rows = (
            self.db.execute(
                select(entries)
                .where(
                    self.owned(entries),
                    entries.c.branch_id == branch_id,
                    entries.c.position > cursor,
                    entries.c.position <= end if end is not None else True,
                )
                .order_by(entries.c.position)
                .limit(limit + 1)
            )
            .mappings()
            .all()
        )
        return {
            "cursor": cursor,
            "items": [json.loads(r["data"]) for r in rows[:limit]],
            "nextCursor": rows[limit - 1]["position"] if len(rows) > limit else None,
        }
