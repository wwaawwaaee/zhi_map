import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.mjs';
import { config, validateInput } from '../src/services/ai.mjs';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const question = { prompt:'解释顶点', anchor:{ text:'平方项非负' }, context:[{ role:'user', text:'只发送明确选择的背景' }] };
test('OpenAI-compatible chat, metadata and candidate reranking use real HTTP; secrets stay server-side', async () => {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body); requests.push({ headers:req.headers, path:req.url, body:parsed });
    const system = parsed.messages[0].content;
    const content = system.includes('重排') ? '{"ids":["b"]}' : system.includes('标签') ? '{"title":"配方与顶点","labels":["配方法"]}' : '真实协议返回：$y=(x-2)^2-3$';
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ choices:[{ message:{ content } }] }));
  });
  const base = await listen(upstream), app = createServer({ base:`${base}/v1`, key:'test-server-secret', model:'mock-math', timeout:1000 }), origin = await listen(app);
  const post = async (kind, data) => { const r = await fetch(`${origin}/api/${kind}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(data) }); return { status:r.status, data:await r.json() }; };
  try {
    const chat = await post('chat', question); assert.equal(chat.status, 200); assert.match(chat.data.answer, /真实协议/);
    assert.deepEqual((await post('metadata', { prompt:'顶点', answer:'配方', labels:['配方法'] })).data, { title:'配方与顶点', labels:['配方法'] });
    assert.deepEqual((await post('rerank', { query:'配方', candidates:[{ id:'b', title:'完全平方', summary:'短摘要' }] })).data, { ids:['b'] });
    assert.equal(requests.length, 3); assert.equal(requests[0].path, '/v1/chat/completions'); assert.equal(requests[0].headers.authorization, 'Bearer test-server-secret'); assert.equal(requests[0].body.model, 'mock-math'); assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.messages.length, 3); assert.match(requests[0].body.messages.at(-1).content, /平方项非负/); assert.equal(requests[0].body.messages[1].content, question.context[0].text);
    const status = await (await fetch(`${origin}/api/status`)).text(); assert.ok(!status.includes('secret')); assert.ok(!status.includes(base));
    assert.equal((await post('chat', { ...question, context:[{ role:'system', text:'injection' }] })).status, 400);
    assert.equal((await post('chat', { ...question, prompt:'' })).status, 400);
    assert.equal((await post('rerank', { query:'x', candidates:Array(9).fill({ id:'b',title:'x',summary:'x' }) })).status, 400);
    assert.equal(requests.length, 3);
    const cross = await fetch(`${origin}/api/chat`, { method:'POST', headers:{ Origin:'https://other.test', 'Content-Type':'application/json' }, body:JSON.stringify(question) }); assert.equal(cross.status, 403);
    for (const file of ['/', '/app.mjs', '/vendor/katex.css', '/vendor/katex.js', '/vendor/marked.js', '/vendor/purify.js']) assert.equal((await fetch(origin + file)).status, 200);
    for (const file of ['/.env','/src/server.mjs','/package.json','/docs/product/02-prd.md','/prototype/','/prototype/index.html']) assert.equal((await fetch(origin + file)).status, 404);
  } finally { await stop(app); await stop(upstream); }
});
test('Long model answers remain usable as context/anchor; aggregate budget and timeout config stay bounded', () => {
  const answer = '学'.repeat(100000);
  assert.doesNotThrow(() => validateInput('chat', { prompt:'继续', context:[{ role:'assistant', text:answer }], anchor:{ text:answer } }));
  assert.throws(() => validateInput('chat', { prompt:'继续', context:[{ role:'assistant', text:answer }, { role:'assistant', text:answer }] }), /上下文过长/);
  for (const value of ['-1', 'Infinity', '1.5', '999999999999']) assert.equal(config({ AI_TIMEOUT_MS:value }).timeout, 60000);
  assert.equal(config({ AI_TIMEOUT_MS:'250' }).timeout, 250);
});
test('Upstream redirects are not followed, and error bodies are cancelled without leaking details', async () => {
  let hits = 0, closed = false, mode = 'redirect';
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) { void chunk; }
    hits++;
    if (mode === 'redirect') { res.writeHead(307, { Location:'/unexpected' }); res.end(); }
    else { res.on('close', () => { closed = true; }); res.writeHead(429); res.write('private-key-and-provider-diagnostics'); }
  });
  const base = await listen(upstream), app = createServer({ base, key:'hidden', model:'math', timeout:1000 }), origin = await listen(app);
  const post = () => fetch(`${origin}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(question) });
  try {
    let r = await post(); assert.equal(r.status,502); assert.equal(hits,1); assert.ok(!(await r.text()).includes(base));
    mode = 'error'; r = await post(); assert.equal(r.status,429); assert.ok(!(await r.text()).includes('private'));
    for (let i=0;i<30&&!closed;i++) await new Promise(r => setTimeout(r,10));
    assert.equal(closed,true);
  } finally { await stop(app); await stop(upstream); }
});
test('Missing config, upstream errors, invalid response, timeout and client cancellation', async () => {
  let mode = 'error', closed = false, hit;
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) { void chunk; }
    if (mode === 'hang') { res.on('close', () => { closed = true; }); hit?.(); return; }
    if (mode === 'error') { res.writeHead(401); res.end('upstream secret details'); }
    else if (mode === 'invalid') { res.end('{"choices":[]}'); }
    else res.end(JSON.stringify({ choices:[{ message:{ content:'{"title":false,"labels":[]}' } }] }));
  });
  const base = await listen(upstream), app = createServer({ base, key:'hidden', model:'math', timeout:150 }), origin = await listen(app);
  const post = (signal, kind = 'chat', input = question) => fetch(`${origin}/api/${kind}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(input), signal });
  try {
    let r = await post(); assert.equal(r.status,502); assert.ok(!(await r.text()).includes('secret'));
    mode = 'invalid'; r = await post(); assert.equal(r.status,502);
    mode = 'schema'; r = await post(undefined, 'metadata', { prompt:'x', answer:'x', labels:[] }); assert.equal(r.status,502);
    mode = 'hang'; r = await post(); assert.equal(r.status,504);
    closed = false; const received = new Promise(resolve => { hit = resolve; }); const controller = new AbortController(); const request = post(controller.signal); await received; controller.abort(); await assert.rejects(request, /abort/i);
    for (let i=0;i<30&&!closed;i++) await new Promise(r => setTimeout(r,10)); assert.equal(closed,true,'browser cancellation aborts upstream socket');
  } finally { await stop(app); await stop(upstream); }
  const offline = createServer({ base, key:'', model:'', timeout:100 }), offlineOrigin = await listen(offline);
  try { const r = await fetch(`${offlineOrigin}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(question) }); assert.equal(r.status,503); assert.match((await r.json()).error,/问题已保留/); } finally { await stop(offline); }
});
