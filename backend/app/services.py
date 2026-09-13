import asyncio, base64, ipaddress, json, socket, time
from collections import defaultdict, deque
from urllib.parse import urlparse
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session
from .config import settings
from .db import UserAiConfig, utcnow


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def error(status, message):
    raise ApiError(status, message)


def private_host(host):
    try:
        return (
            ipaddress.ip_address(host).is_private
            or ipaddress.ip_address(host).is_loopback
            or ipaddress.ip_address(host).is_link_local
        )
    except ValueError:
        try:
            return any(
                private_host(row[4][0]) for row in socket.getaddrinfo(host, None)
            )
        except OSError:
            return True


def valid_url(value):
    parsed = urlparse(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
    ):
        error(400, "模型地址必须是不含凭据的绝对 HTTP(S) URL。")
    if settings.production() and parsed.scheme != "https":
        error(400, "生产环境仅允许 HTTPS 模型地址。")
    allowed = {
        x.strip().lower() for x in settings.ai_allowed_hosts.split(",") if x.strip()
    }
    if allowed and parsed.hostname.lower() not in allowed:
        error(400, "模型地址不在 AI_ALLOWED_HOSTS 允许列表中。")
    if private_host(parsed.hostname) and not settings.ai_allow_private_hosts:
        error(
            400,
            "模型地址不能指向本机、私有或链路本地网络；本地模型须由服务器显式启用 AI_ALLOW_PRIVATE_HOSTS。",
        )
    return value.rstrip("/")


def public_config(db, user_id):
    row = db.get(UserAiConfig, user_id)
    if row:
        return {
            "configured": True,
            "provider": row.provider,
            "maxTokens": row.max_tokens,
            "temperature": row.temperature,
            "baseUrl": row.base_url,
            "model": row.model,
            "timeoutMs": row.timeout_ms,
            "updatedAt": row.updated_at.isoformat(),
            "source": "user",
        }
    if settings.ai_api_key and settings.ai_model:
        return {
            "configured": True,
            "provider": settings.ai_provider,
            "maxTokens": 4096,
            "temperature": None,
            "baseUrl": settings.ai_base_url,
            "model": settings.ai_model,
            "timeoutMs": settings.ai_timeout_ms,
            "updatedAt": None,
            "source": "environment",
        }
    return {
        "configured": False,
        "baseUrl": None,
        "model": None,
        "timeoutMs": None,
        "updatedAt": None,
        "source": "none",
    }


def save_config(db, user_id, input):
    key = settings.key()
    if not key:
        error(503, "生产环境未配置 DATA_ENCRYPTION_KEY，无法保存模型密钥。")
    prior = db.get(UserAiConfig, user_id)
    if not input.apiKey and not prior:
        error(400, "首次保存模型配置时必须提供 API key。")
    version = (prior.version if prior else 0) + 1
    api_key = input.apiKey or decrypt(prior, user_id)
    nonce = __import__("os").urandom(12)
    encrypted = AESGCM(key).encrypt(
        nonce, api_key.encode(), f"{user_id}:{version}".encode()
    )
    row = UserAiConfig(
        user_id=user_id,
        version=version,
        base_url=valid_url(input.baseUrl),
        model=input.model.strip(),
        timeout_ms=input.timeoutMs or settings.ai_timeout_ms,
        encrypted_key=base64.b64encode(encrypted[:-16]).decode(),
        nonce=base64.b64encode(nonce).decode(),
        auth_tag=base64.b64encode(encrypted[-16:]).decode(),
        updated_at=utcnow(),
    )
    row.provider = input.provider
    row.max_tokens = input.maxTokens
    row.temperature = input.temperature
    if prior:
        db.delete(prior)
        db.flush()
    db.add(row)
    db.commit()
    return public_config(db, user_id)


def decrypt(row, user_id):
    key = settings.key()
    if not key:
        error(503, "已保存的模型密钥无法解密，请重新配置。")
    try:
        return (
            AESGCM(key)
            .decrypt(
                base64.b64decode(row.nonce),
                base64.b64decode(row.encrypted_key)
                + base64.b64decode(row.auth_tag or ""),
                f"{user_id}:{row.version}".encode(),
            )
            .decode()
        )
    except Exception:
        error(503, "已保存的模型密钥无法解密，请重新配置。")


def resolved(db, user_id):
    row = db.get(UserAiConfig, user_id)
    if row:
        return valid_url(row.base_url), row.model, decrypt(row, user_id), row.timeout_ms
    if settings.ai_api_key and settings.ai_model:
        return (
            valid_url(settings.ai_base_url),
            settings.ai_model,
            settings.ai_api_key,
            settings.ai_timeout_ms,
        )
    error(503, "模型尚未配置。问题已保留，可在服务器配置模型后重试。")


_limits = defaultdict(deque)


def rate_limit(user_id, name, maximum):
    q = _limits[(user_id, name)]
    now = time.monotonic()
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= maximum:
        error(429, "请求过于频繁，请稍后重试。")
    q.append(now)


def chat_request(db, user_id, messages):
    from .providers import ChatRequest

    base, model, key, timeout = resolved(db, user_id)
    row = db.get(UserAiConfig, user_id)
    return ChatRequest(
        base,
        model,
        key,
        messages,
        provider=row.provider if row else settings.ai_provider,
        max_tokens=row.max_tokens if row else 4096,
        temperature=row.temperature if row else None,
        timeout=timeout / 1000,
    )


def context_messages(branch):
    messages = [{"role": "system", "content": "你是一位严谨的中文学习助手。使用 Markdown 与 LaTex。"}]
    selection = (branch.get("selection") or {}).get("text")
    if selection:
        messages.append({"role": "user", "content": "本主题必须参考的选区原文：\n" + selection})
    if branch.get("contextTruncated"):
        messages.append({"role": "system", "content": "背景历史因最近100条/64,000字符预算已裁剪；不要假设你看到了完整历史。"})
    return messages + [{"role": e["role"], "content": e["text"]} for e in branch["entries"]]


async def complete(db, user_id, messages):
    from .providers import complete as gateway_complete, GatewayError

    request = chat_request(db, user_id, messages)
    db.rollback()  # Never hold a database transaction across model I/O.
    try:
        return await gateway_complete(request)
    except GatewayError as exc:
        error(502, str(exc))
