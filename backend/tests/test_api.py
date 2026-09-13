import os
import tempfile
_test_dir = tempfile.TemporaryDirectory(prefix="zhishu-api-")
os.environ["DATABASE_URL"] = "sqlite:///" + _test_dir.name.replace("\\", "/") + "/test.db"
from fastapi.testclient import TestClient
from app.main import app
import atexit
from app.db import engine
atexit.register(engine.dispose)

def test_workspace_is_isolated_and_stale_write_is_409():
    with TestClient(app) as first, TestClient(app) as second:
        assert first.get("/api/workspace").status_code == 200
        assert second.get("/api/workspace").status_code == 200
        created=first.post("/api/workspace/actions",json={"type":"create","title":"private","revision":0})
        assert created.status_code == 200
        assert second.get("/api/workspace").json()["state"]["sessions"] == []
        stale=first.post("/api/workspace/actions",json={"type":"create","title":"stale","revision":0})
        assert stale.status_code == 409 and "requestId" in stale.json()

def test_invalid_action_is_400_and_unconfigured_chat_is_503():
    with TestClient(app) as client:
        assert client.post("/api/workspace/actions",json={"type":"create","revision":0}).status_code == 400
        workspace=client.get("/api/workspace").json()
        created=client.post("/api/workspace/actions",json={"type":"create","title":"private","revision":workspace["revision"]}).json()
        branch=created["active"]
        pending=client.post("/api/workspace/actions",json={"type":"send","branchId":branch,"text":"hello","revision":created["revision"]})
        assert client.post("/api/ai/chat",json={"branchId":branch,"revision":pending.json()["revision"]}).status_code == 503


def test_paged_routes_compact_defaults_owner_and_cursor_validation():
    with TestClient(app) as client, TestClient(app) as other:
        view = client.get('/api/workspace/view').json()
        result = client.post('/api/workspace/actions', json={"type": "create", "title": "paged", "revision": view['revision']}).json()
        assert 'state' not in result and len(str(result)) < 1000
        bid = result['active']
        assert client.get(f'/api/branches/{bid}').status_code == 200
        assert other.get(f'/api/branches/{bid}').status_code == 404
        assert other.get(f'/api/branches/{bid}/entries').status_code == 404
        for query in ['cursor=abc', 'cursor=-2', 'limit=101', 'limit=0', 'cursor=true']:
            assert client.get(f'/api/branches/{bid}/entries?{query}').status_code == 400
        assert client.get(f'/api/branches/{bid}/entries?anchor=missing').status_code == 404
        assert client.get('/api/topics?search=paged').json()['items'][0]['title'] == 'paged'
