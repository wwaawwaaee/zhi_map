import type { WorkspaceController } from '../controller.js';

export function Composer({ app, references }: { app: WorkspaceController; references: () => void }) {
  const b = app.branch; if (!b) return null;
  const send = async () => { await app.action({ type: 'send', branchId: b.id }); if (app.branch?.awaiting) await app.ask(); };
  return <div className="bottom">
    {b.pendingPrompt && <div id="history-gate"><strong>这次想参考哪段旧讨论？</strong><p>{b.pendingPrompt}</p><button onClick={references}>选择并确认引用</button><button onClick={() => void app.action({ type: 'resolveHistory', branchId: b.id, decision: 'skip' }).then(() => app.ask()).catch(app.report)}>不新增引用，继续</button></div>}
    {b.awaiting && <div id="request-status"><span>{app.running() ? '正在思考，请稍候…' : '问题已保留，尚未收到回答。'}</span>{app.running() ? <button data-cancel onClick={() => app.cancel()}>停止生成</button> : <><button data-retry-answer onClick={() => void app.ask().catch(app.report)}>重试回答</button><button data-edit-question onClick={() => void app.action({ type: 'retryToDraft', branchId: b.id }).catch(app.report)}>返回草稿编辑</button></>}</div>}
    <form id="composer" onSubmit={e => { e.preventDefault(); void send().catch(app.report); }}><label htmlFor="draft">继续这条思路</label><textarea id="draft" rows={2} maxLength={64000} value={b.draft} disabled={Boolean(b.pendingPrompt)} onChange={e => app.draft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!b.awaiting && !b.pendingPrompt) void send().catch(app.report); } }} /><div className="composer-bottom"><span>Ctrl / Cmd + Enter 发送</span><button id="send" type="submit" className="primary" disabled={Boolean(b.awaiting || b.pendingPrompt)}>发送</button></div></form>
  </div>;
}
