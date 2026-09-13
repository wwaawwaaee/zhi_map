import { Component, useState, type ReactNode } from 'react';
import { WorkspaceController } from '../controller.js';
import { useWorkspace } from '../hooks.js';
import type { Selection } from '../types.js';
import { TopicNavigator } from './TopicNavigator.js';
import { MessageViewport, type Jump } from './MessageViewport.js';
import { Composer } from './Composer.js';
import { SelectionDialog } from './SelectionDialog.js';
import { ReferencesDialog } from './ReferencesDialog.js';
import { TopicSettings } from './TopicSettings.js';
import { ProviderSettings } from './ProviderSettings.js';
import { DataSettings } from './DataSettings.js';
import { Dialog } from './Dialog.js';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main role="alert"><h1>界面暂时无法显示</h1><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children; }
}

export function AppShell() {
  const [controller] = useState(() => new WorkspaceController()); const app = useWorkspace(controller);
  const [modal, setModal] = useState<'' | 'settings' | 'references' | 'topic' | 'context'>(''), [selection, setSelection] = useState<Selection>(), [jump, setJump] = useState<Jump>(), [nav, setNav] = useState(false);
  const close = () => { setModal(''); setSelection(undefined); };
  const locate = async (target: Jump) => { await app.action({ type: 'switch', branchId: target.branchId }, target.entryId); setJump(target); };
  const branch = app.branch;
  if (!app.initialized) return <main role="status"><h1>正在加载学习空间…</h1><p>{app.notice}</p><button onClick={() => void app.load().catch(app.report)}>重试</button></main>;
  return <div className={nav ? 'nav-open' : ''} data-cache-pages={app.cache.size} data-cache-entries={app.cache.entryCount}>
    <a className="skip" href="#draft">跳到输入框</a><TopicNavigator app={app} settings={() => setModal('settings')} />
    <main className="workspace"><header className="topbar"><button id="nav-toggle" aria-expanded={nav} onClick={() => setNav(!nav)}>菜单</button><span className="top-title">学习空间</span><div className="top-actions"><button id="related-button" disabled={!branch} onClick={() => setModal('references')}>相关主题</button><button id="context-button" disabled={!branch} onClick={() => setModal('context')}>上下文</button><button id="manage-button" disabled={!branch} onClick={() => setModal('topic')}>管理</button></div></header>
      <section className="chat" aria-label="当前讨论"><div id="chat-header"><h1>{branch?.title ?? '让好奇有迹可循'}</h1>{branch?.selection && <blockquote>{branch.selection.text}</blockquote>}{branch?.parent && <button data-return onClick={() => void locate({ branchId: branch.parent!.branchId, entryId: branch.parent!.entryId, start: branch.selection?.start ?? 0, end: branch.selection?.end ?? 0 }).catch(app.report)}>返回原讨论</button>}</div>
        {branch ? <MessageViewport app={app} select={setSelection} jump={jump} locate={j => void locate(j).catch(app.report)} /> : <button data-sample onClick={() => void app.action({ type: 'sample' }).catch(app.report)}>加载人工学习示例</button>}
      </section><Composer app={app} references={() => setModal('references')} /><div className="storagebar"><span>分页 40 条 · AI 最近 100 条 / 64,000 字符</span><button id="refresh" onClick={() => void app.flush().then(() => { app.cache.clear(); return app.load(); }).catch(app.report)}>刷新工作区</button></div>
    </main><div id="notice" role="status">{app.notice}</div>{app.undoToken && <div id="undo-bar">已删除主题<button id="undo" onClick={() => void app.undo().catch(app.report)}>撤销</button></div>}
    {selection && branch && <SelectionDialog app={app} selection={selection} close={close} />}
    {modal === 'references' && branch && <ReferencesDialog app={app} close={close} />}
    {modal === 'topic' && branch && <TopicSettings app={app} close={close} />}
    {modal === 'settings' && <Dialog title="设置与数据" close={close}><ProviderSettings /><DataSettings app={app} /></Dialog>}
    {modal === 'context' && <Dialog title="当前上下文" close={close}><p>选区原文始终发送并计入 64,000 字符预算；剩余预算保留最近最多 100 条消息。较早背景和历史引用可能被裁剪，发生裁剪时会提示；完整历史仍可分页查看。选区与最新问题超出预算时会阻止生成。</p><button onClick={() => { void app.navigate(-1).catch(app.report); close(); }}>查看最早一页</button></Dialog>}
  </div>;
}
