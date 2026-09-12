# 知树 Python Backend

Python 3.13 FastAPI application. The domain transitions, validation, persistence, AI gateway, encryption, and session authentication run here; TypeScript is presentation-only.

```cmd
py -m venv .venv
.venv\Scripts\python -m pip install -e .[test]
copy .env.example .env
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
.venv\Scripts\python -m pytest
```

`DATA_ENCRYPTION_KEY` is required in production. Development generates an ephemeral AES-GCM key when it is unset, so saved provider keys cannot survive a restart.
