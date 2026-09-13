import asyncio
import codecs
import json
import uuid
from dataclasses import dataclass
from typing import AsyncIterator
from urllib.parse import quote

import httpx


class GatewayError(Exception):
    """Only safe, locally authored messages may cross the API boundary."""


@dataclass(frozen=True)
class ChatRequest:
    base_url: str
    model: str
    key: str
    messages: list[dict]
    provider: str = "openai"
    max_tokens: int = 4096
    temperature: float | None = None
    timeout: float = 60


def openai(request):
    body = {
        "model": request.model,
        "messages": request.messages,
        "stream": True,
        "max_tokens": request.max_tokens,
        "stream_options": {"include_usage": True},
    }
    if request.temperature is not None:
        body["temperature"] = request.temperature
    return "/chat/completions", {"Authorization": "Bearer " + request.key}, body


def anthropic(request):
    body = {
        "model": request.model,
        "stream": True,
        "max_tokens": request.max_tokens,
        "messages": [m for m in request.messages if m["role"] != "system"],
    }
    system = "\n\n".join(
        m["content"] for m in request.messages if m["role"] == "system"
    )
    if system:
        body["system"] = system
    if request.temperature is not None:
        body["temperature"] = request.temperature
    return (
        "/messages",
        {"x-api-key": request.key, "anthropic-version": "2023-06-01"},
        body,
    )


def gemini(request):
    body = {
        "contents": [
            {
                "role": "model" if m["role"] == "assistant" else "user",
                "parts": [{"text": m["content"]}],
            }
            for m in request.messages
            if m["role"] != "system"
        ],
        "generationConfig": {"maxOutputTokens": request.max_tokens},
    }
    system = [{"text": m["content"]} for m in request.messages if m["role"] == "system"]
    if system:
        body["systemInstruction"] = {"parts": system}
    if request.temperature is not None:
        body["generationConfig"]["temperature"] = request.temperature
    return (
        f"/models/{quote(request.model, safe='')}:streamGenerateContent?alt=sse",
        {"x-goog-api-key": request.key},
        body,
    )


ADAPTERS = {"openai": openai, "anthropic": anthropic, "gemini": gemini}
MAX_LINE = 256 * 1024
MAX_EVENT = 512 * 1024
MAX_RESPONSE = 8 * 1024 * 1024
MAX_TEXT = 100000


async def sse(response: httpx.Response) -> AsyncIterator[str]:
    """Decode fragmented UTF-8 and CR/LF without unbounded aiter_lines buffers."""
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    line, data, event_size, total = "", [], 0, 0
    pending_cr = False
    line_size = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_RESPONSE:
            raise GatewayError("模型响应超过大小限制。")
        for char in decoder.decode(chunk):
            if pending_cr and char == "\n":
                pending_cr = False
                continue
            pending_cr = char == "\r"
            if char not in "\r\n":
                line += char
                line_size += len(char.encode("utf-8"))
                if line_size > MAX_LINE:
                    raise GatewayError("模型事件行超过大小限制。")
                continue
            if not line:
                if data:
                    yield "\n".join(data)
                data, event_size = [], 0
            elif line.startswith("data:"):
                value = line[5:].removeprefix(" ")
                event_size += len(value.encode("utf-8"))
                if event_size > MAX_EVENT:
                    raise GatewayError("模型事件超过大小限制。")
                data.append(value)
            line = ""
            line_size = 0
    decoder.decode(b"", final=True)
    # SSE requires a blank line to dispatch; an unfinished event is a disconnect.
    if line or data:
        raise GatewayError("模型流意外中断。")


