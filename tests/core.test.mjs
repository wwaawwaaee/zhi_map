import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, transition as reduce, branchOf, forkPreview, selectionPreview, referencePreview, referenceCandidates, deletionImpact, sourceAvailable, validateState, loadStorage, saveStorage, STORAGE_KEY } from '../public/core.mjs';
import { normalizeTags, suggestMetadata, matchTopics, historyIntent } from '../public/provider.mjs';
import { discussionInput } from '../public/core.mjs';

// Explicit completion fixture for the original 18 snapshot/isolation contracts.
// Production send never generates an answer; the async boundary is tested below.
function transition(state, action) {
  let next = reduce(state, action);
  for (const b of next.branches.filter(b => b.awaiting)) next = reduce(next, { type: 'answer', branchId: b.id, text: `测试上游返回的正文。${b.selection?.text || ''}` });
  return next;
}

const fixture = () => {
  const state = seedState();
  state.branches[0].entries[1].text = state.branches[0].entries[1].text.replace('平方项总是非负。', '平方项总是非负。平方项总是非负。');
  return { state, parent: state.branches[0].id, other: state.branches[1].id, cut: state.branches[0].entries[1].id };
};
test('分叉截点含该消息；后来加入的引用与消息不继承；预览与结果一致', () => {
  let { state, parent, other, cut } = fixture();
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [branchOf(state, other).entries[0].id] });
  const original = structuredClone(state);
  const preview = forkPreview(state, parent, cut);
  const forked = transition(state, { type: 'fork', entryId: cut });
  assert.equal(branchOf(forked).entries.length, 2);
  assert.deepEqual(branchOf(forked).entries.map(e => e.text), preview.map(e => e.text));
  assert.ok(branchOf(forked).entries.every(e => e.inherited));
  assert.deepEqual(branchOf(forked, parent), branchOf(original, parent));
  assert.deepEqual(state, original);
  assert.throws(() => transition(state, { type: 'fork', entryId: 'missing' }), /截点/);
});
test('子分支、父分支与兄弟分支相互隔离；此前引用按位置继承', () => {
  let { state, parent, other, cut } = fixture();
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [branchOf(state, other).entries[0].id] });
  state = transition(state, { type: 'send', text: '新截点' });
  const last = branchOf(state).entries.at(-1).id;
  state = transition(state, { type: 'fork', entryId: last });
  const child = state.active;
  assert.equal(branchOf(state).entries[4].kind, 'reference');
  assert.equal(branchOf(state).entries[4].inherited, true);
  state = transition(state, { type: 'fork', branchId: parent, entryId: cut });
  const sibling = state.active;
  state = transition(state, { type: 'send', branchId: child, text: '仅子分支可见 D' });
  for (const branchId of [parent, sibling]) assert.ok(!branchOf(state, branchId).entries.some(e => e.text === '仅子分支可见 D'));
  assert.equal(branchOf(state, child).entries.at(-2).text, '仅子分支可见 D');
  validateState(state);
});
test('引用按来源顺序、批次顺序加入；去重按来源；追加不改变快照', () => {
  let { state, other } = fixture();
  const source = branchOf(state, other), [a, b, c] = source.entries;
  const selected = [b.id, a.id];
  assert.deepEqual(referencePreview(state, state.active, other, selected).map(e => e.id), [a.id, b.id]);
  const beforePreview = structuredClone(state);
  referenceCandidates(state, state.active, other);
  assert.deepEqual(state, beforePreview);
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: selected });
  const snapshot = structuredClone(branchOf(state).entries.slice(-2));
  assert.deepEqual(snapshot.map(e => e.text), [a.text, b.text]);
  assert.equal(snapshot[0].source.messageId, a.id);
  assert.ok(snapshot[0].createdAt);
  assert.throws(() => transition(state, { type: 'reference', sourceId: other, selectedIds: [a.id] }), /重复/);
  state = transition(state, { type: 'send', branchId: other, text: '来源新增' });
  assert.deepEqual(branchOf(state).entries.slice(-2), snapshot);
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [c.id] });
  assert.deepEqual(branchOf(state).entries.slice(-3).map(e => e.source.messageId), [a.id, b.id, c.id]);
  assert.throws(() => referencePreview(state, state.active, other, []), /至少/);
  assert.throws(() => referencePreview(state, state.active, other, ['stale']), /失效/);
});
test('相同文本不同来源可以引用，继承原消息不可重复引用；引用不递归', () => {
  let { state, parent, other } = fixture();
  const originalMessage = branchOf(state, parent).entries[0];
  state = transition(state, { type: 'send', branchId: other, text: originalMessage.text });
  const identical = branchOf(state, other).entries.at(-2);
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [identical.id] });
  assert.equal(branchOf(state).entries.at(-1).text, originalMessage.text);
  state = transition(state, { type: 'reference', branchId: other, sourceId: parent, selectedIds: [originalMessage.id] });
  const sourceReference = branchOf(state, other).entries.at(-1);
  assert.ok(!referenceCandidates(state, parent, other).some(e => e.id === sourceReference.id));
  assert.throws(() => referencePreview(state, parent, other, [sourceReference.id]), /失效/);
  state = transition(state, { type: 'fork', branchId: parent, entryId: originalMessage.id });
  const child = state.active;
  // Move child to a different session to model retained independent branches after session deletion.
  branchOf(state, child).sessionId = branchOf(state, other).sessionId;
  assert.ok(referenceCandidates(state, child, parent)[0].duplicate);
});
test('删除保护与恢复：子分支、外部快照、草稿保留；来源状态派生且可恢复', () => {
  let { state, parent, other, cut } = fixture();
  state = transition(state, { type: 'draft', text: '未发送草稿' });
  state = transition(state, { type: 'fork', entryId: cut });
  const child = state.active;
  const source = branchOf(state, parent).entries[0];
  state = transition(state, { type: 'reference', branchId: other, sourceId: parent, selectedIds: [source.id] });
  const before = structuredClone(state);
  const impact = deletionImpact(state, 'branch', parent);
  assert.equal(impact.children.length, 1); assert.equal(impact.references, 1); assert.equal(impact.drafts, 1);
  assert.deepEqual(state, before, '预览/取消不能修改状态');
  const deleted = transition(state, { type: 'delete', kind: 'branch', targetId: parent });
  assert.deepEqual(branchOf(deleted, child), branchOf(before, child));
  assert.equal(branchOf(deleted, other).entries.at(-1).text, source.text);
  assert.equal(sourceAvailable(deleted, source.source), false);
  const restored = structuredClone(before);
  assert.equal(sourceAvailable(restored, source.source), true);
  assert.equal(branchOf(restored, parent).draft, '未发送草稿');
  validateState(deleted); validateState(restored);
});
test('删除会话只移除主线与容器，独立子分支移至保留会话', () => {
  let { state, parent, cut } = fixture();
  state = transition(state, { type: 'fork', entryId: cut });
  const child = state.active, sessionId = branchOf(state, parent).sessionId;
  const entries = structuredClone(branchOf(state).entries);
  state = transition(state, { type: 'delete', kind: 'session', targetId: sessionId });
  assert.ok(!state.sessions.some(s => s.id === sessionId));
  assert.ok(!state.branches.some(b => b.id === parent));
  assert.deepEqual(branchOf(state, child).entries, entries);
  assert.notEqual(branchOf(state, child).sessionId, sessionId);
  assert.equal(sourceAvailable(state, entries[0].source), false);
  validateState(state);
});
test('移除继承引用只影响当前分支，恢复快照能撤销', () => {
  let { state, parent, other } = fixture();
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [branchOf(state, other).entries[0].id] });
  state = transition(state, { type: 'send', text: '包含引用的截点' });
  state = transition(state, { type: 'fork', entryId: branchOf(state).entries.at(-1).id });
  const before = structuredClone(state), ref = branchOf(state).entries.find(e => e.kind === 'reference');
  state = transition(state, { type: 'removeReference', entryId: ref.id });
  assert.ok(!branchOf(state).entries.some(e => e.id === ref.id));
  assert.deepEqual(branchOf(state, parent), branchOf(before, parent));
  assert.deepEqual(branchOf(state, other), branchOf(before, other));
  state = before; assert.ok(branchOf(state).entries.some(e => e.id === ref.id));
});
test('持久化往返保留顺序、草稿、来源删除状态；malformed 不覆盖原记录', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  let { state, other } = fixture();
  state = transition(state, { type: 'reference', sourceId: other, selectedIds: [branchOf(state, other).entries[0].id] });
  state = transition(state, { type: 'draft', text: '跨刷新草稿' });
  state = transition(state, { type: 'delete', kind: 'branch', targetId: other });
  assert.equal(saveStorage(storage, state).ok, true);
  assert.deepEqual(loadStorage(storage).state, state);
  for (const malformed of ['{', 'null', '{}', '{"version":99}', JSON.stringify({ ...state, active: 'missing' }), JSON.stringify({ ...state, branches: [null] })]) {
    storage.setItem(STORAGE_KEY, malformed);
    const result = loadStorage(storage);
    assert.ok(result.error); validateState(result.state);
    assert.equal(storage.getItem(STORAGE_KEY), malformed);
  }
  const corrupt = structuredClone(state); corrupt.branches[0].entries[0].text = 123;
  storage.setItem(STORAGE_KEY, JSON.stringify(corrupt)); assert.ok(loadStorage(storage).error);
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.ok(loadStorage(unavailable).error);
  const original = structuredClone(state); assert.equal(saveStorage(unavailable, state).ok, false); assert.deepEqual(state, original);
});
test('空会话、重命名、保留、切换草稿；显式上游完成', () => {
  let state = transition(seedState(), { type: 'create', title: '测试' });
  const target = state.active;
  assert.equal(branchOf(state).entries.length, 0);
  assert.throws(() => transition(state, { type: 'fork', entryId: 'nope' }), /截点/);
  state = transition(state, { type: 'draft', text: '我的问题' });
  state = transition(state, { type: 'switch', branchId: state.branches[0].id });
  assert.equal(branchOf(state, target).draft, '我的问题');
  state = transition(state, { type: 'switch', branchId: target });
  state = transition(state, { type: 'keep' }); assert.equal(branchOf(state).kept, true);
  state = transition(state, { type: 'rename', kind: 'branch', targetId: target, title: '新名' });
  assert.equal(branchOf(state).title, '新名');
  const response1 = transition(state, { type: 'send' });
  const response2 = transition(state, { type: 'send' });
  assert.equal(branchOf(response1).entries.at(-1).text, branchOf(response2).entries.at(-1).text);
  assert.match(branchOf(response1).entries.at(-1).text, /测试上游返回/);
  assert.equal(branchOf(response1).entries.at(-1).simulated, false);
  assert.equal(branchOf(response1).draft, ''); validateState(response1);
});

