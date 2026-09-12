import type { State } from './types.js';

export type Snapshot = { state: State; revision: number };
export type AiConfig = { configured: boolean; baseUrl: string | null; model: string | null; timeoutMs: number | null; updatedAt: string | null; source: 'user' | 'environment' | 'none' };
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
  workspace: () => request<Snapshot>('/api/workspace'),
  status: () => request<{ mode: string; model: string | null }>('/api/status'),
  aiConfig: () => request<AiConfig>('/api/ai/config'),
  saveAiConfig: (body: { baseUrl: string; model: string; apiKey: string; timeoutMs?: number }) => request<AiConfig>('/api/ai/config', { method: 'POST', body: JSON.stringify(body) }),
  clearAiConfig: () => request<AiConfig>('/api/ai/config/clear', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  testAiConfig: () => request<{ ok: true }>('/api/ai/config/test', { method: 'POST', body: JSON.stringify({}) }),
  action: (body: Record<string, unknown>) => request<Snapshot>('/api/workspace/actions', { method: 'POST', body: JSON.stringify(body) }),
  restore: (state: State, revision: number) => request<Snapshot>('/api/workspace/restore', { method: 'POST', body: JSON.stringify({ state, revision }) }),
  chat: (branchId: string, revision: number, signal: AbortSignal) => request<Snapshot>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ branchId, revision }), signal }),
  rerank: (query: string, candidates: { id: string; title: string; summary: string }[]) => request<{ ids: string[] }>('/api/ai/rerank', { method: 'POST', body: JSON.stringify({ query, candidates }) }),
  export: () => request<{ schemaVersion: number; state: State }>('/api/export'),
  import: (body: unknown, revision: number) => request<Snapshot>('/api/import', { method: 'POST', body: JSON.stringify({ ...(body as object), revision }) })
};
