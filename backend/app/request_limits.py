"""Bound the compatibility JSON API before FastAPI decodes it."""
from fastapi.responses import JSONResponse


class BoundedJSON:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH") or scope.get("path") == "/api/import/ndjson":
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > 8 * 1024 * 1024:
                return await JSONResponse({"error": "JSON 请求超过 8 MiB，请使用 NDJSON 导入。"}, status_code=413)(scope, receive, send)
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body, delivered = b"".join(chunks), False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()
        await self.app(scope, replay, send)
