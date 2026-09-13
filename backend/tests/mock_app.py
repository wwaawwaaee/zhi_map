"""Local-only provider fixture used by browser integration tests."""
import asyncio
import json

from fastapi import Request
from fastapi.responses import StreamingResponse
from app.main import app


async def provider(request: Request):
    body = await request.json()
    path = request.url.path
    if "messages" in path:
        assert request.headers["x-api-key"] == "test-secret"
        assert "system" in body and "max_tokens" in body
        family = "anthropic"
    elif "models/" in path:
        assert request.headers["x-goog-api-key"] == "test-secret"
        assert "systemInstruction" in body and "generationConfig" in body
        family = "gemini"
    else:
        assert request.headers["authorization"] == "Bearer test-secret"
        family = "openai"
    async def stream():
        for i in range(30):
            if family == "anthropic":
                data = {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "增量😀 "}}
            elif family == "gemini":
                data = {"candidates": [{"content": {"parts": [{"text": "增量😀 "}]}}]}
            else:
                data = {"choices": [{"delta": {"content": "增量😀 "}}]}
            yield "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
            await asyncio.sleep(.05)
        finish = {"type": "message_stop"} if family == "anthropic" else {"candidates": [{"finishReason": "STOP"}]} if family == "gemini" else "[DONE]"
        yield "data: " + (finish if isinstance(finish, str) else json.dumps(finish)) + "\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")

# Insert before the static SPA catch-all.
from fastapi.routing import APIRoute
app.router.routes.insert(0, APIRoute("/mock/{path:path}", provider, methods=["POST"]))
