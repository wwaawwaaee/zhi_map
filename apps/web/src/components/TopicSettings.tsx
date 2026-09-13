import { useState } from 'react';
import type { WorkspaceController } from '../controller.js';
import { Dialog } from './Dialog.js';

export function TopicSettings({ app, close }: { app: WorkspaceController; close: () => void }) {
  const branch = app.branch!;
  const [title, setTitle] = useState(branch.title), [tags, setTags] = useState(branch.tags.join(', ')), [confirmDelete, setConfirmDelete] = useState(false);
  return <Dialog title="整理这个主题" close={close} confirm={async () => { await app.action({ type: 'metadata', branchId: branch.id, title, tags: tags.split(/[,，]/) }); }}>
    <label className="field">标题<input id="topic-title" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label><label className="field">标签（逗号分隔）<input id="topic-tags" maxLength={1000} value={tags} onChange={e => setTags(e.target.value)} /></label>
    <button onClick={() => void app.action({ type: 'keep', branchId: branch.id }).catch(app.report)}>{app.branch?.kept ? '取消收藏' : '收藏主题'}</button>
    <label><input type="checkbox" checked={confirmDelete} onChange={e => setConfirmDelete(e.target.checked)} />确认删除（独立子分支保留）</label>
    <button className="danger" data-delete-branch disabled={!confirmDelete} onClick={() => void app.action({ type: 'delete', kind: 'branch', targetId: branch.id }).then(close).catch(app.report)}>删除主题 · 10 分钟内可撤销</button>
    <button className="danger" data-delete-session disabled={!confirmDelete} onClick={() => void app.action({ type: 'delete', kind: 'session', targetId: branch.sessionId }).then(close).catch(app.report)}>删除整个会话主线（不可撤销）</button>
  </Dialog>;
}