function expandFixture(prompt = '解释这里的配方法与完全平方', context = 'all') {
  const { state, parent, cut, other } = fixture();
  const entry = branchOf(state).entries[1];
  // Deliberately locate the SECOND occurrence in test data; production never searches text.
  const start = entry.text.lastIndexOf('平方项总是非负。'), end = start + '平方项总是非负。'.length;
  const selection = { entryId: cut, start, end, text: entry.text.slice(start, end) };
  const preview = selectionPreview(state, parent, selection);
  const contextIds = context === 'all' ? preview.map(e => e.id) : context === 'none' ? [] : [cut];
  return { original: state, state: transition(state, { type: 'expand', selection, contextIds, prompt }), parent, other, selection, preview };
}
test('部分选区以前缀截断，重复文本保留真实 offset，父子隔离', () => {
  const { original, state, parent, selection, preview } = expandFixture();
  const b = branchOf(state), text = branchOf(original).entries[1].text;
  assert.equal(preview.at(-1).text, text.slice(0, selection.end));
  assert.ok(selection.start > text.indexOf(selection.text));
  assert.deepEqual(b.selection, selection);
  assert.equal(b.entries[1].text, text.slice(0, selection.end));
  assert.ok(!b.entries.filter(e => e.inherited).some(e => /从图像理解|后续消息/.test(e.text)));
  assert.deepEqual(branchOf(state, parent), branchOf(original, parent));
  const changed = transition(state, { type: 'send', branchId: parent, text: '父分支后续' });
  assert.deepEqual(branchOf(changed, b.id), b);
  assert.throws(() => selectionPreview(original, parent, { ...selection, end: text.length + 1 }), /选区/);
  assert.throws(() => selectionPreview(original, parent, { ...selection, text: '错误片段' }), /选区/);
  validateState(state);
});
test('去勾上下文精确生效，全部去勾仍有独立问题和返回锚点', () => {
  const { state, selection } = expandFixture(undefined, 'cut');
  const b = branchOf(state);
  assert.equal(b.entries.filter(e => e.inherited).length, 1);
  assert.equal(b.entries[0].text, b.entries[0].text.slice(0, selection.end));
  const empty = branchOf(expandFixture(undefined, 'none').state);
  assert.equal(empty.entries.length, 2); assert.ok(empty.selection);
  assert.equal(empty.entries[0].role, 'user');
});
test('主题自动规则、别名归一和已有大小写标签复用；标签不导入上下文', () => {
  assert.deepEqual(normalizeTags([' 数学 ', 'Ｍａｔｈ', 'math'], ['Math']), ['数学', 'Math']);
  assert.deepEqual(normalizeTags(['Custom', 'CUSTOM']), ['Custom']);
  assert.deepEqual(suggestMetadata('完全平方', '解释顶点').tags, ['二次函数', '配方法']);
  const { state } = expandFixture();
  const before = structuredClone(branchOf(state).entries);
  const edited = transition(state, { type: 'metadata', title: '自定义主题', tags: ['配方法', '配方法', '二次函数'] });
  assert.equal(branchOf(edited).title, '自定义主题');
  assert.deepEqual(branchOf(edited).tags, ['配方法', '二次函数']);
  assert.deepEqual(branchOf(edited).entries, before);
});
test('普通问题显式完成；候选与全文预览不泄露，确认仅导入选择范围', () => {
  const { state, other } = expandFixture();
  const before = structuredClone(state), b = branchOf(state);
  assert.equal(b.entries.at(-1).role, 'assistant');
  assert.ok(matchTopics(state.branches, b).some(c => c.id === other));
  const entry = referenceCandidates(state, b.id, other)[1];
  const ranges = { [entry.id]: { start: 4, end: 25 } };
  const preview = referencePreview(state, b.id, other, [entry.id], ranges);
  assert.equal(preview[0].text, entry.text.slice(4, 25));
  assert.deepEqual(state, before);
  assert.ok(!b.entries.some(e => e.source.branchId === other));
  const imported = transition(state, { type: 'reference', sourceId: other, selectedIds: [entry.id], ranges });
  assert.equal(branchOf(imported).entries.length, b.entries.length + 1);
  assert.equal(branchOf(imported).entries.at(-1).text, entry.text.slice(4, 25));
  assert.deepEqual(branchOf(imported).entries.at(-1).range, ranges[entry.id]);
  assert.throws(() => referencePreview(state, b.id, other, [entry.id], { [entry.id]: { start: 30, end: 1 } }), /范围/);
  validateState(imported);
});
test('明确历史意图门禁：取消/无选择不能回复，引用确认或明确跳过才继续', () => {
  const { state, other } = expandFixture('结合我以前聊过的 decoding top-k 解释这里');
  const b = branchOf(state), before = structuredClone(state);
  assert.ok(b.pendingPrompt); assert.ok(b.entries.every(e => e.inherited));
  assert.throws(() => transition(state, { type: 'send', text: '偷跑' }), /先确认/);
  assert.throws(() => transition(state, { type: 'resolveHistory', decision: 'reference', sourceId: other, selectedIds: [] }), /至少/);
  assert.deepEqual(state, before);
  const skipped = transition(state, { type: 'resolveHistory', decision: 'skip' });
  assert.ok(!branchOf(skipped).pendingPrompt); assert.equal(branchOf(skipped).entries.at(-1).role, 'assistant');
  assert.ok(!branchOf(skipped).entries.some(e => e.source.branchId === other));
  const selected = branchOf(state, other).entries[1];
  const confirmed = transition(state, { type: 'resolveHistory', decision: 'reference', sourceId: other, selectedIds: [selected.id] });
  assert.equal(branchOf(confirmed).entries.at(-3).text, selected.text);
  assert.equal(branchOf(confirmed).entries.at(-2).text, b.pendingPrompt);
  assert.equal(branchOf(confirmed).entries.filter(e => e.source.branchId === other).length, 1);
  const followup = transition(skipped, { type: 'send', text: '参考之前聊过的 HC', historyDecision: 'reference' });
  assert.ok(branchOf(followup).pendingPrompt, '外部 flag 不能绕过确认');
  assert.ok(historyIntent('结合我之前的讨论')); assert.ok(!historyIntent('解释 router'));
});
test('新增可选 schema 兼容旧 v1；选区和 pending 跨刷新，损坏字段不覆盖', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  const legacy = seedState(); legacy.branches.forEach(b => { delete b.tags; });
  assert.ok(saveStorage(storage, legacy).ok); assert.deepEqual(loadStorage(storage).state, legacy);
  const { state } = expandFixture('结合我之前聊过的 top-k');
  assert.ok(saveStorage(storage, state).ok); assert.deepEqual(loadStorage(storage).state, state);
  for (const corrupt of [{ tags: 'MoE' }, { pendingPrompt: 42 }, { selection: { start: 0 } }]) {
    const bad = structuredClone(state); Object.assign(branchOf(bad), corrupt);
    const raw = JSON.stringify(bad); storage.setItem(STORAGE_KEY, raw);
    assert.ok(loadStorage(storage).error); assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});
