from __future__ import annotations
import json, uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from .config import settings
from .db import AuthSession, Base, Workspace, engine, new_session, token_hash, utcnow
from .domain import DomainError, empty_state, transition, validate_state
from .services import ApiError, complete, error, public_config, rate_limit, save_config

class Action(BaseModel):
    model_config=ConfigDict(extra="allow")
    type:str
    revision:StrictInt=Field(ge=0)
    branchId:str|None=None
class ConfigInput(BaseModel): baseUrl:str=Field(max_length=2048); model:str=Field(min_length=1,max_length=200); apiKey:str=Field(max_length=4096); timeoutMs:int|None=Field(default=None,ge=100,le=600000)
class SnapshotInput(BaseModel): state:dict; revision:int=Field(ge=0)
class ChatInput(BaseModel): branchId:str; revision:int=Field(ge=0)
class MetadataInput(BaseModel): branchId:str; prompt:str=Field(min_length=1,max_length=12000); answer:str=Field(min_length=1,max_length=40000); labels:list[str]=Field(max_length=100)
class RerankInput(BaseModel): query:str=Field(min_length=1,max_length=12000); candidates:list[dict]=Field(max_length=8)
def db():
    with Session(engine) as value: yield value
def user(response:Response, session:str|None=Cookie(default=None,alias="zhishu_session"), database:Session=Depends(db)):
    record=database.scalar(select(AuthSession).where(AuthSession.token_hash==token_hash(session or ""),AuthSession.expires_at>utcnow())) if session else None
    if record:return record.user_id
    uid,token=new_session(database); response.set_cookie("zhishu_session",token,httponly=True,samesite="lax",secure=settings.production(),max_age=30*86400,path="/"); return uid
def snapshot(database,user_id):
    row=database.get(Workspace,user_id)
    if not row: row=Workspace(user_id=user_id,state=json.dumps(empty_state()),version=0,updated_at=utcnow()); database.add(row); database.commit()
    return {"state":validate_state(json.loads(row.state)),"revision":row.version}
def replace(database,user_id,state,revision):
    changed=database.execute(update(Workspace).where(Workspace.user_id==user_id,Workspace.version==revision).values(state=json.dumps(state,ensure_ascii=False),version=revision+1,updated_at=utcnow())).rowcount
    if changed!=1:error(409,"工作区已被其他请求更新，请刷新后重试。")
    database.commit(); return revision+1
@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine); yield
app=FastAPI(title="Zhishu",lifespan=lifespan)
def error_response(request: Request, status_code: int, message: str):
    return JSONResponse({"error": message, "requestId": getattr(request.state, "request_id", str(uuid.uuid4()))}, status_code=status_code)
@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return error_response(request, exc.status_code, str(exc.detail))
@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return error_response(request, 400, "请求格式错误。")
@app.exception_handler(DomainError)
async def domain_error(request: Request, exc: DomainError):
    return error_response(request, 400, str(exc))
@app.exception_handler(ApiError)
async def api_error(request: Request, exc: ApiError):
    return error_response(request, exc.status, exc.message)
@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    return error_response(request, 500, "服务暂不可用。")
@app.middleware("http")
async def request_id(request:Request, call_next):
    request.state.request_id=str(uuid.uuid4())
    response=await call_next(request)
    response.headers["X-Request-ID"]=request.state.request_id; return response
@app.get("/healthz")
def health(): return {"status":"ok"}
@app.get("/readyz")
def ready(database:Session=Depends(db)): database.execute(select(Workspace).limit(1)); return {"status":"ready","storage":"sqlite-single-instance"}
@app.get("/api/status")
def status(uid=Depends(user),database:Session=Depends(db)):
    item=public_config(database,uid); return {"configured":item["configured"],"model":item["model"],"mode":"configured" if item["configured"] else "offline"}
@app.get("/api/ai/config")
def get_config(uid=Depends(user),database:Session=Depends(db)): return public_config(database,uid)
@app.post("/api/ai/config")
def post_config(input:ConfigInput,uid=Depends(user),database:Session=Depends(db)): return save_config(database,uid,input)
@app.post("/api/ai/config/clear")
def clear_config(payload:dict,uid=Depends(user),database:Session=Depends(db)):
    if payload.get("confirm") is not True:error(400,"请确认清除模型配置。")
    from .db import UserAiConfig
    row=database.get(UserAiConfig,uid)
    if row: database.delete(row); database.commit()
    return public_config(database,uid)
