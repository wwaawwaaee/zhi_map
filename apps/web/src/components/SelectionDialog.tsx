import { useState } from 'react';
import type { Selection } from '../types.js';
import type { WorkspaceController } from '../controller.js';
import { useEntries } from '../hooks.js';
import { Dialog, Pager } from './Dialog.js';

export function SelectionDialog({ app, selection, close }: { app: WorkspaceController; selection: Selection; close: () => void }) {
  const [bid] = useState(app.branch!.id);
  const [text, setText] = useState(''), [cursor, setCursor] = useState(-1), [all, setAll] = useState(true), [excluded, setExcluded] = useState(new Set<string>());
  const { page, error } = useEntries(app, bid, cursor, selection.entryId);
  return <Dialog title="沿着这一点，继续想" close={close} label="展开讨论" disabled={!text.trim()} confirm={async () => { await app.action({ type: 'expand', branchId: bid, selection, contextScope: { mode: all ? 'all' : 'none', excludedIds: [...excluded] }, text }); if (app.branch?.awaiting) void app.ask().catch(app.report); }}>
    <details open><summary>选中的原文</summary><p className="full-text">{selection.text}</p></details><label className="field">你想弄清什么？<textarea id="fork-prompt" value={text} onChange={e => setText(e.target.value)} maxLength={12000} /></label>
    <details><summary>继承背景 · 默认全部此前背景，可取消勾选</summary><p>仅到选区末尾。最多排除 200 条；全部取消仍保留选区。服务端逐条复制背景，AI 使用最近 100 条 / 64,000 字符。</p><button onClick={() => { setAll(!all); setExcluded(new Set()); }}>{all ? '全部取消' : '全部选择'}</button>
      <Pager cursor={cursor} next={page.nextCursor} change={setCursor} />{page.items.map(e => <label className="preview-item" key={e.id}><input type="checkbox" data-context-id={e.id} checked={all && !excluded.has(e.id)} disabled={!all || (!excluded.has(e.id) && excluded.size >= 200)} onChange={event => setExcluded(old => { const next = new Set(old); event.target.checked ? next.delete(e.id) : next.add(e.id); return next; })} /><span className="full-text">{e.id === selection.entryId ? e.text.slice(0, selection.end) : e.text}</span></label>)}<p role="alert">{error}</p>
    </details>
  </Dialog>;
}