test('全取消背景的发送对象保留精确选区，label 不成为输入；删除来源及刷新仍可解释', () => {
  let { state, parent, selection } = expandFixture('解释这里', 'none');
  assert.ok(branchOf(state).entries.at(-1).text.includes(selection.text));
  state = transition(state, { type: 'metadata', title: '不应发送的标题', tags: ['不应发送的标签'] });
  state = transition(state, { type: 'delete', kind: 'branch', targetId: parent });
  state = validateState(JSON.parse(JSON.stringify(state)));
  const input = discussionInput(state, state.active, '进一步解释');
  assert.deepEqual(input.anchor, selection);
  assert.equal(input.context.filter(e => e.inherited).length, 0);
  assert.ok(!JSON.stringify(input).includes('不应发送'));
  input.anchor.text = '外部修改'; input.context.length = 0;
  assert.deepEqual(branchOf(state).selection, selection);
  assert.equal(branchOf(state).entries.length, 2);
});
test('历史门禁约束目标分支的直接引用，确认只加入范围；其他分支仍可发送', () => {
  const { state, other } = expandFixture('结合以前聊过的 decoding', 'none');
  const b = branchOf(state), source = branchOf(state, other).entries[1];
  const action = { branchId: b.id, sourceId: other, selectedIds: [source.id], ranges: { [source.id]: { start: 4, end: 25 } } };
  assert.throws(() => transition(state, { ...action, type: 'reference' }), /历史确认/);
  const switched = transition(state, { type: 'switch', branchId: other });
  assert.throws(() => transition(switched, { type: 'send', branchId: b.id, text: '绕过' }), /先确认/);
  assert.equal(branchOf(transition(switched, { type: 'send', text: '其他问题' })).entries.at(-2).text, '其他问题');
  const resolved = transition(switched, { ...action, type: 'resolveHistory', decision: 'reference' });
  assert.equal(branchOf(resolved, b.id).entries[0].text, source.text.slice(4, 25));
  assert.equal(branchOf(resolved, b.id).entries.length, 3);
  assert.ok(!branchOf(resolved, b.id).pendingPrompt);
  assert.equal(branchOf(resolved, other).entries.length, branchOf(state, other).entries.length);
});
test('等待的新问题参与候选匹配；继承部分消息再引用仍追溯原始范围并去重', () => {
  let { state, parent, other, cut } = fixture();
  state = transition(state, { type: 'create', title: '空主题' });
  const target = state.active;
  state = transition(state, { type: 'send', text: '结合之前聊过的完全平方公式' });
  assert.ok(matchTopics(state.branches, branchOf(state)).some(c => c.id === other));
  state = transition(state, { type: 'resolveHistory', decision: 'skip' });
  const text = branchOf(state, parent).entries[1].text;
  state = transition(state, { type: 'expand', branchId: parent, selection: { entryId: cut, start: 3, end: 50, text: text.slice(3, 50) }, contextIds: [cut], prompt: '解释' });
  const child = state.active, inherited = branchOf(state).entries[0];
  state = transition(state, { type: 'reference', branchId: target, sourceId: child, selectedIds: [inherited.id], ranges: { [inherited.id]: { start: 5, end: 20 } } });
  const ref = branchOf(state, target).entries.at(-1);
  assert.deepEqual(ref.range, { start: 5, end: 20 });
  assert.equal(ref.source.messageId, cut); assert.equal(ref.text, text.slice(5, 20));
  assert.ok(referenceCandidates(state, target, parent).find(e => e.id === cut).duplicate);
  validateState(state);
});

