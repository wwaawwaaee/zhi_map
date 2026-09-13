import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dialog({ title, close, children, confirm, label = '保存', disabled = false }: { title: string; close: () => void; children: ReactNode; confirm?: () => Promise<void>; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  const submit = async () => { setBusy(true); try { await confirm?.(); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <dialog id="modal" ref={ref} aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="modal-head"><h2 id="modal-title">{title}</h2><button id="close-modal" disabled={busy} onClick={close} aria-label="关闭抽屉">关闭</button></div>
    <div id="modal-body">{children}</div><p id="modal-error" role="alert">{error}</p>
    {confirm && <div id="modal-actions"><button id="modal-confirm" className="primary" disabled={disabled || busy} onClick={() => void submit()}>{busy ? '保存中…' : label}</button></div>}
  </dialog>;
}

export function Pager({ cursor, next, change }: { cursor: number; next: number | null; change: (cursor: number) => void }) {
  return <div className="toolbar"><button disabled={cursor < 0} onClick={() => change(Math.max(-1, cursor - 40))}>上一页</button><span>每页最多 40 条</span><button disabled={next === null} onClick={() => next !== null && change(next)}>下一页</button></div>;
}
