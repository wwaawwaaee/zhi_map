import asyncio
import json

import httpx
import pytest

from app.providers import ChatRequest, events


class Chunks(httpx.AsyncByteStream):
    def __init__(self, content):
        self.content = content
        self.closed = False

    async def __aiter__(self):
        for byte in self.content:
            yield bytes([byte])

    async def aclose(self):
        self.closed = True


def wire(*values):
    return "".join(
        "data: "
        + (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
        + "\r\n\r\n"
        for v in values
    ).encode()


@pytest.mark.parametrize(
    "provider,frames,path,header",
    [
        (
            "openai",
            [
                {"choices": [{"delta": {"content": "你好😀"}}]},
                {"usage": {"total_tokens": 4}, "choices": []},
                "[DONE]",
            ],
            "/v1/chat/completions",
            "authorization",
        ),
        (
            "anthropic",
            [
                {
                    "type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "你好😀"},
                },
                {"type": "message_stop"},
            ],
            "/v1/messages",
            "x-api-key",
        ),
        (
            "gemini",
            [
                {
                    "candidates": [
                        {
                            "content": {"parts": [{"text": "你好😀"}]},
                            "finishReason": "STOP",
                        }
                    ],
                    "usageMetadata": {"totalTokenCount": 4},
                }
            ],
            "/v1/models/test:streamGenerateContent",
            "x-goog-api-key",
        ),
    ],
)
def test_real_protocol_shapes_fragmented_utf8(provider, frames, path, header):
    stream = Chunks(wire(*frames))

    def handler(request):
        assert request.url.path == path
        assert "secret" in request.headers[header]
        payload = json.loads(request.content)
        if provider == "anthropic":
            assert payload["system"] == "system"
            assert payload["messages"] == [{"role": "user", "content": "question"}]
            assert payload["max_tokens"] == 23
        elif provider == "gemini":
            assert payload["systemInstruction"]["parts"][0]["text"] == "system"
            assert payload["generationConfig"]["maxOutputTokens"] == 23
            assert request.url.params["alt"] == "sse"
        else:
            assert payload["stream"] is True and payload["max_tokens"] == 23
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, stream=stream
        )

    async def run():
        req = ChatRequest(
            "https://example.com/v1",
            "test",
            "secret",
            [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "question"},
            ],
            provider,
            23,
        )
        return [e async for e in events(req, transport=httpx.MockTransport(handler))]

    result = asyncio.run(run())
    assert result[0]["type"] == "started" and result[-1]["type"] == "completed"
    assert "".join(e.get("text", "") for e in result) == "你好😀"
    assert [e["seq"] for e in result] == list(range(1, len(result) + 1))
    assert len({e["runId"] for e in result}) == 1
    assert stream.closed


@pytest.mark.parametrize(
    "content,status",
    [
        (wire({"error": {"message": "secret"}}), 200),
        (wire({"choices": [{"delta": {"content": "partial"}}]}), 200),
        (b"secret", 401),
        (b"data: " + b"x" * 300000, 200),
        (b"data: \xff\n\n", 200),
    ],
    ids=["upstream-error", "disconnect", "auth", "line-budget", "invalid-utf8"],
)
def test_failure_is_bounded_safe_and_closes(content, status):
    stream = Chunks(content)

    async def run():
        transport = httpx.MockTransport(
            lambda _: httpx.Response(
                status, headers={"content-type": "text/event-stream"}, stream=stream
            )
        )
        return [
            e
            async for e in events(
                ChatRequest("https://example.com", "x", "secret", []),
                transport=transport,
            )
        ]

    result = asyncio.run(run())
    assert result[-1]["type"] == "failed"
    assert "secret" not in result[-1]["error"]
    assert stream.closed


def test_cancellation_closes_transport():
    closed = []

    class Waiting(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.sleep(20)
            yield b""

        async def aclose(self):
            closed.append(True)

    async def run():
        transport = httpx.MockTransport(
            lambda _: httpx.Response(
                200, headers={"content-type": "text/event-stream"}, stream=Waiting()
            )
        )

        async def consume():
            async for _ in events(
                ChatRequest("https://example.com", "x", "secret", []),
                transport=transport,
            ):
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.02)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert closed == [True]


@pytest.mark.parametrize("provider,frame", [
    ("openai", {"choices": [{"delta": {"content": "partial"}, "finish_reason": "content_filter"}]}),
    ("openai", {"choices": [{"delta": {}, "finish_reason": "length"}]}),
    ("anthropic", {"type": "message_delta", "delta": {"stop_reason": "max_tokens"}}),
    ("gemini", {"candidates": [{"finishReason": "SAFETY"}]}),
])
def test_non_success_finish_never_completes(provider, frame):
    stream = Chunks(wire(frame))
    async def run():
        transport = httpx.MockTransport(lambda _: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream))
        return [e async for e in events(ChatRequest("https://example.com", "x", "secret", [], provider=provider), transport=transport)]
    result = asyncio.run(run())
    assert result[-1]["type"] == "failed"
    assert not any(e["type"] == "completed" for e in result)
    assert stream.closed


def test_total_deadline_stops_trickling_stream():
    class Trickle(Chunks):
        async def __aiter__(self):
            while True:
                await asyncio.sleep(.005)
                yield b": ping\n\n"
    stream = Trickle(b"")
    async def run():
        transport = httpx.MockTransport(lambda _: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream))
        return [e async for e in events(ChatRequest("https://example.com", "x", "secret", [], timeout=.03), transport=transport)]
    result = asyncio.run(run())
    assert result[-1]["type"] == "failed" and "超时" in result[-1]["error"]
    assert stream.closed
