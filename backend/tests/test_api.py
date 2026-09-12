import os
os.environ["DATABASE_URL"]="sqlite:///./test-zhishu.db"
from fastapi.testclient import TestClient
from app.main import app

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
        branch=created["state"]["active"]
        pending=client.post("/api/workspace/actions",json={"type":"send","branchId":branch,"text":"hello","revision":created["revision"]})
        assert client.post("/api/ai/chat",json={"branchId":branch,"revision":pending.json()["revision"]}).status_code == 503
