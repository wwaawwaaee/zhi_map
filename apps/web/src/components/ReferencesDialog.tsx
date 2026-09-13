import { useEffect, useState } from 'react';
import type { WorkspaceController } from '../controller.js';
import type { Range } from '../types.js';
import { useTopics, useEntries } from '../hooks.js';
import { Dialog, Pager } from './Dialog.js';

export function ReferencesDialog({ app, close }: { app: WorkspaceController; close: () => void }) {
  const target = app.branch!;
  const [search, setSearch] = useState(''), [topicCursor, setTopicCursor] = useState(-1), [cursor, setCursor] = useState(-1), [source, setSource] = useState('');
  const [selected, setSelected] = useState(new Map<string, Range>());
  const topics = useTopics(topicCursor, search, app.topicRevision), entries = useEntries(app, source, cursor);
  useEffect(() => { if (!source) setSource(topics.page.items.find(b => b.id !== target.id)?.id ?? ''); }, [topics.page, source, target.id]);
  const choose = (id: string) => { setSource(id); setCursor(-1); setSelected(new Map()); };
  return <Dialog title="只带入需要的前提" close={close} label={target.pendingPrompt ? '确认引用并继续' : '确认加入引用'} disabled={!selected.size} confirm={async () => { await app.action({ type: target.pendingPrompt ? 'resolveHistory' : 'reference', decision: 'reference', branchId: target.id, sourceId: source, selectedIds: [...selected.keys()], ranges: Object.fromEntries(selected) }); if (app.branch?.awaiting) void app.ask().catch(app.report); }}>
    <label className="field">搜索来源主题<input maxLength={120} value={search} onChange={e => { setSearch(e.target.value); setTopicCursor(-1); }} /></label>
    <Pager cursor={topicCursor} next={topics.page.nextCursor} change={setTopicCursor} /><label className="field">来源主题<select id="source-select" value={source} onChange={e => choose(e.target.value)}><option value="">选择来源</option>{topics.page.items.filter(b => b.id !== target.id).map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
    <p>已选 {selected.size} / 100 条（跨消息页保留；更换来源清空）。仅保存原文快照。</p><Pager cursor={cursor} next={entries.page.nextCursor} change={setCursor} />
    {entries.page.items.filter(e => e.kind === 'message').map(e => <div className="reference-choice" data-entry={e.id} key={e.id}><label className="preview-item"><input type="checkbox" checked={selected.has(e.id)} disabled={!selected.has(e.id) && selected.size >= 100} onChange={event => setSelected(old => { const next = new Map(old); event.target.checked ? next.set(e.id, { start: 0, end: e.text.length }) : next.delete(e.id); return next; })} /><span className="full-text">{e.text}</span></label><details><summary>仅引用部分范围</summary><div className="range-fields">{(['start', 'end'] as const).map(key => <label key={key}>{key === 'start' ? '起点' : '终点'}<input {...(key === 'start' ? { 'data-start': true } : { 'data-end': true })} type="number" min={0} max={e.text.length} disabled={!selected.has(e.id)} value={selected.get(e.id)?.[key] ?? (key === 'start' ? 0 : e.text.length)} onChange={event => setSelected(old => { const next = new Map(old); next.set(e.id, { ...next.get(e.id)!, [key]: Number(event.target.value) }); return next; })} /></label>)}</div></details></div>)}<p role="alert">{entries.error || topics.error}</p>
  </Dialog>;
}
