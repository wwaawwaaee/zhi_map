"""Request-owned runs: no model I/O inside database transactions."""

import asyncio
import hashlib
import json
import uuid

from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .db import engine
from .providers import events
from .services import chat_request, context_messages, error

# This application supports one backend process, including desktop.
_runs: dict[tuple[str, str], str] = {}
_tasks = {}


def signature(branch):
    # UI-only edits do not invalidate generation, while context edits do.
    content = {
        k: branch.get(k) for k in ("entries", "awaiting", "selection", "pendingPrompt")
    }
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def start(input, uid, database, snapshot, replace, transition):
    from .repository import Repository
    repo = Repository(database, uid)
    current = repo.view()
    if input.revision != current["revision"]:
        error(409, "工作区已更新，请刷新后重试。")
    branch = repo.context(input.branchId)
    if (
        not branch
        or not branch.get("awaiting")
        or not branch["entries"]
        or branch["entries"][-1]["role"] != "user"
    ):
        error(409, "没有等待回答的问题。")
    key = (uid, input.branchId)
    if key in _runs:
        error(409, "此主题已在生成回答。")
    request = chat_request(
        database,
        uid,
        context_messages(branch),
    )
    expected = signature(branch)
    database.rollback()
    run_id = str(uuid.uuid4())
    _runs[key] = run_id

    async def body():
        parts, last_seq = [], 0
        _tasks[run_id] = asyncio.current_task()
        stream = events(request, run_id=run_id)
        try:
            async for item in stream:
                last_seq = item["seq"]
                if item["type"] == "started":
                    item["contextTruncated"] = branch["contextTruncated"]
                if _runs.get(key) != run_id:
                    yield encode(
                        {"type": "cancelled", "runId": run_id, "seq": last_seq}
                    )
                    return
                if item["type"] == "delta":
                    parts.append(item["text"])
                if item["type"] == "completed":
                    answer = "".join(parts)
                    if not answer.strip():
                        error(502, "模型返回空回答。")
                    with Session(engine) as writer:
                        repository = Repository(writer, uid)
                        latest = repository.view()
                        target = repository.context(input.branchId)
                        if target is None or signature(target) != expected:
                            error(409, "主题上下文已更新，此次回答未保存。")
                        result = repository.action(
                            {
                                "type": "answer",
                                "branchId": input.branchId,
                                "text": answer,
                                "revision": latest["revision"],
                            },
                            compact=getattr(input, "response", "compact") == "compact",
                        )
                        item["result" if getattr(input, "response", "compact") == "compact" else "snapshot"] = result
                yield encode(item)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            yield encode(
                {
                    "type": "failed",
                    "runId": run_id,
                    "seq": last_seq + 1,
                    "error": getattr(exc, "message", "回答保存失败，请刷新后重试。"),
                }
            )
        finally:
            await stream.aclose()
            _tasks.pop(run_id, None)
            if _runs.get(key) == run_id:
                _runs.pop(key, None)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def cancel(uid, branch_id, run_id):
    key = (uid, branch_id)
    if _runs.get(key) == run_id:
        _runs.pop(key, None)
        task = _tasks.get(run_id)
        if task and task is not asyncio.current_task():
            task.cancel()
    return {"ok": True}


def encode(item):
    return "data: " + json.dumps(item, ensure_ascii=False) + "\n\n"
