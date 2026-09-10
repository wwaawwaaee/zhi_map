import { branchOf, emptyState, seedState, transition, validateState, selectionPreview, referenceCandidates, referencePreview, deletionImpact, sourceAvailable, loadStorage, saveStorage } from './core.mjs';
import { matchTopics, normalizeTags } from './provider.mjs';
import { readSelection, restoreSelection } from './selection.mjs';
import { renderMarkdown, escapeHTML as esc } from './render.mjs';

const $ = s => document.querySelector(s);
let storage;
try { storage = localStorage; } catch { storage = { getItem() { throw Error('存储不可用'); }, setItem() { throw Error('存储不可用'); } }; }
const loaded = loadStorage(storage);
let state = loaded.state, blocked = Boolean(loaded.error), undo = null, picked = null, filter = '', connection = { configured: false }, opener, noticeTimer;
const running = new Map(), naming = new Map(), failures = new Map();
let modalController = new AbortController();
function cancelNaming(ids = [...naming.keys()]) {
  for (const id of ids) { naming.get(id)?.abort(); naming.delete(id); }
}
function notify(text) { $('#notice').textContent = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 6500); }
function persist() {
  const result = blocked ? { ok: false, error: loaded.error || '原记录未覆盖，请导出当前工作后到设置中恢复保存。' } : saveStorage(storage, state);
  $('#storage-status').textContent = result.ok ? '已保存 · 仅此浏览器' : result.error;
  $('#retry').hidden = result.ok;
}
function dispatch(action, reversible = false, paint = true) {
  const next = transition(state, action);
  if (action.type === 'metadata' && !action.automatic) {
    cancelNaming([action.branchId ?? state.active]);
    branchOf(next, action.branchId ?? state.active).metadataDone = true;
  }
  if (!['switch'].includes(action.type)) undo = reversible ? structuredClone(state) : null;
  state = next; persist(); $('#undo-bar').hidden = !undo;
  if (paint) { if (action.branchId && action.branchId !== state.active) tree(); else render(); }
  return true;
}
function close() { $('#modal').close(); }
function modal(title, body, actions = [], focus = null) {
  modalController.abort(); modalController = new AbortController(); const signal = modalController.signal;
  if (!$('#modal').open) opener = document.activeElement;
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = body; $('#modal-error').textContent = '';
  $('#modal-actions').replaceChildren();
  for (const action of actions) {
    const b = document.createElement('button'); b.textContent = action.label; b.className = action.danger ? 'danger' : 'primary'; b.id = action.id || 'modal-confirm'; b.disabled = Boolean(action.disabled);
    b.onclick = async () => { try { await action.run(); } catch (e) { if (!signal.aborted) $('#modal-error').textContent = e.message; } };
    $('#modal-actions').append(b);
  }
  if (!$('#modal').open) $('#modal').showModal();
  (focus ? $(focus) : $('#close-modal'))?.focus();
}
$('#modal').addEventListener('close', () => { modalController.abort(); if (opener?.isConnected && opener.getClientRects().length && !opener.disabled) opener.focus(); else (state.active ? $('#draft') : $('#create')).focus(); });
$('#close-modal').onclick = close;
function tree() {
  const tags = normalizeTags(state.branches.flatMap(b => b.tags || []));
  $('#tag-filter').innerHTML = `<option value="">所有标签</option>${tags.map(t => `<option>${esc(t)}</option>`).join('')}`; $('#tag-filter').value = filter;
  $('#tree').innerHTML = state.branches.filter(b => !filter || b.tags?.includes(filter)).map(b => `<button class="branch-button ${state.active === b.id ? 'active' : ''}" data-switch="${b.id}" ${state.active === b.id ? 'aria-current="page"' : ''}><span class="branch-icon">${b.parent ? '↳' : '◌'}</span><span>${esc(b.title)}<small>${b.kept ? '已收藏 · ' : ''}${b.parent ? '独立展开' : '主题'} · ${b.entries.filter(e => !e.inherited).length} 条</small></span></button>`).join('') || '<p class="help">你的问题，将在这里长成路径。</p>';
}
function sourceHTML(e) {
  return `<div class="source-label">${e.kind === 'reference' ? '引用' : '继承'}自 ${esc(e.source.branchTitle)}${e.range ? ` · [${e.range.start}, ${e.range.end})` : ''} ${sourceAvailable(state, e.source) ? `<button data-jump="${e.source.branchId}" data-message="${e.source.messageId}" ${e.range ? `data-start="${e.range.start}" data-end="${e.range.end}"` : ''}>返回来源 ↗</button>` : '<span>来源已删除 · 快照保留</span>'}${e.kind === 'reference' ? `<button data-remove="${e.id}">移除引用</button>` : ''}</div>`;
}
function article(e) {
  return `<article class="message ${e.role} ${e.kind} ${e.inherited ? 'inherited' : ''}" id="entry-${e.id}" data-kind="${e.kind}"><div class="message-head"><strong>${e.role === 'user' ? '你' : '知径'}</strong><span>${e.simulated ? '人工编写的示例 · 非模型回答' : e.kind === 'reference' ? '已确认的引用' : ''}</span></div><div class="message-text"></div>${e.inherited || e.kind === 'reference' ? sourceHTML(e) : ''}${e.kind === 'message' ? `<div class="message-tools"><button data-raw="${e.id}">选择原文</button><button data-fork="${e.id}">整条展开 ↗</button></div>` : ''}</article>`;
}
function renderHeader(b) {
  $('#chat-header').innerHTML = `<div class="eyebrow">${b.parent ? '独立讨论' : '学习主题'}${b.kept ? ' · 已收藏' : ''}</div><h1>${esc(b.title)}</h1><div class="header-meta">${b.parent ? `<button data-return>← 返回原文</button><span>来自 ${esc(b.parent.branchTitle)}</span>` : '<span>选中疑惑片段，即可展开讨论</span>'}${(b.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
}
function render() {
  tree(); picked = null; $('#expand-selection').hidden = true; $('#undo-bar').hidden = !undo;
  const b = state.active ? branchOf(state) : null;
  $('#composer').hidden = !b; $('#context-button').disabled = !b; $('#related-button').disabled = !b; $('#manage-button').disabled = !b;
  $('#history-gate').hidden = !b?.pendingPrompt;
  $('#request-status').hidden = !b?.awaiting;
  if (!b) {
    $('#chat-header').innerHTML = '<span class="eyebrow">一点好奇，一条新路径</span>';
    $('#messages').innerHTML = `<div class="welcome"><div class="welcome-mark">↗</div><h1>把不懂的地方，<br>变成下一步。</h1><p>读到疑惑，选中它。带着恰好的背景，<br>展开一条属于你的学习路径。</p><button class="primary" data-new>开始一个问题</button><button class="sample-card" data-example><span>高中数学 · 交互示例</span><strong>从配方法，看见二次函数的顶点 ↗</strong><small>含一段完全平方公式的旧讨论 · 人工编写</small></button><p class="help">记录只保存在此浏览器。接入模型后可真实对话。</p></div>`; return;
  }
  renderHeader(b);
  const inherited = b.entries.filter(e => e.inherited), own = b.entries.filter(e => !e.inherited);
  $('#messages').innerHTML = `${b.selection ? `<details class="anchor"><summary>正在解释的原文 · ${b.selection.text.length} 字符</summary><p class="full-text">${esc(b.selection.text)}</p></details>` : ''}${inherited.length ? `<details class="inherited-background"><summary>继承背景 · ${inherited.length} 条</summary>${inherited.map(article).join('')}</details>` : ''}${own.map(article).join('') || '<div class="empty"><h2>这条思路，从你开始。</h2><p>写下问题，或从相关主题引用必要的前提。</p></div>'}`;
  for (const e of b.entries) {
    const body = document.getElementById(`entry-${e.id}`).querySelector('.message-text'); body.dataset.source = e.text; body.innerHTML = renderMarkdown(e.text);
  }
  $('#draft').value = b.draft;
  $('#draft').disabled = Boolean(b.pendingPrompt);
  $('#send').disabled = Boolean(b.pendingPrompt || b.awaiting);
  $('#history-gate').innerHTML = b.pendingPrompt ? `<strong>这次想参考哪段旧讨论？</strong><p>${esc(b.pendingPrompt)}</p><button data-open-reference>选择并确认引用</button><button data-skip-history>不新增引用，继续</button>` : '';
  const busy = running.has(b.id);
  $('#request-status').innerHTML = b.awaiting ? `<span role="status">${busy ? '正在思考，请稍候…' : esc(failures.get(b.id) || '问题已保存，尚未收到回答。')}</span><div>${busy ? '<button data-cancel>停止生成</button>' : '<button data-retry-answer>重试回答</button><button data-edit-question>返回草稿编辑</button>'}</div>` : '';
}
async function api(kind, input, signal) {
  const response = await fetch(`/api/${kind}`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(input), signal });
  const data = await response.json(); if (!response.ok) throw Error(data.error || '请求失败'); return data;
}
async function refreshStatus() {
  try { connection = await (await fetch('/api/status')).json(); $('#connection').textContent = connection.configured ? `${connection.model} · 已配置` : '离线浏览'; }
  catch { $('#connection').textContent = '服务器未连接'; }
}
async function generate(id = state.active) {
  const b = branchOf(state, id); if (!b.awaiting || running.has(id)) return;
  const question = b.entries.at(-1); if (question.role !== 'user') return;
  const controller = new AbortController(); running.set(id, controller); failures.delete(id); if (state.active === id) render();
  const input = { prompt: question.text, anchor: b.selection ? { text: b.selection.text } : null, context: b.entries.slice(0, -1).map(e => ({ role: e.role, text: e.text })) };
  try {
    const { answer } = await api('chat', input, controller.signal);
    if (!state.branches.some(x => x.id === id && x.awaiting && x.entries.at(-1)?.id === question.id) || controller.signal.aborted) return;
    dispatch({ type: 'answer', branchId: id, text: answer });
    // One light call per new discussion, explicitly limited to the first question and answer.
    const current = branchOf(state, id);
    if (!current.metadataDone) {
      current.metadataDone = true; persist();
      void generateMetadata(id, question.text, answer);
    }
  } catch (error) { failures.set(id, controller.signal.aborted ? '已停止生成。问题已保留，可以重试或返回草稿。' : error.message); }
  finally { if (running.get(id) === controller) { running.delete(id); if (state.active === id) render(); } }
}
async function generateMetadata(id, prompt, answer) {
  const controller = new AbortController(); naming.set(id, controller);
  try {
    const meta = await api('metadata', { prompt: prompt.slice(0, 12000), answer: answer.slice(0, 40000), labels: normalizeTags(state.branches.flatMap(x => x.tags || []).map(t => t.slice(0, 80))).slice(0, 100) }, controller.signal);
    if (controller.signal.aborted || naming.get(id) !== controller || !state.branches.some(b => b.id === id)) return;
    dispatch({ type: 'metadata', branchId: id, title: meta.title, tags: meta.labels, automatic: true }, false, false);
    // Naming changes navigation/header only: preserve the reader's selection and composer focus.
    tree(); if (state.active === id) renderHeader(branchOf(state, id));
  } catch { if (!controller.signal.aborted) notify('回答已保存；自动命名暂不可用，可在主题管理中编辑。'); }
  finally { if (naming.get(id) === controller) naming.delete(id); }
}
function continueRequest() { if (state.active && branchOf(state).awaiting) void generate(); }
function openFork(entryId, selected) {
  const b = branchOf(state), entry = b.entries.find(e => e.id === entryId);
  const selection = selected || { entryId, start: 0, end: entry.text.length, text: entry.text };
  const preview = selectionPreview(state, b.id, selection);
  modal('沿着这一点，继续想', `<p class="help">创建独立讨论，原主题仍留在原处。</p><details class="anchor"><summary>选中的原文 · ${selection.text.length} 字符</summary><p class="full-text">${esc(selection.text)}</p><small>UTF-16 [${selection.start}, ${selection.end})</small></details><label class="field">你想弄清什么？<textarea id="fork-prompt" rows="4" placeholder="例如：为什么平方项最小是 0？"></textarea></label><details><summary>继承背景 · 默认 ${preview.length} 条，可取消勾选</summary><p class="help">只到选区末尾，不含之后内容。全部取消仍保留独立选区。</p>${preview.map(e => `<label class="preview-item"><input type="checkbox" data-context-id="${e.id}" checked><span class="full-text">${esc(e.text)}</span></label>`).join('')}</details>`, [{ label: '展开讨论', run() {
    dispatch({ type: 'expand', branchId: b.id, selection, contextIds: [...document.querySelectorAll('[data-context-id]:checked')].map(el => el.dataset.contextId), prompt: $('#fork-prompt').value }); close(); continueRequest();
  } }], '#fork-prompt');
}
function openReferences(preferred) {
  const target = branchOf(state), options = state.branches.filter(b => b.id !== target.id);
  if (!options.length) { notify('暂无其他主题，先创建一个主题即可引用。'); return; }
  let sourceId = options.some(b => b.id === preferred) ? preferred : options[0].id;
  const selected = new Set(); let ranges = {};
  modal('只带入需要的前提', `<p class="help">浏览和勾选不会改变上下文。确认后，仅所选原文作为快照加入，不递归读取来源。</p><label class="field">来源主题<select id="source-select">${options.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select></label><div id="source-candidates"></div><details><summary>核对将要加入的原文</summary><div id="selection-preview"></div></details>`, [{ label: target.pendingPrompt ? '确认引用并继续' : '确认加入引用', disabled: true, run() {
    dispatch({ type: target.pendingPrompt ? 'resolveHistory' : 'reference', decision: 'reference', branchId: target.id, sourceId, selectedIds: [...selected], ranges }); close(); continueRequest();
  } }]);
  function update() {
    try { const entries = selected.size ? referencePreview(state, target.id, sourceId, [...selected], ranges) : []; $('#modal-confirm').disabled = !entries.length; $('#selection-preview').innerHTML = entries.map(e => `<p class="full-text">${esc(e.text)}</p>`).join(''); $('#modal-error').textContent = ''; }
    catch (e) { $('#modal-error').textContent = e.message; $('#modal-confirm').disabled = true; }
  }
  function candidates() {
    $('#source-candidates').innerHTML = referenceCandidates(state, target.id, sourceId).map(e => `<div class="reference-choice" data-entry="${e.id}"><label class="preview-item"><input type="checkbox" value="${e.id}" ${e.duplicate ? 'disabled' : ''}><span><small>${e.role === 'user' ? '问题' : '回答'}${e.duplicate ? ' · 已在上下文中' : ''}</small><span class="full-text">${esc(e.text)}</span></span></label><details><summary>仅引用部分范围</summary><div class="range-fields"><label>起点<input type="number" data-range-start min="0" max="${e.text.length - 1}" value="0"></label><label>终点<input type="number" data-range-end min="1" max="${e.text.length}" value="${e.text.length}"></label></div><small>UTF-16 偏移，起点含、终点不含。确认前可核对原文。</small></details></div>`).join('');
    $('#source-candidates').oninput = event => { const el = event.target.closest('[data-entry]'); if (!el) return; const id = el.dataset.entry; if (event.target.type === 'checkbox') event.target.checked ? selected.add(id) : selected.delete(id); else ranges[id] = { start: Number(el.querySelector('[data-range-start]').value), end: Number(el.querySelector('[data-range-end]').value) }; update(); };
    update();
  }
  $('#source-select').value = sourceId; $('#source-select').onchange = e => { sourceId = e.target.value; selected.clear(); ranges = {}; candidates(); }; candidates();
}
function openContext() {
  const b = branchOf(state);
  modal('下一次回答会看到什么', `<p class="help">按当前顺序发送 ${b.entries.length} 条消息 / 引用。标题和标签仅用于整理。</p>${b.selection ? `<details><summary>独立解释对象</summary><p class="full-text">${esc(b.selection.text)}</p></details>` : ''}${b.entries.map((e, i) => `<details><summary>${i + 1} · ${e.kind === 'reference' ? '引用快照' : e.inherited ? '继承背景' : e.role === 'user' ? '问题' : '回答'} · ${esc(e.text.slice(0, 42))}</summary><p class="full-text">${esc(e.text)}</p>${sourceHTML(e)}</details>`).join('')}<button data-open-reference>＋ 引用其他主题</button>`);
}
function related() {
  const b = branchOf(state), local = matchTopics(state.branches, b).slice(0, 8);
  const candidates = local.map(c => { const source = branchOf(state, c.id); return { id: c.id, title: c.title.slice(0, 160), summary: source.entries.filter(e => !e.inherited && e.kind === 'message').map(e => e.text).join('\n').slice(0, 600) }; });
  modal('相关主题', `<p class="help">本地标签候选，不会自动加入上下文。可选择让模型对以下最多 8 个短摘要排序；只有点击确认引用，原文才进入回答背景。</p><div id="related-list">${candidates.map(c => `<button class="wide" data-related="${c.id}">${esc(c.title)}</button>`).join('') || '<p>暂无标签匹配，可手动浏览其他主题。</p>'}</div><button data-open-reference>浏览全部主题</button><p id="ranking-status" role="status"></p>`, candidates.length ? [{ label: '发送候选短摘要给模型排序', run: async () => {
    const button = $('#modal-confirm'); button.disabled = true; $('#ranking-status').textContent = '正在重排…';
    const signal = modalController.signal;
    try { const data = await api('rerank', { query: (b.pendingPrompt || b.title).slice(0, 12000), candidates }, signal); if (signal.aborted) return; $('#related-list').innerHTML = data.ids.map(id => `<button class="wide" data-related="${id}">${esc(candidates.find(c => c.id === id).title)}</button>`).join('') || '<p>模型未发现相关主题。</p>'; $('#ranking-status').textContent = '模型排序完成 · 尚未引用'; }
    finally { button.disabled = false; }
  } }] : []);
}
function manage() {
  const b = branchOf(state);
  modal('整理这个主题', `<label class="field">标题<input id="topic-title" maxlength="120" value="${esc(b.title)}"></label><label class="field">标签（逗号分隔，建议不超过 3 个）<input id="topic-tags" value="${esc((b.tags || []).join(', '))}"></label><p class="help">已有标签自动复用，标签不会导入旧讨论。</p><div class="toolbar"><button data-keep>${b.kept ? '取消收藏' : '收藏主题'}</button><button class="danger" data-delete-branch>删除主题</button><button class="danger" data-delete-session="${b.sessionId}">删除整个会话主线</button></div>`, [{ label: '保存', run() { dispatch({ type: 'metadata', title: $('#topic-title').value, tags: $('#topic-tags').value.split(/[,，]/) }); close(); } }], '#topic-title');
}
function openDelete(kind, targetId) {
  if (running.size) { notify('请先停止正在进行的请求，再删除。'); return; }
  const impact = deletionImpact(state, kind, targetId);
  modal('删除前确认', `<p>将移除 ${impact.removed.length} 个主题、${impact.messages} 条记录及 ${impact.drafts} 份草稿。</p><p>保留 ${impact.children.length} 个独立子讨论和 ${impact.snapshots.length} 份外部快照；已删除来源将无法跳转。</p><p class="help">可撤销至下一次修改或刷新。关闭即取消。</p>`, [{ label: '确认删除', danger: true, run() { cancelNaming(impact.removed.map(b => b.id)); dispatch({ type: 'delete', kind, targetId }, true); close(); } }]);
}
function settings() {
  modal('设置与数据', `<section><h3>模型连接</h3><p>${connection.configured ? `已配置：${esc(connection.model)}（实际可用性以请求结果为准）` : '离线浏览 · 尚未配置模型'}</p><p class="help">在项目根目录将 .env.example 复制为 .env，填写 AI_BASE_URL、AI_API_KEY、AI_MODEL 后重启 npm start。密钥仅由服务器读取，不会发送给浏览器。默认只监听本机。</p><button data-check>刷新配置状态</button></section><section><h3>你的学习记录</h3><p class="help">仅保存在当前浏览器。导出包含问题、回答、草稿、选区和引用；建议定期备份。</p><button data-export>导出 JSON</button><label class="file-button">导入 JSON<input id="import-file" type="file" accept="application/json,.json"></label><button data-save-retry>重试保存</button></section><section><h3>使用提示</h3><p class="help">在正文中框选文字，点击「展开讨论」。公式或复杂格式可点「选择原文」精确选择。Ctrl / ⌘ + Enter 发送，Escape 关闭抽屉。取消生成会保留问题。没有模型配置时仍可阅读、展开、引用和整理。</p></section><section><h3>清空工作区</h3><button class="danger" data-reset>清空全部本地记录…</button></section>`);
  $('#import-file').onchange = async event => {
    try { if (running.size) throw Error('请先停止正在进行的请求。'); const file = event.target.files[0]; if (!file) return; if (file.size > 10000000) throw Error('文件超过 10 MB。'); const imported = validateState(JSON.parse(await file.text())); modal('用备份替换当前工作区？', `<p>已验证：${imported.sessions.length} 个会话，${imported.branches.length} 个主题。将替换当前记录，建议先导出备份。</p>`, [{ label: '确认导入', run() { if (running.size) throw Error('请先停止正在进行的请求。'); cancelNaming(); state = imported; blocked = false; undo = null; failures.clear(); persist(); render(); close(); notify($('#retry').hidden ? '导入完成。' : '已导入内存，但尚未保存，请重试保存或导出备份。'); } }]); }
    catch (e) { $('#modal-error').textContent = `导入失败：${e.message}，原记录未改变。`; }
  };
}
function exportData() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type:'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `知径-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function recoverSave() {
  if (!blocked) { persist(); return; }
  modal('恢复本地保存', '<p>原记录无法读取。建议先保留浏览器中的原数据，再决定是否用当前工作区覆盖。关闭不会覆盖。</p>', [{ label: '确认覆盖并保存', run() { blocked = false; persist(); close(); } }]);
}
function jump(branchId, entryId, start, end) {
  if (!state.branches.some(b => b.id === branchId && b.entries.some(e => e.id === entryId))) throw Error('原文来源已删除，快照仍保留。');
  close(); dispatch({ type:'switch', branchId }); const el = document.getElementById(`entry-${entryId}`);
  if (el.closest('details')) el.closest('details').open = true;
  if (start !== undefined) restoreSelection(el.querySelector('.message-text'), Number(start), Number(end));
  el.scrollIntoView({ block:'center' }); el.tabIndex = -1; el.focus({ preventScroll:true });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return; const d = button.dataset;
  try {
    if (d.switch) { dispatch({ type:'switch', branchId:d.switch }); closeNavigation(); if (matchMedia('(max-width:760px)').matches) $('#nav-toggle').focus(); }
    else if ('new' in d) { dispatch({ type:'create', title:'新的学习问题' }); $('#draft').focus(); }
    else if ('example' in d) { const example = seedState(); state.sessions.push(...example.sessions); state.branches.push(...example.branches); state.active = example.active; undo = null; persist(); render(); }
    else if (d.fork) openFork(d.fork);
    else if (d.raw) { const el = document.getElementById(`entry-${d.raw}`).querySelector('.message-text'); if (el.classList.contains('raw-source')) { el.innerHTML = renderMarkdown(el.dataset.source); el.classList.remove('raw-source'); button.textContent = '选择原文'; } else { const span = document.createElement('span'); span.dataset.sourceStart = '0'; span.textContent = el.dataset.source; el.replaceChildren(span); el.classList.add('raw-source'); button.textContent = '回到排版阅读'; } }
    else if ('return' in d) { const b = branchOf(state); jump(b.parent.branchId, b.parent.entryId, b.selection?.start, b.selection?.end); }
    else if (d.jump) jump(d.jump, d.message, d.start, d.end);
    else if ('openReference' in d || d.related) { if (branchOf(state).awaiting && !branchOf(state).pendingPrompt) throw Error('当前问题已提交，请先完成回答或返回草稿再调整引用。'); openReferences(d.related); }
    else if ('skipHistory' in d) { dispatch({ type:'resolveHistory', decision:'skip' }); continueRequest(); }
    else if ('cancel' in d) running.get(state.active)?.abort();
    else if ('retryAnswer' in d) void generate();
    else if ('editQuestion' in d) { const b = branchOf(state); b.draft = [b.entries.pop().text, b.draft].filter(Boolean).join('\n\n'); delete b.awaiting; undo = null; persist(); render(); $('#draft').focus(); }
    else if ('keep' in d) { dispatch({ type:'keep' }); close(); }
    else if ('deleteBranch' in d) openDelete('branch', state.active);
    else if (d.deleteSession) openDelete('session', d.deleteSession);
    else if (d.remove) { if (branchOf(state).awaiting) throw Error('请先结束当前问题，再移除引用。'); const id = d.remove; modal('移除此处的引用？', '<p>只移除当前快照，来源及其他分支保持可访问。可撤销至下一次修改或刷新。</p>', [{ label:'确认移除', danger:true, run() { dispatch({ type:'removeReference', entryId:id }, true); close(); } }]); }
    else if ('export' in d) exportData();
    else if ('saveRetry' in d) recoverSave();
    else if ('check' in d) { await refreshStatus(); settings(); }
    else if ('reset' in d) { if (running.size) throw Error('请先停止请求。'); modal('清空全部记录？', '<p>此操作无法撤销，包括所有主题、引用及草稿。请先导出备份。</p>', [{ label:'确认清空', danger:true, run() { cancelNaming(); state = emptyState(); undo = null; blocked = false; failures.clear(); persist(); render(); close(); } }]); }
  } catch (e) { $('#modal').open ? $('#modal-error').textContent = e.message : notify(e.message); }
});
function closeNavigation() { document.body.classList.remove('nav-open'); if (matchMedia('(max-width:760px)').matches) $('#nav-toggle').setAttribute('aria-expanded', 'false'); }
$('#create').onclick = () => { dispatch({ type:'create', title:'新的学习问题' }); closeNavigation(); $('#draft').focus(); };
$('#settings-button').onclick = settings; $('#context-button').onclick = openContext; $('#related-button').onclick = related; $('#manage-button').onclick = manage;
$('#nav-toggle').onclick = () => { const mobile = matchMedia('(max-width:760px)').matches; document.body.classList.toggle(mobile ? 'nav-open' : 'nav-collapsed'); $('#nav-toggle').setAttribute('aria-expanded', String(mobile ? document.body.classList.contains('nav-open') : !document.body.classList.contains('nav-collapsed'))); };
$('#tag-filter').onchange = e => { filter = e.target.value; tree(); };
$('#draft').oninput = e => dispatch({ type:'draft', text:e.target.value }, false, false);
$('#draft').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } };
$('#composer').onsubmit = e => { e.preventDefault(); try { dispatch({ type:'send' }); continueRequest(); } catch (error) { notify(error.message); } };
function capture() {
  if ($('#modal').open) return;
  if (window.getSelection().isCollapsed) { $('#expand-selection').hidden = true; return; }
  try { picked = readSelection(window.getSelection(), $('#messages')); const rect = window.getSelection().getRangeAt(0).getBoundingClientRect(); const tool = $('#expand-selection'); tool.hidden = false; tool.style.left = `${Math.max(8, Math.min(innerWidth - 146, rect.left))}px`; tool.style.top = `${Math.max(8, Math.min(innerHeight - 50, rect.bottom + 8))}px`; }
  catch (e) { picked = null; $('#expand-selection').hidden = true; notify(e.message); }
}
$('#messages').addEventListener('pointerup', capture); $('#messages').addEventListener('keyup', capture);
$('#expand-selection').onpointerdown = e => e.preventDefault(); $('#expand-selection').onclick = () => { if (picked) openFork(picked.entryId, picked); };
$('#undo').onclick = () => { if (undo) { cancelNaming(); state = undo; undo = null; persist(); render(); notify('已恢复记录和草稿。'); } };
$('#retry').onclick = recoverSave;
window.addEventListener('beforeunload', e => { if (!$('#retry').hidden) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#expand-selection').hidden = true; if (document.body.classList.contains('nav-open')) { closeNavigation(); $('#nav-toggle').focus(); } } });
persist(); render(); void refreshStatus();