test('真实发送只保存问题；重复发送被拒绝，回答失败/刷新后可重试', () => {
  let state = reduce(seedState(), { type:'send', text:'为什么顶点是最低点？' });
  const b = branchOf(state);
  assert.equal(b.entries.at(-1).role, 'user'); assert.equal(b.awaiting, true);
  assert.throws(() => reduce(state, { type:'send', text:'重复' }), /尚未回答/);
  assert.throws(() => reduce(state, { type:'answer', text:'' }), /正文/);
  state = validateState(JSON.parse(JSON.stringify(state)));
  state = reduce(state, { type:'answer', text:'因为平方项非负，且二次项系数大于零。' });
  assert.equal(branchOf(state).awaiting, undefined);
  assert.equal(branchOf(state).entries.at(-1).simulated, false);
  assert.throws(() => reduce(state, { type:'answer', text:'迟到的重复响应' }), /没有等待/);
});
test('等待期间不能改变已提交的引用上下文', () => {
  let { state, other } = fixture();
  state = reduce(state, { type:'reference', sourceId:other, selectedIds:[branchOf(state, other).entries[0].id] });
  const referenceId = branchOf(state).entries.at(-1).id;
  state = reduce(state, { type:'send', text:'解释' });
  assert.throws(() => reduce(state, { type:'removeReference', entryId:referenceId }), /结束等待/);
  assert.throws(() => reduce(state, { type:'reference', sourceId:other, selectedIds:[branchOf(state, other).entries[1].id] }), /结束等待/);
  validateState(state);
});

test('导入拒绝可注入 DOM 属性的标识符及损坏的请求状态', () => {
  for (const mutate of [s => { s.sessions[0].id = 'x" onclick="bad'; }, s => { s.branches[0].entries[0].source.branchId = '<script>'; }, s => { s.branches[0].awaiting = true; }]) {
    const state = seedState(); mutate(state); assert.throws(() => validateState(state), /损坏/);
  }
});
