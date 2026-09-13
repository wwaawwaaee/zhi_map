import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from app import chat_stream
from app.domain import transition
from app.domain.workspace import seed_state
from app.repository import Repository
from .test_history import storage


@pytest.mark.parametrize("edit,expected", [("draft", "completed"), ("retryToDraft", "failed"), ("cancel", "cancelled")])
def test_late_generation_is_bound_to_run_and_context(storage, monkeypatch, edit, expected):
    monkeypatch.setattr(chat_stream, "engine", storage)
    monkeypatch.setattr(chat_stream, "chat_request", lambda *args: object())
    async def simulated(request, run_id):
        yield {"type": "started", "runId": run_id, "seq": 1}
        yield {"type": "delta", "runId": run_id, "seq": 2, "text": "answer"}
        yield {"type": "completed", "runId": run_id, "seq": 3}
    monkeypatch.setattr(chat_stream, "events", simulated)
    async def run():
        with Session(storage) as db:
            state = seed_state()
            bid = state["active"]
            state = transition(state, {"type": "send", "branchId": bid, "text": "pending"})
            repo = Repository(db, "a")
            repo.replace(state, 0)
            response = chat_stream.start(SimpleNamespace(branchId=bid, revision=1, response="compact"), "a", db,
                lambda d, u: Repository(d, u).snapshot(),
                lambda d, u, s, r: Repository(d, u).replace(s, r), transition)
            first = json.loads((await anext(response.body_iterator))[6:])
            if edit == "cancel":
                # Another owner cannot cancel this run.
                chat_stream.cancel("b", bid, first["runId"])
                assert ("a", bid) in chat_stream._runs
                chat_stream.cancel("a", bid, first["runId"])
            else:
                repo.action({"type": edit, "branchId": bid, "revision": 1, "text": "typing while generating"})
            result = [json.loads(raw[6:]) async for raw in response.body_iterator]
            assert result[-1]["type"] == expected
            assert "snapshot" not in result[-1]
            if expected == "completed":
                assert "state" not in result[-1]["result"]
            current = repo.snapshot()["state"]
            branch = next(b for b in current["branches"] if b["id"] == bid)
            assert sum(e["text"] == "answer" for e in branch["entries"]) == (1 if expected == "completed" else 0)
            if edit == "draft":
                assert branch["draft"] == "typing while generating"
            assert ("a", bid) not in chat_stream._runs
    asyncio.run(run())


def test_cancel_interrupts_idle_provider_and_closes_resources(storage, monkeypatch):
    monkeypatch.setattr(chat_stream, "engine", storage)
    monkeypatch.setattr(chat_stream, "chat_request", lambda *args: object())
    closed = []
    async def run():
        started = asyncio.Event()
        async def waiting(request, run_id):
            try:
                yield {"type": "started", "runId": run_id, "seq": 1}
                started.set()
                await asyncio.sleep(60)
            finally:
                closed.append(True)
        monkeypatch.setattr(chat_stream, "events", waiting)
        with Session(storage) as db:
            state = seed_state(); bid = state["active"]
            state = transition(state, {"type": "send", "branchId": bid, "text": "pending"})
            repo = Repository(db, "a"); repo.replace(state, 0)
            response = chat_stream.start(SimpleNamespace(branchId=bid, revision=1, response="compact"), "a", db, None, None, None)
            async def consume():
                async for _ in response.body_iterator:
                    pass
            task = asyncio.create_task(consume())
            await started.wait()
            chat_stream.cancel("a", bid, chat_stream._runs[("a", bid)])
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 1)
            assert closed == [True]
            assert ("a", bid) not in chat_stream._runs and not chat_stream._tasks
            assert repo.meta(bid)["awaiting"]
    asyncio.run(run())