@app.post("/api/ai/config/test")
async def test_config(uid=Depends(user),database:Session=Depends(db)): rate_limit(uid,"test",5); await complete(database,uid,[{"role":"user","content":"Reply with OK."}]); return {"ok":True}
@app.get("/api/workspace")
def get_workspace(uid=Depends(user),database:Session=Depends(db)): return snapshot(database,uid)
@app.post("/api/workspace/actions")
async def action(input:Action,uid=Depends(user),database:Session=Depends(db)):
    return apply_action(database,uid,snapshot(database,uid),input.model_dump())
def apply_action(database,uid,current,payload):
    next=transition(current["state"],payload); return {"state":next,"revision":replace(database,uid,next,payload["revision"])}
@app.post("/api/workspace/restore")
def restore(input:SnapshotInput,uid=Depends(user),database:Session=Depends(db)):
    state=validate_state(input.state); return {"state":state,"revision":replace(database,uid,state,input.revision)}
@app.get("/api/export")
def export(uid=Depends(user),database:Session=Depends(db)): return {"schemaVersion":2,"state":snapshot(database,uid)["state"]}
@app.post("/api/import")
def import_workspace(input:SnapshotInput,uid=Depends(user),database:Session=Depends(db)):
    state=validate_state(input.state); return {"state":state,"revision":replace(database,uid,state,input.revision)}
@app.post("/api/ai/chat")
async def chat(input:ChatInput,uid=Depends(user),database:Session=Depends(db)):
    rate_limit(uid,"chat",20); current=snapshot(database,uid)
    if current["revision"]!=input.revision:error(409,"工作区已被其他请求更新，请刷新后重试。")
    branch=next((x for x in current["state"]["branches"] if x["id"]==input.branchId),None)
    if not branch or not branch.get("awaiting") or not branch["entries"] or branch["entries"][-1]["role"]!="user":error(409,"没有等待回答的问题。")
    answer=await complete(database,uid,[{"role":"system","content":"你是一位严谨的中文学习助手。使用 Markdown 与 LaTex。"}]+[{"role":x["role"],"content":x["text"]} for x in branch["entries"]])
    state=transition(current["state"],{"type":"answer","branchId":input.branchId,"text":answer}); return {"state":state,"revision":replace(database,uid,state,input.revision),"answer":answer}
@app.post("/api/ai/metadata")
async def metadata(input:MetadataInput,uid=Depends(user),database:Session=Depends(db)):
    rate_limit(uid,"metadata",20); raw=await complete(database,uid,[{"role":"system","content":"只返回 JSON: {\"title\":\"...\",\"labels\":[\"...\"]}"},{"role":"user","content":json.dumps(input.model_dump(),ensure_ascii=False)}])
    try:
        value=json.loads(raw.removeprefix("```json").removesuffix("```").strip()); return {"title":str(value["title"])[:120],"labels":[str(x) for x in value["labels"]][:3]}
    except Exception:error(502,"模型返回的主题格式无效。")
@app.post("/api/ai/rerank")
async def rerank(input:RerankInput,uid=Depends(user),database:Session=Depends(db)):
    rate_limit(uid,"rerank",20); raw=await complete(database,uid,[{"role":"system","content":"按相关性排列候选，只返回 JSON: {\"ids\":[\"候选id\"]}"},{"role":"user","content":input.model_dump_json()}])
    try:
        ids=json.loads(raw)["ids"]; allowed={x["id"] for x in input.candidates}
        if not isinstance(ids,list) or any(x not in allowed for x in ids):raise ValueError()
        return {"ids":list(dict.fromkeys(ids))}
    except Exception:error(502,"模型返回的排序格式无效。")
dist=Path(settings.web_dist).resolve()
if dist.exists():
    app.mount("/assets",StaticFiles(directory=dist/"assets"),name="assets")
    @app.get("/{path:path}")
    def spa(path:str): return FileResponse(dist/"index.html")
