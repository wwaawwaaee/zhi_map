import { useEffect, useRef, useState } from 'react';
import type { WorkspaceController } from '../controller.js';
import { api } from '../api.js';

export function DataSettings({ app }: { app: WorkspaceController }) {
  const [status, setStatus] = useState('单记录 ≤ 1 MiB，总文件 ≤ 2 GiB；导入成功前原工作区保持完整。'), [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const upload = async (file?: File, legacy = false) => {
    if (!file) return;
    if (file.size > (legacy ? 8 * 1024 ** 2 : 2 * 1024 ** 3)) { setStatus(legacy ? '旧 JSON 限制 8 MiB；大型备份请使用 NDJSON。' : '文件超过 2 GiB。'); return; }
    setBusy(true); setStatus('正在上传并校验，请勿关闭页面…'); const controller = new AbortController(); abort.current = controller;
    try {
      await app.flush();
      if (legacy) { const result = await api.import(JSON.parse(await file.text()), app.revision); app.revision = result.revision; }
      else { const response = await fetch(`/api/import/ndjson?revision=${app.revision}`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body: file, signal: controller.signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setStatus(`已导入 ${value.counts.entry} 条消息。`); }
      app.cache.clear(); await app.load(); if (legacy) setStatus('旧 JSON 已迁移。');
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="settings-section"><h3>大型历史备份</h3><a href="/api/export/ndjson" download>流式导出 NDJSON</a><label className="file-button">导入 NDJSON<input id="import-ndjson" type="file" accept=".ndjson,application/x-ndjson" disabled={busy} onChange={e => void upload(e.target.files?.[0])} /></label><p id="transfer-progress" role="status">{status}</p>
    <details><summary>旧版 JSON 迁移（≤ 8 MiB）</summary><p>仅从所选文件读取，不在启动时读取浏览器旧全量存储。大文件先转换为 NDJSON。</p><input id="import-file" type="file" accept=".json,application/json" disabled={busy} onChange={e => void upload(e.target.files?.[0], true)} /></details>
  </section>;
}
