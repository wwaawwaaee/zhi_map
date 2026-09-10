// Ordered, immutable snapshots are the only context. No hidden imports or model calls.
import { suggestMetadata, normalizeTags, historyIntent } from './provider.mjs';
export const STORAGE_KEY = 'learning-branches.v1';
const copy = value => structuredClone(value);
const id = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const historyConfirmed = Symbol('history-confirmed');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const branchOf = (state, branchId = state.active) => {
  const branch = state.branches.find(b => b.id === branchId);
  requireValue(branch, '分支已不存在，请刷新选择。');
  return branch;
};
// Explanation object is independent of optional background and organizational labels.
export function discussionInput(state, branchId = state.active, prompt) {
  const b = branchOf(state, branchId);
  return { prompt: String(prompt ?? b.pendingPrompt ?? b.draft).trim(),
    anchor: b.selection ? copy(b.selection) : null, context: copy(b.entries) };
}
export const sourceKey = source => `${source.branchId}/${source.messageId}`;
export function sourceAvailable(state, source) {
  return state.branches.some(b => b.id === source.branchId && b.entries.some(e => e.kind === 'message' && e.id === source.messageId && !e.inherited));
}
function message(branch, text, role, session, simulated = false) {
  const messageId = id();
  return { id: messageId, kind: 'message', role, text, simulated, inherited: false,
    source: { sessionId: session.id, sessionTitle: session.title, branchId: branch.id, branchTitle: branch.title, messageId }, createdAt: now() };
}
export function emptyState() { return { version: 1, sessions: [], branches: [], active: null }; }
function addSession(state, title) {
  const session = { id: id(), title };
  const branch = { id: id(), sessionId: session.id, title, tags: [], parent: null, kept: false, draft: '', entries: [] };
  state.sessions.push(session); state.branches.push(branch); state.active = branch.id;
  return branch;
}
export function seedState() {
  const state = emptyState();
  const first = addSession(state, '二次函数：从配方看见顶点');
  const s1 = state.sessions[0];
  first.tags = ['二次函数', '配方法'];
  first.entries.push(message(first, '二次函数 y = x² − 4x + 1 的顶点在哪里？为什么配方能看出最小值？', 'user', s1));
  first.entries.push(message(first, '## 把函数写成「平方 + 常数」\n\n观察 x² − 4x，可以补上 4，凑成完全平方。为了保持式子相等，补上的 4 也要减掉。\n\n$$y=x^2-4x+1=(x-2)^2-3$$\n\n### 为什么顶点是 (2, −3)？\n\n平方项总是非负。因此 (x − 2)² 最小为 0，恰好在 x = 2 时取到。这时 y = −3，所以顶点为 (2, −3)，对称轴为 x = 2。\n\n### 从图像理解\n\n从 y = x² 出发，向右平移 2 个单位，再向下平移 3 个单位，就得到这条抛物线。它开口向上，顶点也是最低点。\n\n**试试看：**把 x = 1 和 x = 3 分别代入，两个函数值都是 −2。它们到对称轴的距离相同。\n\n一般地，y = a(x − h)² + k（a ≠ 0）的顶点是 (h, k)；a > 0 时有最小值 k，a < 0 时有最大值 k。', 'assistant', s1, true));
  first.entries.push(message(first, '后续消息：下一步再练习求函数与坐标轴的交点。', 'user', s1));
  first.entries.push(message(first, '这是人工编写的学习示例。你可以选中上方的「平方项总是非负」，展开一个独立问题；这里的后续消息不会被带入。', 'assistant', s1, true));
  const second = addSession(state, '完全平方公式：为什么要补 4');
  const s2 = state.sessions[1];
  second.tags = ['配方法'];
  second.entries.push(message(second, '完全平方公式怎么帮助我们配方？', 'user', s2));
  second.entries.push(message(second, '利用分配律，(a − b)² = a² − 2ab + b²。令 a = x，b = 2，就有 (x − 2)² = x² − 4x + 4。所以 x² − 4x 需要补 4 才能成为完全平方。', 'assistant', s2, true));
  second.entries.push(message(second, '配方时要保持恒等：加上多少就减去多少。比如 x² + 6x + 2 = (x + 3)² − 7。可以展开右边检验。', 'assistant', s2, true));
  state.active = first.id;
  return state;
}
export function forkPreview(state, branchId, entryId) {
  const branch = branchOf(state, branchId);
  const index = branch.entries.findIndex(e => e.id === entryId && e.kind === 'message');
  requireValue(index >= 0, '截点已失效，请刷新选择。');
  return copy(branch.entries.slice(0, index + 1));
}
export function selectionPreview(state, branchId, selection) {
  const entries = forkPreview(state, branchId, selection.entryId), last = entries.at(-1);
  const { start, end, text } = selection;
  requireValue(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= last.text.length && last.text.slice(start, end) === text, '选区范围已失效，不能退化为整消息。');
  last.text = last.text.slice(0, end);
  last.range = { start: last.range?.start || 0, end: (last.range?.start || 0) + end };
  return entries;
}
const allTags = state => state.branches.flatMap(b => b.tags || []);
export function referenceCandidates(state, targetId, sourceId) {
  const target = branchOf(state, targetId), source = branchOf(state, sourceId);
  requireValue(source.id !== target.id, '请选择其他主题的消息。');
  const existing = new Set(target.entries.map(e => sourceKey(e.source)));
  return source.entries.filter(e => e.kind === 'message').map(e => ({ ...copy(e), duplicate: existing.has(sourceKey(e.source)) }));
}
export function referencePreview(state, targetId, sourceId, selectedIds, ranges = {}) {
  requireValue(Array.isArray(selectedIds) && selectedIds.length, '请至少选择一条消息。');
  const candidates = referenceCandidates(state, targetId, sourceId);
  requireValue(new Set(selectedIds).size === selectedIds.length && selectedIds.every(x => candidates.some(e => e.id === x)), '来源选择已失效，请刷新选择。');
  const selected = candidates.filter(e => selectedIds.includes(e.id));
  requireValue(selected.every(e => !e.duplicate), '同一来源消息已在当前上下文中，请取消重复选择。');
  // Inherited messages may have the same origin: deduplicate by stable origin, never by text.
  return selected.filter((e, i, all) => all.findIndex(x => sourceKey(x.source) === sourceKey(e.source)) === i).map(e => {
    const range = ranges[e.id];
    if (!range) return e;
    requireValue(Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= e.text.length, '引用范围无效。');
    const base = e.range?.start || 0;
    return { ...e, text: e.text.slice(range.start, range.end), range: { start: base + range.start, end: base + range.end } };
  });
}
export function deletionImpact(state, kind, targetId) {
  let removed;
  if (kind === 'session') {
    requireValue(state.sessions.some(s => s.id === targetId), '会话已不存在。');
    // Session deletion removes its main line; independent branches are relocated.
    removed = state.branches.filter(b => b.sessionId === targetId && !b.parent);
  } else removed = [branchOf(state, targetId)];
  const ids = new Set(removed.map(b => b.id));
  const survivors = state.branches.filter(b => !ids.has(b.id));
  const children = survivors.filter(b => kind === 'session' ? b.sessionId === targetId : b.parent?.branchId === targetId);
  const snapshots = survivors.flatMap(b => b.entries.filter(e => ids.has(e.source.branchId)).map(e => ({ branchId: b.id, branchTitle: b.title, entryId: e.id, kind: e.kind })));
  return { removed: removed.map(b => ({ id: b.id, title: b.title })), messages: removed.reduce((n, b) => n + b.entries.length, 0), drafts: removed.filter(b => b.draft).length,
    children: children.map(b => ({ id: b.id, title: b.title })), references: snapshots.filter(e => e.kind === 'reference').length, snapshots };
}
export function transition(state, action) {
  const next = copy(state);
  const get = () => branchOf(next, action.branchId ?? next.active);
  switch (action.type) {
    case 'create': requireValue(action.title?.trim(), '请输入会话名称。'); addSession(next, action.title.trim()); break;
    case 'switch': branchOf(next, action.branchId); next.active = action.branchId; break;
    case 'draft': get().draft = String(action.text); break;
    case 'rename': {
      requireValue(action.title?.trim(), '名称不能为空。');
      const target = action.kind === 'session' ? next.sessions.find(s => s.id === action.targetId) : branchOf(next, action.targetId);
      requireValue(target, '目标已不存在。'); target.title = action.title.trim(); break;
    }
    case 'keep': get().kept = !get().kept; break;
    case 'metadata': {
      const b = get(); requireValue(action.title?.trim(), '名称不能为空。');
      requireValue(Array.isArray(action.tags) && action.tags.every(t => typeof t === 'string'), '标签格式错误。');
      b.title = action.title.trim(); b.tags = normalizeTags(action.tags, allTags(next)); break;
    }
    case 'expand': {
      const parent = get(), preview = selectionPreview(next, parent.id, action.selection);
      requireValue(action.prompt?.trim(), '请填写要展开的问题。');
      requireValue(Array.isArray(action.contextIds) && new Set(action.contextIds).size === action.contextIds.length && action.contextIds.every(x => preview.some(e => e.id === x)), '上下文选择已失效。');
      const metadata = suggestMetadata(action.selection.text, action.prompt, allTags(next));
      const child = { id: id(), sessionId: parent.sessionId, ...metadata, selection: copy(action.selection),
        parent: { branchId: parent.id, branchTitle: parent.title, entryId: action.selection.entryId }, kept: false, draft: '',
        entries: preview.filter(e => action.contextIds.includes(e.id)).map(e => ({ ...e, id: id(), inherited: true })) };
      next.branches.push(child); next.active = child.id;
      if (historyIntent(action.prompt)) child.pendingPrompt = action.prompt.trim();
      else return transition(next, { type: 'send', text: action.prompt });
      break;
    }
    case 'resolveHistory': {
      const b = get(); requireValue(b.pendingPrompt, '没有待确认的历史问题。');
      requireValue(action.decision === 'skip' || action.decision === 'reference', '请确认历史引用或明确不引用。');
      let resolved = next;
      if (action.decision === 'reference') resolved = transition(next, { ...action, type: 'reference', [historyConfirmed]: 'reference' });
      const prompt = branchOf(resolved, b.id).pendingPrompt;
      delete branchOf(resolved, b.id).pendingPrompt;
      return transition(resolved, { type: 'send', branchId: b.id, text: prompt, [historyConfirmed]: action.decision });
    }
    case 'fork': {
      const parent = get();
      const entries = forkPreview(next, parent.id, action.entryId).map(e => ({ ...e, id: id(), inherited: true }));
      const child = { id: id(), sessionId: parent.sessionId, title: action.title?.trim() || '新的探索',
        parent: { branchId: parent.id, branchTitle: parent.title, entryId: action.entryId }, kept: false, draft: '', entries };
      next.branches.push(child); next.active = child.id; break;
    }
    case 'reference': {
      const target = get();
      requireValue(!target.awaiting, '当前问题已提交，请先结束等待再调整引用。');
      requireValue(!target.pendingPrompt || action[historyConfirmed] === 'reference', '请通过历史确认加入引用并继续。');
      const selected = referencePreview(next, target.id, action.sourceId, action.selectedIds, action.ranges);
      target.entries.push(...selected.map(e => ({ id: id(), kind: 'reference', role: e.role, text: e.text, simulated: e.simulated,
       source: copy(e.source), ...(e.range ? { range: copy(e.range) } : {}), inherited: false, createdAt: now() }))); break;
    }
    case 'removeReference': {
      const branch = get();
      requireValue(!branch.awaiting, '当前问题已提交，请先结束等待再调整引用。');
      requireValue(branch.entries.some(e => e.id === action.entryId && e.kind === 'reference'), '引用已不存在。');
      branch.entries = branch.entries.filter(e => e.id !== action.entryId); break;
    }
    case 'send': {
      const branch = get(), text = (action.text ?? branch.draft).trim();
      requireValue(text, '请输入消息。');
      requireValue(!branch.awaiting, '当前问题尚未回答，请重试或取消等待后再发送。');
      requireValue(!branch.pendingPrompt, '请先确认待处理问题的历史引用，或明确不引用继续。');
      if (historyIntent(text) && !action[historyConfirmed]) { branch.pendingPrompt = text; branch.draft = ''; break; }
      const session = next.sessions.find(s => s.id === branch.sessionId);
      branch.entries.push(message(branch, text, 'user', session));
      branch.awaiting = true;
      branch.draft = ''; break;
    }
    case 'answer': {
      const branch = get(); requireValue(branch.awaiting, '没有等待回答的问题。');
      requireValue(typeof action.text === 'string' && action.text.trim(), '模型没有返回正文。');
      const session = next.sessions.find(s => s.id === branch.sessionId);
      branch.entries.push(message(branch, action.text, 'assistant', session));
      delete branch.awaiting; break;
    }
    case 'delete': {
      const impact = deletionImpact(next, action.kind, action.targetId);
      next.branches = next.branches.filter(b => !impact.removed.some(r => r.id === b.id));
      if (action.kind === 'session') {
        const session = next.sessions.find(s => s.id === action.targetId);
        const children = next.branches.filter(b => b.sessionId === session.id);
        next.sessions = next.sessions.filter(s => s.id !== session.id);
        if (children.length) {
          const rescued = { id: id(), title: `${session.title} · 保留的独立分支` };
          next.sessions.push(rescued); children.forEach(b => { b.sessionId = rescued.id; });
        }
      }
      if (!next.branches.some(b => b.id === next.active)) next.active = next.branches[0]?.id ?? null;
      break;
    }
    default: throw new Error('未知操作。');
  }
  return next;
}
export function validateState(state) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const str = x => typeof x === 'string';
  const nonempty = x => str(x) && x.length > 0;
  const safeId = x => str(x) && /^[A-Za-z0-9_-]{1,128}$/.test(x);
  const unique = list => new Set(list).size === list.length;
  requireValue(object(state) && state.version === 1 && Array.isArray(state.sessions) && Array.isArray(state.branches), '存储格式不受支持。');
  requireValue(state.sessions.every(s => object(s) && safeId(s.id) && nonempty(s.title)) && unique(state.sessions.map(s => s.id)), '会话数据损坏。');
  requireValue(state.branches.every(b => object(b) && safeId(b.id) && nonempty(b.title) && state.sessions.some(s => s.id === b.sessionId)
    && str(b.draft) && typeof b.kept === 'boolean' && (b.parent === null || (object(b.parent) && safeId(b.parent.branchId) && safeId(b.parent.entryId) && str(b.parent.branchTitle)))
    && Array.isArray(b.entries) && unique(b.entries.map(e => e?.id)) && b.entries.every(e => object(e) && safeId(e.id) && ['message', 'reference'].includes(e.kind)
      && ['user', 'assistant'].includes(e.role) && str(e.text) && typeof e.inherited === 'boolean' && typeof e.simulated === 'boolean'
      && str(e.createdAt) && Number.isFinite(Date.parse(e.createdAt)) && object(e.source)
      && ['sessionId', 'sessionTitle', 'branchId', 'branchTitle', 'messageId'].every(k => nonempty(e.source[k]))
      && ['sessionId', 'branchId', 'messageId'].every(k => safeId(e.source[k]))
      && (e.kind !== 'message' || e.inherited || (e.source.branchId === b.id && e.source.messageId === e.id)))
    && unique(b.entries.map(e => sourceKey(e.source)))), '分支或快照数据损坏。');
  requireValue(unique(state.branches.map(b => b.id)) && (state.active === null ? state.branches.length === 0 : state.branches.some(b => b.id === state.active)), '当前分支数据损坏。');
  for (const b of state.branches) {
    requireValue((b.tags === undefined || (Array.isArray(b.tags) && b.tags.every(str))) && (b.method === undefined || b.method === 'local-rules-v1')
      && (b.pendingPrompt === undefined || nonempty(b.pendingPrompt))
      && (b.awaiting === undefined || (b.awaiting === true && b.entries.at(-1)?.role === 'user' && !b.pendingPrompt))
      && (b.metadataDone === undefined || typeof b.metadataDone === 'boolean'), '主题元数据损坏。');
    if (b.selection !== undefined) {
      const s = b.selection;
      requireValue(object(s) && nonempty(s.entryId) && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && str(s.text) && s.text.length === s.end - s.start && b.parent?.entryId === s.entryId, '选区数据损坏。');
    }
    for (const e of b.entries) if (e.range !== undefined) requireValue(object(e.range) && Number.isInteger(e.range.start) && Number.isInteger(e.range.end) && e.range.start >= 0 && e.range.end > e.range.start && e.range.end - e.range.start === e.text.length, '快照范围损坏。');
    const seen = new Set([b.id]); let parent = b.parent;
    while (parent) {
      requireValue(!seen.has(parent.branchId), '分支来源关系损坏。'); seen.add(parent.branchId);
      parent = state.branches.find(x => x.id === parent.branchId)?.parent;
    }
  }
  return state;
}
export function loadStorage(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return { state: raw === null ? emptyState() : validateState(JSON.parse(raw)), error: null };
  } catch (error) { return { state: emptyState(), error: `无法读取本地记录：${error.message} 当前为临时工作区，原记录尚未覆盖。` }; }
}
export function saveStorage(storage, state) {
  try { validateState(state); storage.setItem(STORAGE_KEY, JSON.stringify(state)); return { ok: true }; }
  catch (error) { return { ok: false, error: `未保存：${error.message}。当前内容仍在内存中，请重试。` }; }
}
