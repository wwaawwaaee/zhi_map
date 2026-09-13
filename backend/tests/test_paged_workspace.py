import asyncio
import json
import tracemalloc

import pytest
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.repository import Repository, entries, tombstones
from app.domain.workspace import seed_state
from app.services import ApiError
from app.services import context_messages
from app import history_transfer
from .test_history import storage, make_history, Upload


def test_compact_10000_entry_branch_never_snapshots_and_forks_by_cursor(storage, tmp_path, monkeypatch):
    source = tmp_path / "large.ndjson"
    make_history(source, topics=1, per_topic=10000)
    with Session(storage) as db:
        asyncio.run(history_transfer.import_history(Upload(source), "a", 0, db))
        repo = Repository(db, "a")
        original = repo.snapshot
        def no_full_snapshot(loaded=None):
            assert loaded is not None, "normal operation materialized workspace"
            return original(loaded)
        monkeypatch.setattr(repo, "snapshot", no_full_snapshot)
        assert len(json.dumps(repo.view())) < 100
        page = repo.page("b0", 40, -1, anchor="e0-9999")
        assert page["cursor"] == 9959 and len(page["items"]) == 40
        tracemalloc.start()
        result = repo.action({"type": "expand", "branchId": "b0", "revision": 1,
                              "selection": {"entryId": "e0-9999", "start": 8, "end": 10, "text": "😀"},
                              "contextScope": {"mode": "all", "excludedIds": ["e0-0", "e0-42"]}, "text": "why?"}, compact=True)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert peak < 8 * 1024 ** 2
        assert len(json.dumps(result)) < 1000 and "state" not in result
        child = result["active"]
        assert db.scalar(select(func.count()).select_from(entries).where(entries.c.user_id == "a", entries.c.branch_id == child)) == 9999
        last = repo.page(child, 40, 9959)["items"]
        assert last[-2]["text"] == "Unicode 😀" and last[-1]["text"] == "why?"
        assert len(repo.context(child)["entries"]) <= 100
        assert sum(len(e["text"]) for e in repo.context(child)["entries"]) <= 64000
        assert repo.context(child)["contextTruncated"] is True
        for kind in ["draft", "answer"]:
            result = repo.action({"type": kind, "branchId": child, "text": "saved", "revision": result["revision"]}, compact=True)
            assert "state" not in result and len(json.dumps(result)) < 1000
        print(f"\nPAGED single_branch_entries=10000 fork_peak_mib={peak / 1024**2:.2f} compact_bytes={len(json.dumps(result))}")


def test_compact_reference_reads_selected_source_only_and_rejects_duplicates(storage, monkeypatch):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state()
        repo.replace(state, 0)
        target, source = state["branches"]
        monkeypatch.setattr(repo, "snapshot", lambda *args: pytest.fail("reference must not load a snapshot"))
        payload = {"type": "reference", "branchId": target["id"], "sourceId": source["id"], "selectedIds": [source["entries"][0]["id"]], "revision": 1}
        result = repo.action(payload, compact=True)
        assert len(result["entryIds"]) == 1
        with pytest.raises(ApiError):
            repo.action({**payload, "revision": 2}, compact=True)
        with pytest.raises(ApiError):
            repo.action({**payload, "selectedIds": ["x"] * 101, "revision": 2}, compact=True)


def test_delete_token_owner_revision_single_use_and_retains_children(storage):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state()
        repo.replace(state, 0)
        root = state["branches"][0]
        child = repo.action({"type": "fork", "branchId": root["id"], "entryId": root["entries"][0]["id"], "revision": 1}, compact=True)["active"]
        result = repo.action({"type": "delete", "kind": "branch", "targetId": root["id"], "revision": 2}, compact=True)
        token = result["undoToken"]
        assert repo.meta(child)["parent"]["branchId"] == root["id"]
        with pytest.raises(ApiError) as foreign:
            Repository(db, "b").undo(token, 0)
        assert foreign.value.status == 404
        with pytest.raises(ApiError) as stale:
            repo.undo(token, 2)
        assert stale.value.status == 409
        restored = repo.undo(token, 3)
        assert restored["active"] == root["id"]
        assert len(repo.page(root["id"], 40, -1)["items"]) == 4
        with pytest.raises(ApiError):
            repo.undo(token, 4)
        result = repo.action({"type": "delete", "kind": "session", "targetId": root["sessionId"], "revision": 4}, compact=True)
        assert repo.meta(child)["sessionId"] != root["sessionId"]
        assert not result["undoToken"]


def test_delete_token_expiry_replacement_and_budget(storage):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state()
        repo.replace(state, 0)
        first, second = state["branches"]
        one = repo.action({"type": "delete", "targetId": first["id"], "revision": 1}, compact=True)
        two = repo.action({"type": "delete", "targetId": second["id"], "revision": 2}, compact=True)
        assert db.scalar(select(func.count()).select_from(tombstones)) == 1
        with pytest.raises(ApiError):
            repo.undo(one["undoToken"], 3)
        db.execute(update(tombstones).values(expires=0)); db.commit()
        with pytest.raises(ApiError):
            repo.undo(two["undoToken"], 3)
        repo.replace(state, 3)
        db.execute(update(entries).where(entries.c.user_id == "a", entries.c.branch_id == first["id"]).values(data="x" * (8 * 1024**2 + 1))); db.commit()
        with pytest.raises(ApiError) as oversized:
            repo.action({"type": "delete", "targetId": first["id"], "revision": 4}, compact=True)
        assert oversized.value.status == 413 and repo.view()["revision"] == 4


@pytest.mark.parametrize("scope", [{"mode": "all", "excludedIds": ["missing"]}, {"mode": "bad"}, {"mode": "all", "excludedIds": ["x"] * 201}])
def test_scope_is_validated_before_copy(storage, scope):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state(); repo.replace(state, 0)
        branch = state["branches"][0]; entry = branch["entries"][0]
        with pytest.raises(ApiError):
            repo.action({"type": "expand", "branchId": branch["id"], "revision": 1, "text": "why", "selection": {"entryId": entry["id"], "start": 0, "end": 1, "text": entry["text"][0]}, "contextScope": scope}, compact=True)
        assert repo.view()["revision"] == 1


def test_selection_is_sent_even_with_no_background_and_budget_is_visible(storage):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state(); repo.replace(state, 0)
        branch = state["branches"][0]; entry = branch["entries"][0]
        result = repo.action({"type": "expand", "branchId": branch["id"], "revision": 1, "text": "why?", "selection": {"entryId": entry["id"], "start": 0, "end": 4, "text": entry["text"][:4]}, "contextScope": {"mode": "none"}})
        context = repo.context(result["active"])
        assert len(context["entries"]) == 1
        assert entry["text"][:4] in context_messages(context)[1]["content"]
        large = repo.snapshot()["state"]
        child = large["branches"][-1]
        child["selection"]["text"] = "😀" * 63998
        repo.replace(large, result["revision"])
        with pytest.raises(ApiError) as budget:
            repo.context(child["id"])
        assert budget.value.status == 413


def test_undo_rejected_after_next_mutation(storage):
    with Session(storage) as db:
        repo = Repository(db, "a")
        state = seed_state(); repo.replace(state, 0)
        first, second = state["branches"]
        deleted = repo.action({"type": "delete", "targetId": first["id"], "revision": 1})
        repo.action({"type": "draft", "branchId": second["id"], "text": "new work", "revision": 2})
        with pytest.raises(ApiError) as expired:
            repo.undo(deleted["undoToken"], 3)
        assert expired.value.status == 409
