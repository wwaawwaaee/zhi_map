import type { Compact } from '../api.js';

export type RunEvent = { type: 'started' | 'delta' | 'usage' | 'completed' | 'failed' | 'cancelled'; runId: string; seq: number; text?: string; error?: string; result?: Compact; contextTruncated?: boolean };

export async function chatStream(branchId: string, revision: number, signal: AbortSignal, receive: (event: RunEvent) => void): Promise<Compact> {
  const response = await fetch('/api/ai/chat/stream', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branchId, revision, response: 'compact' }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? '请求失败。');
  if (!response.body) throw new Error('浏览器不支持流式响应。');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', runId = '', seq = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!raw.startsWith('data: ')) continue;
        const event = JSON.parse(raw.slice(6)) as RunEvent;
         if ((!runId && event.type !== 'started') || (runId && event.runId !== runId) || !Number.isSafeInteger(event.seq) || event.seq <= seq || event.seq > 1000000) throw new Error('模型流顺序无效。');
        runId = event.runId; seq = event.seq; receive(event);
        if (event.type === 'failed') throw new Error(event.error ?? '模型请求失败。');
        if (event.type === 'cancelled') throw new DOMException('已停止生成', 'AbortError');
         if (event.type === 'completed' && event.result) return event.result;
      }
       if (buffer.length > 1024 * 1024) throw new Error('响应事件超过限制。');
      if (done) throw new Error('模型流意外中断，问题已保留。');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
