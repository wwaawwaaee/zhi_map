import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ask, config, ApiError } from './services/ai.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map(['index.html','app.mjs','core.mjs','provider.mjs','selection.mjs','render.mjs','style.css'].map(f => [`/${f}`, `public/${f}`]));
files.set('/', 'public/index.html');
files.set('/vendor/marked.js', 'node_modules/marked/lib/marked.esm.js');
files.set('/vendor/purify.js', 'node_modules/dompurify/dist/purify.es.mjs');
files.set('/vendor/katex.js', 'node_modules/katex/dist/katex.mjs');
files.set('/vendor/katex.css', 'node_modules/katex/dist/katex.min.css');
const types = { '.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf' };
export function createServer(cfg = config()) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); } };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw new ApiError(403, '不允许跨站请求。');
        if (url.pathname === '/api/status' && req.method === 'GET') return json(200, { configured: Boolean(cfg.key && cfg.model), model: cfg.model || null, mode: cfg.key && cfg.model ? 'configured' : 'offline' });
        if (req.method !== 'POST') throw new ApiError(405, '方法不支持。');
        if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, '需要 application/json。');
        let size = 0, chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw new ApiError(413, '请求过大。'); chunks.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ApiError(400, 'JSON 格式错误。'); }
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        const result = await ask(url.pathname.slice(5), input, cfg, controller.signal);
        return json(200, result);
      }
      if (!['GET','HEAD'].includes(req.method)) throw new ApiError(405, '方法不支持。');
      let filename = files.get(url.pathname);
      if (/^\/vendor\/fonts\/[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(url.pathname)) filename = `node_modules/katex/dist/fonts/${path.basename(url.pathname)}`;
      if (!filename) throw new ApiError(404, 'Not found');
      const data = await readFile(path.join(root, filename));
      res.writeHead(200, { 'Content-Type':types[path.extname(filename)] }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) { json(error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error instanceof ApiError ? error.message : '服务暂不可用。' }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST || '127.0.0.1', () => console.log(`知径：http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`));
  server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
