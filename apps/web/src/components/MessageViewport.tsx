import { useEffect, useRef, useState } from 'react';
import type { Entry, Selection } from '../types.js';
import type { WorkspaceController } from '../controller.js';
import { renderMarkdown } from '../render.js';
import { readSelection, restoreSelection } from '../selection.js';
import { Pager } from './Dialog.js';

export type Jump = { branchId: string; entryId: string; start: number; end: number };

function Message({ entry, app, jump, locate }: { entry: Entry; app: WorkspaceController; jump?: Jump; locate: (j: Jump) => void }) {
  const [raw, setRaw] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (jump?.entryId === entry.id && ref.current) { restoreSelection(ref.current, jump.start, jump.end); ref.current.scrollIntoView({ block: 'center' }); } }, [jump, entry.id]);
  return <article className={entry.kind === 'reference' ? 'reference' : `message ${entry.role}`} data-entry={entry.id} data-kind={entry.kind}>
    <header>{entry.kind === 'reference' ? '引用快照' : entry.role === 'user' ? '你' : '知树'}{entry.inherited && ' · 继承背景'}{entry.simulated && ' · 人工示例'}</header>
    <div ref={ref} className="message-text" data-source={entry.text} dangerouslySetInnerHTML={{ __html: raw ? `<span data-source-start="0">${entry.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</span>` : renderMarkdown(entry.text) }} />
    <div className="toolbar"><button onClick={() => setRaw(!raw)}>选择原文</button>
      {entry.kind === 'message' && <button data-fork onClick={() => void app.action({ type: 'fork', branchId: app.branch!.id, entryId: entry.id }).catch(app.report)}>从这里分叉</button>}
      {(entry.kind === 'reference' || entry.inherited) && <button data-jump onClick={() => locate({ branchId: entry.source.branchId, entryId: entry.source.messageId, start: entry.range?.start ?? 0, end: entry.range?.end ?? entry.text.length })}>返回原文</button>}
      {entry.kind === 'reference' && <button onClick={() => void app.action({ type: 'removeReference', branchId: app.branch!.id, entryId: entry.id }).catch(app.report)}>移除引用</button>}
    </div>
  </article>;
}

export function MessageViewport({ app, select, jump, locate }: { app: WorkspaceController; select: (s: Selection) => void; jump?: Jump; locate: (j: Jump) => void }) {
  const [picked, setPicked] = useState<Selection>();
  useEffect(() => setPicked(undefined), [app.branch?.id, app.page]);
  return <div id="messages" onPointerUp={e => { const selection = window.getSelection(); if (!selection || selection.isCollapsed) return; try { setPicked(readSelection(selection, e.currentTarget)); } catch (error) { app.report(error); } }}>
    <Pager cursor={app.page.cursor ?? -1} next={app.page.nextCursor} change={cursor => void app.navigate(cursor).catch(app.report)} />
    {app.page.items.map(entry => <Message key={entry.id} entry={entry} app={app} jump={jump} locate={locate} />)}
    {picked && <button id="expand-selection" className="primary" onClick={() => { select(picked); setPicked(undefined); }}>展开讨论</button>}
    {app.partial() && <article className="message assistant" id="stream-output" aria-live="polite">{app.partial()}</article>}
  </div>;
}
