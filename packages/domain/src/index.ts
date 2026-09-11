export type Role = 'user' | 'assistant';
export type Entry = { id: string; kind: 'message' | 'reference'; role: Role; text: string; inherited: boolean; simulated: boolean; createdAt: string; source: Source; range?: Range };
export type Source = { sessionId: string; sessionTitle: string; branchId: string; branchTitle: string; messageId: string };
export type Range = { start: number; end: number };
export type Selection = Range & { entryId: string; text: string };
export type Branch = { id: string; sessionId: string; title: string; tags: string[]; parent: null | { branchId: string; branchTitle: string; entryId: string }; kept: boolean; draft: string; entries: Entry[]; selection?: Selection; pendingPrompt?: string; awaiting?: boolean; metadataDone?: boolean };
export type State = { version: 2; sessions: { id: string; title: string }[]; branches: Branch[]; active: string | null };
export type Action = { type: string; branchId?: string; [key: string]: unknown };

const clone = <T>(value: T): T => structuredClone(value);
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = (message: string): never => { throw new Error(message); };
function required(ok: unknown, message: string): asserts ok { if (!ok) fail(message); }
export const emptyState = (): State => ({ version: 2, sessions: [], branches: [], active: null });
export const branchOf = (state: State, branchId = state.active): Branch => {
  const branch = state.branches.find((item) => item.id === branchId);
  required(branch, '分支已不存在，请刷新选择。'); return branch;
};
export const sourceKey = (source: Source) => `${source.branchId}/${source.messageId}`;
export const sourceAvailable = (state: State, source: Source) => state.branches.some((branch) => branch.id === source.branchId && branch.entries.some((entry) => entry.kind === 'message' && entry.id === source.messageId && !entry.inherited));
export const historyIntent = (text: string) => /(?:结合|参考|引用|联系|根据|沿用|回顾|对比).{0,20}(?:之前|以前|上次|历史|聊过)|(?:之前|以前|上次).{0,16}(?:聊过|讨论过|会话|谈过)/i.test(text);
export function normalizeTags(tags: unknown[], existing: string[] = []): string[] {
  const pool = new Map(existing.map((x) => x.normalize('NFKC').trim()).filter(Boolean).map((x) => [x.toLowerCase(), x]));
  const result = new Map<string, string>();
  for (const value of tags) { const text = String(value).normalize('NFKC').trim().replace(/\s+/g, ' '); if (text) { const key = text.toLowerCase(); if (!pool.has(key)) pool.set(key, text); result.set(key, pool.get(key)!); } }
  return [...result.values()].slice(0, 12);
}
function addSession(state: State, title: string): Branch {
  const session = { id: id(), title }; const branch: Branch = { id: id(), sessionId: session.id, title, tags: [], parent: null, kept: false, draft: '', entries: [] };
  state.sessions.push(session); state.branches.push(branch); state.active = branch.id; return branch;
}
function message(branch: Branch, session: { id: string; title: string }, text: string, role: Role, simulated = false): Entry {
  const messageId = id(); return { id: messageId, kind: 'message', role, text, simulated, inherited: false, createdAt: now(), source: { sessionId: session.id, sessionTitle: session.title, branchId: branch.id, branchTitle: branch.title, messageId } };
}
export function seedState(): State {
  const state = emptyState(); const branch = addSession(state, '二次函数：从配方看见顶点'); const session = state.sessions[0]!; branch.tags = ['二次函数', '配方法'];
  branch.entries.push(message(branch, session, '二次函数 y = x² − 4x + 1 的顶点在哪里？为什么配方能看出最小值？', 'user'));
  branch.entries.push(message(branch, session, '## 把函数写成「平方 + 常数」\n\n$$y=x^2-4x+1=(x-2)^2-3$$\n\n平方项总是非负，因此 (x − 2)² 最小为 0。x = 2 时 y = −3，所以顶点为 (2, −3)。', 'assistant', true));
  branch.entries.push(message(branch, session, '后续消息：下一步再练习求函数与坐标轴的交点。', 'user', true));
  branch.entries.push(message(branch, session, '这是人工编写的学习示例。你可以选中上方的“平方项总是非负”，展开一个独立问题；这里的后续消息不会被带入。', 'assistant', true));
  const second = addSession(state, '完全平方公式：为什么要补 4'); const other = state.sessions.at(-1)!; second.tags = ['配方法'];
  second.entries.push(message(second, other, '完全平方公式怎么帮助我们配方？', 'user', true));
  second.entries.push(message(second, other, '利用分配律，(a − b)² = a² − 2ab + b²。令 a = x，b = 2，就有 (x − 2)² = x² − 4x + 4。', 'assistant', true));
  state.active = branch.id;
  return state;
}
function preview(state: State, branchId: string, entryId: string): Entry[] { const entries = branchOf(state, branchId).entries; const index = entries.findIndex((e) => e.id === entryId && e.kind === 'message'); required(index >= 0, '截点已失效，请刷新选择。'); return clone(entries.slice(0, index + 1)); }
export function selectionPreview(state: State, branchId: string, selection: Selection): Entry[] {
  const entries = preview(state, branchId, selection.entryId); const last = entries.at(-1)!;
  required(Number.isInteger(selection.start) && Number.isInteger(selection.end) && selection.start >= 0 && selection.end > selection.start && selection.end <= last.text.length && last.text.slice(selection.start, selection.end) === selection.text, '选区范围已失效，不能退化为整消息。');
  last.text = last.text.slice(0, selection.end); last.range = { start: last.range?.start ?? 0, end: (last.range?.start ?? 0) + selection.end }; return entries;
}
export function referencePreview(state: State, targetId: string, sourceId: string, selectedIds: string[], ranges: Record<string, Range> = {}): Entry[] {
  required(targetId !== sourceId && selectedIds.length > 0 && new Set(selectedIds).size === selectedIds.length, '引用选择无效。'); const target = branchOf(state, targetId); const source = branchOf(state, sourceId); const existing = new Set(target.entries.map((e) => sourceKey(e.source)));
  const available = source.entries.filter((e) => e.kind === 'message' && !existing.has(sourceKey(e.source))); required(selectedIds.every((x) => available.some((e) => e.id === x)), '来源选择已失效或重复。');
  return available.filter((e) => selectedIds.includes(e.id)).map((entry) => { const range = ranges[entry.id]; if (!range) return clone(entry); required(Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= entry.text.length, '引用范围无效。'); const start = (entry.range?.start ?? 0) + range.start; return { ...clone(entry), text: entry.text.slice(range.start, range.end), range: { start, end: start + range.end - range.start } }; });
}
export function transition(state: State, action: Action): State {
  const next = clone(state); const branch = () => branchOf(next, action.branchId as string | undefined); const text = typeof action.text === 'string' ? action.text.trim() : '';
  switch (action.type) {
    case 'create': { const title = action.title; required(typeof title === 'string' && title.trim(), '请输入会话名称。'); addSession(next, title.trim()); break; }
    case 'sample': { required(next.branches.length === 0, '示例只能在空工作区中加载。'); return seedState(); }
    case 'switch': branchOf(next, action.branchId as string); next.active = action.branchId as string; break;
    case 'draft': branch().draft = String(action.text ?? ''); break;
    case 'metadata': { const current = branch(), title = action.title; required(typeof title === 'string' && title.trim(), '名称不能为空。'); current.title = title.trim(); current.tags = normalizeTags(Array.isArray(action.tags) ? action.tags : [], next.branches.flatMap((b) => b.tags)); current.metadataDone = true; break; }
    case 'keep': branch().kept = !branch().kept; break;
    case 'fork': { const parent = branch(); const entryId = action.entryId as string; const entries = preview(next, parent.id, entryId).map((entry) => ({ ...entry, id: id(), inherited: true })); const child: Branch = { id: id(), sessionId: parent.sessionId, title: typeof action.title === 'string' && action.title.trim() ? action.title.trim() : '新的探索', tags: [], parent: { branchId: parent.id, branchTitle: parent.title, entryId }, kept: false, draft: '', entries }; next.branches.push(child); next.active = child.id; break; }
    case 'expand': { const parent = branch(); const selection = action.selection as Selection; required(selection && text, '请填写要展开的问题。'); const context = selectionPreview(next, parent.id, selection); const ids = Array.isArray(action.contextIds) ? action.contextIds as string[] : []; required(ids.every((x) => context.some((e) => e.id === x)), '上下文选择已失效。'); const child: Branch = { id: id(), sessionId: parent.sessionId, title: text.slice(0, 36), tags: [], parent: { branchId: parent.id, branchTitle: parent.title, entryId: selection.entryId }, selection: clone(selection), kept: false, draft: '', entries: context.filter((e) => ids.includes(e.id)).map((e) => ({ ...e, id: id(), inherited: true })) }; next.branches.push(child); next.active = child.id; if (historyIntent(text)) child.pendingPrompt = text; else return transition(next, { type: 'send', branchId: child.id, text }); break; }
    case 'resolveHistory': { const current = branch(); required(current.pendingPrompt && (action.decision === 'skip' || action.decision === 'reference'), '没有待确认的历史问题。'); const prompt = current.pendingPrompt; if (action.decision === 'reference') { const selected = referencePreview(next, current.id, action.sourceId as string, action.selectedIds as string[], (action.ranges ?? {}) as Record<string, Range>); current.entries.push(...selected.map((e) => ({ ...e, id: id(), kind: 'reference' as const, inherited: false, createdAt: now() }))); } delete current.pendingPrompt; return transition(next, { type: 'send', branchId: current.id, text: prompt, confirmedHistory: true }); }
    case 'reference': { const current = branch(); required(!current.awaiting && !current.pendingPrompt, '请先完成当前问题或确认历史引用。'); const selected = referencePreview(next, current.id, action.sourceId as string, action.selectedIds as string[], (action.ranges ?? {}) as Record<string, Range>); current.entries.push(...selected.map((e) => ({ ...e, id: id(), kind: 'reference' as const, inherited: false, createdAt: now() }))); break; }
    case 'removeReference': { const current = branch(); required(!current.awaiting && current.entries.some((e) => e.id === action.entryId && e.kind === 'reference'), '引用已不存在或问题正在等待。'); current.entries = current.entries.filter((e) => e.id !== action.entryId); break; }
    case 'send': { const current = branch(); const prompt = text || current.draft.trim(); required(prompt && !current.awaiting && !current.pendingPrompt, '请输入问题，或先完成当前问题。'); if (historyIntent(prompt) && action.confirmedHistory !== true) { current.pendingPrompt = prompt; current.draft = ''; break; } const session = next.sessions.find((s) => s.id === current.sessionId)!; current.entries.push(message(current, session, prompt, 'user')); current.awaiting = true; current.draft = ''; break; }
    case 'answer': { const current = branch(); required(current.awaiting && text, '没有等待回答或模型未返回正文。'); current.entries.push(message(current, next.sessions.find((s) => s.id === current.sessionId)!, text, 'assistant')); delete current.awaiting; break; }
    case 'retryToDraft': { const current = branch(); required(current.awaiting && current.entries.at(-1)?.role === 'user', '没有待重试的问题。'); current.draft = [current.entries.pop()!.text, current.draft].filter(Boolean).join('\n\n'); delete current.awaiting; break; }
    case 'delete': { if (action.kind === 'session') { const sessionId = action.targetId as string; const session = next.sessions.find((item) => item.id === sessionId); required(session, '会话已不存在。'); const removed = next.branches.filter((item) => item.sessionId === sessionId && !item.parent); const removedIds = new Set(removed.map((item) => item.id)); const children = next.branches.filter((item) => item.sessionId === sessionId && item.parent); next.branches = next.branches.filter((item) => !removedIds.has(item.id)); next.sessions = next.sessions.filter((item) => item.id !== sessionId); if (children.length) { const preserved = { id: id(), title: `${session.title} · 保留的独立分支` }; next.sessions.push(preserved); children.forEach((item) => { item.sessionId = preserved.id; }); } } else { const target = branchOf(next, action.targetId as string); next.branches = next.branches.filter((item) => item.id !== target.id); } if (next.active && !next.branches.some((item) => item.id === next.active)) next.active = next.branches[0]?.id ?? null; break; }
    case 'restore': { required(action.state && typeof action.state === 'object', '没有可恢复的版本。'); return validateState(action.state); }
    default: fail('未知操作。');
  }
  return next;
}
export function validateState(state: unknown): State { const value = state as State; const validRange = (range: unknown): range is Range => Boolean(range && typeof range === 'object' && Number.isInteger((range as Range).start) && Number.isInteger((range as Range).end) && (range as Range).start >= 0 && (range as Range).end > (range as Range).start); const validEntry = (entry: unknown) => { const e = entry as Entry; return Boolean(e && typeof e === 'object' && typeof e.id === 'string' && (e.kind === 'message' || e.kind === 'reference') && (e.role === 'user' || e.role === 'assistant') && typeof e.text === 'string' && typeof e.inherited === 'boolean' && typeof e.simulated === 'boolean' && typeof e.createdAt === 'string' && e.source && typeof e.source.sessionId === 'string' && typeof e.source.sessionTitle === 'string' && typeof e.source.branchId === 'string' && typeof e.source.branchTitle === 'string' && typeof e.source.messageId === 'string' && (!e.range || validRange(e.range))); }; required(value && typeof value === 'object' && value.version === 2 && Array.isArray(value.sessions) && Array.isArray(value.branches), '存储格式不受支持。'); required(value.sessions.every((s) => typeof s.id === 'string' && typeof s.title === 'string') && new Set(value.sessions.map((s) => s.id)).size === value.sessions.length && value.branches.every((b) => typeof b.id === 'string' && typeof b.sessionId === 'string' && typeof b.title === 'string' && Array.isArray(b.tags) && b.tags.every((tag) => typeof tag === 'string') && typeof b.kept === 'boolean' && typeof b.draft === 'string' && Array.isArray(b.entries) && b.entries.every(validEntry) && value.sessions.some((s) => s.id === b.sessionId) && (!b.parent || typeof b.parent.branchId === 'string' && typeof b.parent.branchTitle === 'string' && typeof b.parent.entryId === 'string') && (!b.selection || typeof b.selection.entryId === 'string' && typeof b.selection.text === 'string' && validRange(b.selection)) && (!b.pendingPrompt || typeof b.pendingPrompt === 'string') && (!b.awaiting || typeof b.awaiting === 'boolean') && (!b.metadataDone || typeof b.metadataDone === 'boolean')) && new Set(value.branches.map((b) => b.id)).size === value.branches.length && (value.active === null || value.branches.some((b) => b.id === value.active)), '工作区数据损坏。'); return value; }
