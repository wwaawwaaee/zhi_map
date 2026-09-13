import type { State, BranchMeta, TopicMeta, Entry } from './types.js';
export type Compact = { revision: number; active: string | null; affectedIds?: string[]; entryIds?: string[]; undoToken?: string | null };
export type Page<T> = { items: T[]; nextCursor: number | null; cursor?: number };

export type Snapshot = { state: State; revision: number };
export type AiConfig = { configured: boolean; provider?: string; maxTokens?: number; temperature?: number | null; baseUrl: string | null; model: string | null; timeoutMs: number | null; updatedAt: string | null; source: 'user' | 'environment' | 'none' };
export class ConflictError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, ...init });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 409) throw new ConflictError(body.error ?? '工作区已更新。');
    throw new Error(body.error ?? '请求失败。');
  }
  return body;
}

export const api = {
  view: () => request<Compact>('/api/workspace/view'),
  branch: (id: string) => request<BranchMeta>(`/api/branches/${encodeURIComponent(id)}`),
  topics: (cursor = -1, search = '') => request<Page<TopicMeta>>(`/api/topics?limit=40&cursor=${cursor}&search=${encodeURIComponent(search)}`),
  entries: (id: string, cursor = -1, anchor = '', before = '') => request<Page<Entry>>(`/api/branches/${encodeURIComponent(id)}/entries?limit=40&cursor=${cursor}&anchor=${encodeURIComponent(anchor)}&before=${encodeURIComponent(before)}`),
  status: () => request<{ mode: string; model: string | null }>('/api/status'),
  aiConfig: () => request<AiConfig>('/api/ai/config'),
  saveAiConfig: (body: { baseUrl: string; model: string; apiKey: string; timeoutMs?: number; provider?: string; maxTokens?: number; temperature?: number | null }) => request<AiConfig>('/api/ai/config', { method: 'POST', body: JSON.stringify(body) }),
  clearAiConfig: () => request<AiConfig>('/api/ai/config/clear', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  testAiConfig: () => request<{ ok: true }>('/api/ai/config/test', { method: 'POST', body: JSON.stringify({}) }),
  action: (body: Record<string, unknown>) => request<Compact>('/api/workspace/actions?response=compact', { method: 'POST', body: JSON.stringify(body) }),
  undo: (token: string, revision: number) => request<Compact>('/api/workspace/undo', { method: 'POST', body: JSON.stringify({ token, revision }) }),
  rerank: (query: string, candidates: { id: string; title: string; summary: string }[]) => request<{ ids: string[] }>('/api/ai/rerank', { method: 'POST', body: JSON.stringify({ query, candidates }) }),
  import: (body: unknown, revision: number) => request<Snapshot>('/api/import', { method: 'POST', body: JSON.stringify({ ...(body as object), revision }) })
};