def normalize(provider, value):
    if value.get("error") or value.get("type") == "error":
        raise GatewayError("模型服务返回错误。")
    if provider == "openai":
        choice = (value.get("choices") or [{}])[0]
        if choice.get("finish_reason") not in (None, "stop"):
            raise GatewayError("模型回答未完整结束或被过滤，请调整请求后重试。")
        return (
            choice.get("delta", {}).get("content") or "",
            value.get("usage"),
            bool(choice.get("finish_reason")),
        )
    if provider == "anthropic":
        kind = value.get("type")
        if kind == "message_delta" and value.get("delta", {}).get("stop_reason") not in (None, "end_turn", "stop_sequence"):
            raise GatewayError("模型回答未完整结束或被过滤，请调整请求后重试。")
        text = (
            value.get("delta", {}).get("text", "")
            if kind == "content_block_delta"
            else ""
        )
        usage = (
            value.get("message", {}).get("usage")
            if kind == "message_start"
            else value.get("usage")
        )
        return text, usage, kind == "message_stop"
    candidate = (value.get("candidates") or [{}])[0]
    if value.get("promptFeedback", {}).get("blockReason"):
        raise GatewayError("模型拒绝了此请求。")
    if candidate.get("finishReason") not in (None, "STOP"):
        raise GatewayError("模型回答未完整结束或被过滤，请调整请求后重试。")
    text = "".join(
        p.get("text", "")
        for p in candidate.get("content", {}).get("parts", [])
        if not p.get("thought")
    )
    return text, value.get("usageMetadata"), bool(candidate.get("finishReason"))


async def _events(request: ChatRequest, *, run_id=None, transport=None):
    run_id = run_id or str(uuid.uuid4())
    seq = 0

    def event(kind, **payload):
        nonlocal seq
        seq += 1
        return {"type": kind, "runId": run_id, "seq": seq, **payload}

    yield event("started")
    try:
        adapter = ADAPTERS.get(request.provider)
        if adapter is None:
            raise GatewayError("不支持的模型协议。")
        path, headers, body = adapter(request)
        finished, size = False, 0
        async with httpx.AsyncClient(
            timeout=request.timeout, follow_redirects=False, transport=transport
        ) as client:
            async with client.stream(
                "POST", request.base_url.rstrip("/") + path, headers=headers, json=body
            ) as response:
                if response.status_code != 200:
                    raise GatewayError(
                        "模型请求限流。"
                        if response.status_code == 429
                        else "模型服务暂不可用。"
                    )
                if "text/event-stream" not in response.headers.get("content-type", ""):
                    raise GatewayError("模型未返回 SSE 流。")
                async for raw in sse(response):
                    if raw == "[DONE]" and request.provider == "openai":
                        finished = True
                        break
                    text, usage, done = normalize(request.provider, json.loads(raw))
                    if not isinstance(text, str):
                        raise GatewayError("模型文本格式无效。")
                    size += len(text.encode("utf-8"))
                    if size > MAX_TEXT:
                        raise GatewayError("模型回答超过大小限制。")
                    if text:
                        yield event("delta", text=text)
                    if usage:
                        yield event("usage", usage=usage)
                    finished = finished or done
        if not finished:
            raise GatewayError("模型流意外中断。")
        yield event("completed")
    except asyncio.CancelledError:
        # Cancellation propagates after both HTTP context managers have closed.
        raise
    except httpx.TimeoutException:
        yield event("failed", error="模型响应超时，问题已保留，可重试。")
    except GatewayError as exc:
        yield event("failed", error=str(exc))
    except Exception:
        yield event("failed", error="模型连接失败或响应格式无效。")


async def events(request: ChatRequest, *, run_id=None, transport=None):
    run_id = run_id or str(uuid.uuid4())
    seq = 0
    stream = _events(request, run_id=run_id, transport=transport)
    try:
        async with asyncio.timeout(request.timeout):
            async for item in stream:
                seq = item["seq"]
                yield item
    except TimeoutError:
        yield {"type": "failed", "runId": run_id, "seq": seq + 1, "error": "模型响应超时，问题已保留，可重试。"}
    finally:
        await stream.aclose()


async def complete(request: ChatRequest, *, transport=None):
    parts = []
    async for item in events(request, transport=transport):
        if item["type"] == "delta":
            parts.append(item["text"])
        elif item["type"] == "failed":
            raise GatewayError(item["error"])
    text = "".join(parts)
    if not text.strip():
        raise GatewayError("模型返回空回答。")
    return text
