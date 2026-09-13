import { useState } from 'react';
import { useTopics } from '../hooks.js';
import type { WorkspaceController } from '../controller.js';
import { Pager } from './Dialog.js';

export function TopicNavigator({ app, settings }: { app: WorkspaceController; settings: () => void }) {
  const [cursor, setCursor] = useState(-1), [search, setSearch] = useState('');
  const { page, error } = useTopics(cursor, search, app.topicRevision);
  return <nav className="sidebar" aria-label="学习主题"><a className="brand" href="/">知树<span>把问题想明白</span></a>
    <button id="create" className="primary" onClick={() => void app.action({ type: 'create', title: '新的学习问题' }).catch(app.report)}>+ 新的学习问题</button>
    <label>搜索主题 / 标签<input id="topic-search" maxLength={120} value={search} onChange={e => { setSearch(e.target.value); setCursor(-1); }} /></label>
    <div id="tree">{page.items.map(b => <button key={b.id} data-switch={b.id} className={`branch-button ${app.branch?.id === b.id ? 'active' : ''}`} onClick={() => void app.action({ type: 'switch', branchId: b.id }).catch(app.report)}><span>{b.parent ? '↳ ' : ''}{b.title}<small>{b.kept ? '★ ' : ''}{b.tags.join(' · ')}</small></span></button>)}</div>
    <p role="alert">{error}</p><Pager cursor={cursor} next={page.nextCursor} change={setCursor} />
    <div className="sidebar-bottom"><span id="connection">本地分页存储</span><button id="settings-button" onClick={settings}>设置与数据</button></div>
  </nav>;
}
