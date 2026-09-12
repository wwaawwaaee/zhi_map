from __future__ import annotations
import copy, re, uuid
from datetime import datetime, timezone
from typing import Any
from .utf16 import utf16_length, utf16_slice

class DomainError(ValueError): pass
def fail(message: str): raise DomainError(message)
def ident(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
def empty_state(): return {"version": 2, "sessions": [], "branches": [], "active": None}
def _branch(state, branch_id=None):
    item = next((x for x in state["branches"] if x["id"] == (branch_id or state["active"])), None)
    if not item: fail("分支已不存在，请刷新选择。")
    return item
def _session(state, session_id): return next(x for x in state["sessions"] if x["id"] == session_id)
def _message(branch, session, text, role, simulated=False):
    mid = ident(); return {"id": mid, "kind":"message", "role":role, "text":text, "inherited":False, "simulated":simulated, "createdAt":now(), "source":{"sessionId":session["id"],"sessionTitle":session["title"],"branchId":branch["id"],"branchTitle":branch["title"],"messageId":mid}}
def _add_session(state, title):
    session={"id":ident(),"title":title}; branch={"id":ident(),"sessionId":session["id"],"title":title,"tags":[],"parent":None,"kept":False,"draft":"","entries":[]}
    state["sessions"].append(session); state["branches"].append(branch); state["active"]=branch["id"]; return branch
def _history(text): return bool(re.search(r"(?:结合|参考|引用|联系|根据|沿用|回顾|对比).{0,20}(?:之前|以前|上次|历史|聊过)|(?:之前|以前|上次).{0,16}(?:聊过|讨论过|会话|谈过)", text, re.I))
def _tags(tags, existing=()):
    pool={str(x).strip().casefold():str(x).strip() for x in existing if str(x).strip()}; out={}
    for value in tags:
        text=" ".join(str(value).strip().split())
        if text: out[text.casefold()]=pool.setdefault(text.casefold(), text)
    return list(out.values())[:12]
def _preview(state, branch_id, entry_id):
    entries=_branch(state, branch_id)["entries"]; index=next((i for i,x in enumerate(entries) if x["id"]==entry_id and x["kind"]=="message"), -1)
    if index < 0: fail("截点已失效，请刷新选择。")
    return copy.deepcopy(entries[:index+1])
def _selection_preview(state, branch_id, selection):
    entries=_preview(state, branch_id, selection["entryId"]); last=entries[-1]; start,end=selection["start"],selection["end"]
    if not all(isinstance(x,int) for x in (start,end)) or start<0 or end<=start or end>utf16_length(last["text"]) or utf16_slice(last["text"],start,end)!=selection["text"]: fail("选区范围已失效，不能退化为整消息。")
    base=last.get("range",{}).get("start",0); last["text"]=utf16_slice(last["text"],0,end); last["range"]={"start":base,"end":base+end}; return entries
def _references(state,target_id,source_id,selected,ranges):
    if target_id==source_id or not selected or len(set(selected)) != len(selected): fail("引用选择无效。")
    target,source=_branch(state,target_id),_branch(state,source_id); existing={f'{x["source"]["branchId"]}/{x["source"]["messageId"]}' for x in target["entries"]}
    available=[x for x in source["entries"] if x["kind"]=="message" and f'{x["source"]["branchId"]}/{x["source"]["messageId"]}' not in existing]
    if not all(any(x["id"]==i for x in available) for i in selected): fail("来源选择已失效或重复。")
    result=[]
    for entry in available:
        if entry["id"] not in selected: continue
        item=copy.deepcopy(entry); span=ranges.get(entry["id"])
        if span:
            start,end=span["start"],span["end"]
            if not isinstance(start,int) or not isinstance(end,int) or start<0 or end<=start or end>utf16_length(entry["text"]): fail("引用范围无效。")
            base=entry.get("range",{}).get("start",0); item["text"]=utf16_slice(entry["text"],start,end); item["range"]={"start":base+start,"end":base+end}
        result.append(item)
    return result
def seed_state():
    state=empty_state(); b=_add_session(state,"二次函数：从配方看见顶点"); s=state["sessions"][0]; b["tags"]=["二次函数","配方法"]
    for text,role,sim in [("二次函数 y = x² − 4x + 1 的顶点在哪里？为什么配方能看出最小值？","user",False),("## 把函数写成「平方 + 常数」\n\n$$y=x^2-4x+1=(x-2)^2-3$$\n\n平方项总是非负，因此 (x − 2)² 最小为 0。x = 2 时 y = −3，所以顶点为 (2, −3)。","assistant",True),("后续消息：下一步再练习求函数与坐标轴的交点。","user",True),("这是人工编写的学习示例。你可以选中上方的“平方项总是非负”，展开一个独立问题；这里的后续消息不会被带入。","assistant",True)]: b["entries"].append(_message(b,s,text,role,sim))
    second=_add_session(state,"完全平方公式：为什么要补 4"); s=state["sessions"][-1]; second["tags"]=["配方法"]; second["entries"].append(_message(second,s,"完全平方公式怎么帮助我们配方？","user",True)); second["entries"].append(_message(second,s,"利用分配律，(a − b)² = a² − 2ab + b²。令 a = x，b = 2，就有 (x − 2)² = x² − 4x + 4。","assistant",True)); state["active"]=b["id"]; return state
def transition(state: dict, action: dict):
    next=copy.deepcopy(state); kind=action.get("type"); b=lambda:_branch(next,action.get("branchId")); text=str(action.get("text","")).strip()
    if kind=="create":
        if not isinstance(action.get("title"),str) or not action["title"].strip(): fail("请输入会话名称。")
        _add_session(next,action["title"].strip())
    elif kind=="sample":
        if next["branches"]: fail("示例只能在空工作区中加载。")
        return seed_state()
    elif kind=="switch": _branch(next,action.get("branchId")); next["active"]=action["branchId"]
    elif kind=="draft": b()["draft"]=str(action.get("text", ""))
    elif kind=="metadata":
        current=b(); title=action.get("title")
        if not isinstance(title,str) or not title.strip(): fail("名称不能为空。")
        current["title"]=title.strip(); current["tags"]=_tags(action.get("tags",[]),[t for x in next["branches"] for t in x["tags"]]); current["metadataDone"]=True
    elif kind=="keep": b()["kept"]=not b()["kept"]
    elif kind in ("fork","expand"):
        parent=b(); selection=action.get("selection")
        if kind=="fork": entries=_preview(next,parent["id"],action.get("entryId")); entry_id=action.get("entryId"); title=action.get("title") or "新的探索"; selected=entries
        else:
            if not selection or not text: fail("请填写要展开的问题。")
            entries=_selection_preview(next,parent["id"],selection); ids=action.get("contextIds",[])
            if not all(any(x["id"]==i for x in entries) for i in ids): fail("上下文选择已失效。")
            entry_id=selection["entryId"]; title=text[:36]; selected=[x for x in entries if x["id"] in ids]
        child={"id":ident(),"sessionId":parent["sessionId"],"title":title.strip(),"tags":[],"parent":{"branchId":parent["id"],"branchTitle":parent["title"],"entryId":entry_id},"kept":False,"draft":"","entries":[{**x,"id":ident(),"inherited":True} for x in selected]}
        if kind=="expand": child["selection"]=copy.deepcopy(selection)
        next["branches"].append(child); next["active"]=child["id"]
        if kind=="expand" and _history(text): child["pendingPrompt"]=text
        elif kind=="expand": return transition(next,{"type":"send","branchId":child["id"],"text":text})
    elif kind in ("reference","resolveHistory"):
        current=b()
        if kind=="resolveHistory":
            if not current.get("pendingPrompt") or action.get("decision") not in ("skip","reference"): fail("没有待确认的历史问题。")
            prompt=current.pop("pendingPrompt")
            if action["decision"]=="reference": current["entries"] += [{**x,"id":ident(),"kind":"reference","inherited":False,"createdAt":now()} for x in _references(next,current["id"],action.get("sourceId"),action.get("selectedIds",[]),action.get("ranges",{}))]
            return transition(next,{"type":"send","branchId":current["id"],"text":prompt,"confirmedHistory":True})
        if current.get("awaiting") or current.get("pendingPrompt"): fail("请先完成当前问题或确认历史引用。")
        current["entries"] += [{**x,"id":ident(),"kind":"reference","inherited":False,"createdAt":now()} for x in _references(next,current["id"],action.get("sourceId"),action.get("selectedIds",[]),action.get("ranges",{}))]
    elif kind=="removeReference":
        current=b()
        if current.get("awaiting") or not any(x["id"]==action.get("entryId") and x["kind"]=="reference" for x in current["entries"]): fail("引用已不存在或问题正在等待。")
        current["entries"]=[x for x in current["entries"] if x["id"]!=action.get("entryId")]
    elif kind=="send":
        current=b(); prompt=text or current["draft"].strip()
        if not prompt or current.get("awaiting") or current.get("pendingPrompt"): fail("请输入问题，或先完成当前问题。")
        if _history(prompt) and not action.get("confirmedHistory"): current["pendingPrompt"]=prompt; current["draft"]=""
        else: current["entries"].append(_message(current,_session(next,current["sessionId"]),prompt,"user")); current["awaiting"]=True; current["draft"]=""
    elif kind=="answer":
        current=b()
        if not current.get("awaiting") or not text: fail("没有等待回答或模型未返回正文。")
        current["entries"].append(_message(current,_session(next,current["sessionId"]),text,"assistant")); current.pop("awaiting",None)
    elif kind=="retryToDraft":
        current=b()
        if not current.get("awaiting") or not current["entries"] or current["entries"][-1]["role"]!="user": fail("没有待重试的问题。")
        current["draft"]="\n\n".join(x for x in [current["entries"].pop()["text"],current["draft"]] if x); current.pop("awaiting",None)
    elif kind=="delete":
        target=action.get("targetId")
        if action.get("kind")=="session":
            session=next((x for x in next["sessions"] if x["id"]==target),None)
            if not session: fail("会话已不存在。")
            roots=[x["id"] for x in next["branches"] if x["sessionId"]==target and not x["parent"]]; children=[x for x in next["branches"] if x["sessionId"]==target and x["parent"]]; next["branches"]=[x for x in next["branches"] if x["id"] not in roots]; next["sessions"]=[x for x in next["sessions"] if x["id"]!=target]
            if children:
                kept={"id":ident(),"title":session["title"]+" · 保留的独立分支"}; next["sessions"].append(kept)
                for child in children: child["sessionId"]=kept["id"]
        else: _branch(next,target); next["branches"]=[x for x in next["branches"] if x["id"]!=target]
        if next["active"] and not any(x["id"]==next["active"] for x in next["branches"]): next["active"]=next["branches"][0]["id"] if next["branches"] else None
    elif kind=="restore": return validate_state(action.get("state"))
    else: fail("未知操作。")
    return next
def validate_state(state: Any):
    if not isinstance(state,dict) or state.get("version")!=2 or not isinstance(state.get("sessions"),list) or not isinstance(state.get("branches"),list): fail("存储格式不受支持。")
    sessions=state["sessions"]; branches=state["branches"]
    if any(not isinstance(item,dict) or not isinstance(item.get("id"),str) or not item["id"] or not isinstance(item.get("title"),str) for item in sessions): fail("存储格式不受支持。")
    ids={item["id"] for item in sessions}
    if len(ids)!=len(sessions) or any(not isinstance(item,dict) or not isinstance(item.get("id"),str) or not item["id"] or item.get("sessionId") not in ids or not isinstance(item.get("entries"),list) for item in branches): fail("存储格式不受支持。")
    branch_ids={item["id"] for item in branches}
    if len(branch_ids)!=len(branches) or state.get("active") not in branch_ids | {None}: fail("存储格式不受支持。")
    return copy.deepcopy(state)
