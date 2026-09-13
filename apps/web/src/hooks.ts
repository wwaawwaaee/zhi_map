import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, type Page } from './api.js';
import type { TopicMeta, Entry } from './types.js';
import { WorkspaceController } from './controller.js';

export function useWorkspace(controller: WorkspaceController) {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  useEffect(() => { void controller.load().catch(controller.report); return () => controller.dispose(); }, [controller]);
  return controller;
}

// Replaced pages, not appended lists. Effect cleanup prevents stale query commits.
export function useTopics(cursor: number, search: string, revision: number) {
  const [page, setPage] = useState<Page<TopicMeta>>({ items: [], nextCursor: null });
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setPage({ items: [], nextCursor: null });
    void api.topics(cursor, search).then(p => { if (live) { setPage(p); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [cursor, search, revision]);
  return { page, error };
}

export function useEntries(app: WorkspaceController, id: string, cursor: number, before = '') {
  const [page, setPage] = useState<Page<Entry>>({ items: [], nextCursor: null });
  const [error, setError] = useState('');
  useEffect(() => { let live = true; setPage({ items: [], nextCursor: null });
    if (id) void app.cache.page(id, cursor, '', before).then(p => { if (live) { setPage(p); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [app, id, cursor, before, app.revision]);
  return { page, error };
}
