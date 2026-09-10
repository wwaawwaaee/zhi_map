import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from '../src/server.mjs';

const executablePath = process.argv[2] || process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshots = process.env.SMOKE_SCREENSHOT_DIR || tmpdir();
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const stop = s => new Promise(r => { s.closeAllConnections(); s.close(r); });
let mode = 'ok', holdStarted; const calls = [];
const upstream = http.createServer(async (req, res) => {
  let body=''; for await (const chunk of req) body += chunk;
  const data = JSON.parse(body); calls.push(data);
  if (mode === 'hang' && !data.messages[0].content.includes('标签')) return;
  if (mode === 'error') { res.writeHead(500); res.end('private upstream error'); return; }
  const system = data.messages[0].content;
  const content = system.includes('重排') ? JSON.stringify({ ids:JSON.parse(data.messages[1].content).candidates.map(c => c.id) }) : system.includes('标签') ? JSON.stringify({ title:'配方法与顶点的联系', labels:['配方法','二次函数'] }) : '## 从平方项出发\n\n**平方项非负**，因此最小值在 $x=2$ 时取得。\n\n$$y=(x-2)^2-3$$\n\n顶点为 (2, −3)。\n\n<img src=x onerror="window.injected=true">\n\n[不安全链接](javascript:alert(1))';
  const finish = () => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ choices:[{ message:{ content } }] })); };
  if ((mode === 'hold-metadata' && system.includes('标签')) || (mode === 'hold-chat' && !system.includes('标签'))) {
    const closed = new Promise(resolve => res.on('close', resolve)); holdStarted?.({ finish, closed }); return;
  }
  finish();
});
let app, offline, browser;
try {
  const base = await listen(upstream);
  app = createServer({ base:`${base}/v1`, key:'browser-test-secret', model:'math-mock', timeout:5000 }); const origin = await listen(app);
  browser = await chromium.launch({ executablePath, headless:true });
  const context = await browser.newContext({ viewport:{ width:1440,height:1000 }, acceptDownloads:true });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
  const click = s => page.locator(s).click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('learning-branches.v1')));
  const active = async () => { const s=await stored(); return s.branches.find(b => b.id===s.active); };
  const idle = () => page.waitForFunction(() => { const s=JSON.parse(localStorage.getItem('learning-branches.v1')), b=s.branches.find(b=>b.id===s.active); return b && !b.awaiting && !b.pendingPrompt; });
  const screenshot = async name => { const file=path.join(screenshots, `zhijing-${name}.png`); await page.screenshot({ path:file, fullPage:true }); console.log(`Screenshot: ${file}`); };
  await page.goto(origin); await page.locator('[data-example]').waitFor(); await screenshot('welcome');
  const markdown = await page.evaluate(async () => {
    const {renderMarkdown}=await import('/render.mjs'); const el=document.createElement('div'); el.innerHTML=renderMarkdown('1. **第一步**\n2. 第二步\n\n| 项目 | 值 |\n| --- | --- |\n| 顶点 | 2 |\n\n> 引用\n\n$x_1+x_2$\n\n```js\njs\n```');
    return { list:el.querySelectorAll('li').length, table:el.querySelectorAll('th').length, quote:el.querySelectorAll('blockquote').length, math:el.querySelectorAll('.katex').length, code:el.querySelector('pre [data-source-start]').dataset.sourceStart };
  });
  assert.deepEqual({list:markdown.list,table:markdown.table,quote:markdown.quote,math:markdown.math},{list:2,table:2,quote:1,math:1});
  const mapping = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/render.mjs'), { readSelection } = await import('/selection.mjs');
    const source = '# 标题\r\n\r\n前文 **目标文字** 后文\r\n\r\n`a\nb`', host = document.createElement('div');
    host.innerHTML = '<article class="message" id="entry-map" data-kind="message"><div class="message-text"></div></article>';
    const body = host.querySelector('.message-text'); body.dataset.source = source; body.innerHTML = renderMarkdown(source); document.body.append(host);
    const leaf = body.querySelector('strong span'), range = document.createRange(); range.selectNodeContents(leaf);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    const selected = readSelection(window.getSelection(), host);
    const allExact = [...body.querySelectorAll('[data-source-start]')].every(el => source.replace(/\r\n|\r/g,'\n').slice(Number(el.dataset.sourceStart), Number(el.dataset.sourceStart)+el.textContent.length) === el.textContent);
    host.remove(); return { selected, expected:source.indexOf('目标文字'), allExact };
  });
  assert.equal(mapping.selected.start,mapping.expected); assert.equal(mapping.selected.text,'目标文字'); assert.equal(mapping.allExact,true);
  assert.equal((await stored()).branches.length,0);
  await click('[data-example]'); await page.locator('.katex').first().waitFor(); await screenshot('reading-desktop');
  // Repeated-text ambiguity is a test fixture, not duplicate prose in the public example.
  await page.evaluate(() => { const key='learning-branches.v1', s=JSON.parse(localStorage.getItem(key)); s.branches[0].entries[1].text=s.branches[0].entries[1].text.replace('平方项总是非负。','平方项总是非负。平方项总是非负。'); localStorage.setItem(key,JSON.stringify(s)); }); await page.reload(); await page.locator('.katex').first().waitFor();
  const initial = await stored(), parent = initial.active, source = initial.branches[1].id;
  await page.evaluate(() => { const bodies=document.querySelectorAll('.message-text'), a=bodies[0].querySelector('[data-source-start]').firstChild, b=bodies[1].querySelector('[data-source-start]').firstChild, range=document.createRange(); range.setStart(a,1); range.setEnd(b,2); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); bodies[1].dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); });
  assert.equal(await page.locator('#expand-selection').isHidden(),true); assert.match(await page.locator('#notice').textContent(),/跨多个消息/);
  const selection = await page.evaluate(() => {
    const body=document.querySelectorAll('.message-text')[1], quote='平方项总是非负。', start=body.dataset.source.lastIndexOf(quote), end=start+quote.length;
    const leaf=[...body.querySelectorAll('[data-source-start]')].find(el => Number(el.dataset.sourceStart)<=start && Number(el.dataset.sourceStart)+el.textContent.length>=end);
    const range=document.createRange(); range.setStart(leaf.firstChild,start-Number(leaf.dataset.sourceStart)); range.setEnd(leaf.firstChild,end-Number(leaf.dataset.sourceStart)); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); body.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); return { start,end,text:quote };
  });
  await click('#expand-selection'); assert.equal(await page.locator('#fork-prompt').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('[data-context-id]:checked').count(),2);
  assert.equal(await page.locator('#modal-body details').last().getAttribute('open'),null);
  await page.locator('#modal-body details').last().locator('summary').click(); await page.locator('[data-context-id]').first().uncheck();
  await page.locator('#fork-prompt').fill('为什么配方以后能看见顶点？'); await screenshot('expand-drawer'); await click('#modal-confirm'); await idle();
  await page.waitForFunction(() => document.querySelector('#chat-header h1').textContent==='配方法与顶点的联系');
  const child = (await stored()).active, created = await active();
  assert.deepEqual(created.selection, { entryId:initial.branches[0].entries[1].id,...selection });
  assert.equal(created.entries.filter(e=>e.inherited).length,1); assert.equal(created.entries[0].text,initial.branches[0].entries[1].text.slice(0,selection.end));
  assert.equal(created.entries.at(-1).simulated,false); assert.ok(!created.entries.some(e=>e.source.branchId===source));
  assert.equal(await page.locator('.message-text img').count(),0); assert.equal(await page.evaluate(()=>Boolean(window.injected)),false);
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
  assert.equal(calls.filter(c=>c.messages[0].content.includes('标签')).length,1);
  const firstChat=calls[0]; assert.equal(firstChat.messages.length,3); assert.match(firstChat.messages.at(-1).content,/平方项总是非负/); assert.ok(!JSON.stringify(firstChat).includes('后续消息'));
  await click('#related-button'); const before=await active(); await click('#modal-confirm'); await page.getByText('模型排序完成 · 尚未引用').waitFor(); assert.deepEqual((await active()).entries,before.entries);
  await click(`[data-related="${source}"]`); assert.equal(await page.locator('#modal-confirm').isDisabled(),true);
  const choice=page.locator('.reference-choice').nth(1); await choice.locator('input[type=checkbox]').check(); await choice.locator('summary').click(); await choice.locator('[data-range-start]').fill('4'); await choice.locator('[data-range-end]').fill('25');
  assert.deepEqual((await active()).entries,before.entries); await click('#modal-confirm'); assert.equal((await active()).entries.at(-1).text,initial.branches[1].entries[1].text.slice(4,25));
  await click('#messages .reference [data-jump]'); assert.equal(await page.evaluate(()=>window.getSelection().toString()),initial.branches[1].entries[1].text.slice(4,25));
  await click(`[data-switch="${child}"]`); await click('[data-return]'); assert.equal(await page.evaluate(()=>window.getSelection().toString()),selection.text);
  assert.equal(await page.evaluate(()=>window.getSelection().getRangeAt(0).startOffset),selection.start);
  await click(`[data-switch="${child}"]`); await page.locator('#draft').fill('保留草稿'); await page.reload(); assert.equal(await page.locator('#draft').inputValue(),'保留草稿');
  await click('#manage-button'); await page.locator('#topic-title').fill('顶点笔记'); await page.locator('#topic-tags').fill('配方法, 配方法, 二次函数'); await click('#modal-confirm'); assert.deepEqual((await active()).tags,['配方法','二次函数']);
  await click('#manage-button'); await click('[data-keep]'); assert.equal((await active()).kept,true);
  await page.locator('#draft').fill('结合我之前聊过的完全平方公式再解释'); await click('#send'); assert.ok((await active()).pendingPrompt);
  await page.reload(); await page.locator('#history-gate').waitFor(); assert.equal(await page.locator('#send').isDisabled(),true);
  await click('[data-open-reference]'); await page.keyboard.press('Escape'); assert.ok((await active()).pendingPrompt);
  await click('[data-open-reference]'); await page.locator('#source-select').selectOption(source); await page.locator('#source-candidates input[type=checkbox]:not(:disabled)').first().check(); await click('#modal-confirm'); await idle(); assert.ok(!(await active()).pendingPrompt);
  await page.locator('#draft').fill('参考我以前聊过的配方法'); await click('#send'); await click('[data-skip-history]'); await idle();
  // Failure and cancellation preserve one exact question and the next draft.
  mode='hang'; await page.locator('#draft').fill('一个等待取消的问题'); await click('#send'); await page.locator('[data-cancel]').waitFor(); await page.locator('#draft').fill('下一条草稿'); const waiting=await active(); await click('[data-cancel]'); await page.locator('[data-retry-answer]').waitFor(); assert.equal((await active()).draft,'下一条草稿'); assert.equal((await active()).entries.length,waiting.entries.length);
  mode='error'; await click('[data-retry-answer]'); await page.getByText(/模型服务暂不可用/).waitFor(); assert.equal((await active()).entries.length,waiting.entries.length);
  await page.reload(); await page.locator('[data-retry-answer]').waitFor(); mode='ok'; await click('[data-retry-answer]'); await idle(); assert.equal((await active()).entries.length,waiting.entries.length+1); assert.equal((await active()).draft,'下一条草稿');
  // Deletion protection and one-level undo restore source links.
  await click(`[data-switch="${source}"]`); await click('#manage-button'); await click('[data-delete-branch]'); await page.keyboard.press('Escape'); assert.ok((await stored()).branches.some(b=>b.id===source));
  await click('#manage-button'); await click('[data-delete-branch]'); await click('#modal-confirm'); await click(`[data-switch="${child}"]`); assert.ok(await page.getByText('来源已删除 · 快照保留').count()); await click('#undo'); await click(`[data-switch="${child}"]`);
  const references=(await active()).entries.filter(e=>e.kind==='reference').length; await page.locator('#messages [data-remove]').first().click(); await click('#modal-confirm'); assert.equal((await active()).entries.filter(e=>e.kind==='reference').length,references-1); await click('#undo');
  await screenshot('discussion-desktop');
  // Storage quota failures never claim success or erase draft.
  await page.evaluate(()=>{ window.originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=()=>{throw Error('quota smoke');}; }); await page.locator('#draft').fill('未保存的草稿'); assert.match(await page.locator('#storage-status').textContent(),/未保存/); await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem); await click('#retry'); assert.equal((await active()).draft,'未保存的草稿');
  // Validated JSON export/import and malformed protection.
  await click('#settings-button'); const downloadPromise=page.waitForEvent('download'); await click('[data-export]'); const download=await downloadPromise; assert.match(download.suggestedFilename(),/\.json$/);
  let exported=''; for await (const chunk of await download.createReadStream()) exported+=chunk.toString(); assert.deepEqual(JSON.parse(exported),await stored());
  const backup=await stored(); await page.locator('#import-file').setInputFiles({ name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad') }); await page.getByText(/导入失败/).waitFor(); assert.deepEqual(await stored(),backup);
  await page.locator('#import-file').setInputFiles({ name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup)) }); await click('#modal-confirm'); assert.deepEqual(await stored(),backup);
  // Mobile reading and modal boundaries, keyboard dialog dismissal.
  await page.setViewportSize({ width:390,height:844 }); await page.evaluate(()=>document.querySelector('.chat').scrollTo({top:0,behavior:'instant'})); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); await screenshot('reading-mobile'); await click('#context-button'); assert.equal(await page.locator('#modal').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true); await screenshot('context-mobile'); await page.keyboard.press('Escape'); assert.equal(await page.locator('#context-button').evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({ width:1440,height:1000 }); await click('#manage-button'); await click(`[data-delete-session="${initial.sessions[0].id}"]`); await click('#modal-confirm'); assert.ok((await stored()).branches.some(b=>b.id===child)); assert.ok(!(await stored()).branches.some(b=>b.id===parent)); await click('#undo');
  // All background unchecked retains an independent anchor, including across refresh.
  await click(`[data-switch="${parent}"]`); await page.locator('[data-fork]').nth(1).click(); await page.locator('#modal-body details').last().locator('summary').click(); for (const box of await page.locator('[data-context-id]').all()) await box.uncheck(); await page.locator('#fork-prompt').fill('结合我以前聊过的完全平方公式'); await click('#modal-confirm'); assert.equal((await active()).entries.length,0); await page.reload(); await page.locator('#history-gate').waitFor(); await click('[data-skip-history]'); await idle(); assert.equal((await active()).entries.length,2); assert.ok((await active()).selection);
  // A background answer must not replace the current branch's DOM or raw selection.
  mode='hold-chat'; let heldPromise = new Promise(resolve => { holdStarted=resolve; });
  await click('#create'); const background=(await stored()).active; await page.locator('#draft').fill('后台问题'); await click('#send'); let held=await heldPromise;
  await click(`[data-switch="${parent}"]`); await page.locator('[data-raw]').first().click();
  await page.evaluate(() => { window.readingBody=document.querySelector('.message-text'); const range=document.createRange(); range.setStart(window.readingBody.firstChild.firstChild,0); range.setEnd(window.readingBody.firstChild.firstChild,4); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); });
  const selectedBefore=await page.evaluate(()=>window.getSelection().toString()); mode='ok'; held.finish();
  await page.waitForFunction(id => { const s=JSON.parse(localStorage.getItem('learning-branches.v1')); return !s.branches.find(b=>b.id===id).awaiting; },background);
  assert.equal(await page.evaluate(()=>window.readingBody===document.querySelector('.message-text')),true); assert.equal(await page.evaluate(()=>window.getSelection().toString()),selectedBefore);
  // Explicit user metadata wins, including while the very first answer is in flight.
  mode='hold-chat'; heldPromise=new Promise(resolve=>{holdStarted=resolve;}); await click('#create'); await page.locator('#draft').fill('保留我的名称'); await click('#send'); held=await heldPromise;
  await click('#manage-button'); await page.locator('#topic-title').fill('用户标题'); await page.locator('#topic-tags').fill('用户标签'); await click('#modal-confirm'); mode='ok'; held.finish(); await idle(); assert.equal((await active()).title,'用户标题');
  // Editing during metadata generation cancels it; deletion plus undo cannot revive it.
  mode='hold-metadata'; heldPromise=new Promise(resolve=>{holdStarted=resolve;}); await click('#create'); await page.locator('#draft').fill('命名期间编辑'); await click('#send'); held=await heldPromise; await idle();
  await click('#manage-button'); await page.locator('#topic-title').fill('最终用户标题'); await click('#modal-confirm'); await Promise.race([held.closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('manual naming did not cancel metadata')),2000))]); assert.equal((await active()).title,'最终用户标题');
  heldPromise=new Promise(resolve=>{holdStarted=resolve;}); await click('#create'); await page.locator('#draft').fill('删除期间命名'); await click('#send'); held=await heldPromise; await idle(); const deletedNamingId=(await stored()).active;
  await click('#manage-button'); await click('[data-delete-branch]'); await click('#modal-confirm'); await Promise.race([held.closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('deletion did not cancel metadata')),2000))]); await click('#undo'); assert.ok((await stored()).branches.some(b=>b.id===deletedNamingId && b.title==='新的学习问题'));
  // Importing the same IDs cancels outstanding metadata instead of overwriting the backup.
  mode='hold-metadata'; heldPromise=new Promise(resolve=>{holdStarted=resolve;}); await click('#create'); await page.locator('#draft').fill('导入隔离'); await click('#send'); held=await heldPromise; await idle();
  const replacement=await stored(); replacement.branches.find(b=>b.id===replacement.active).title='备份中的标题';
  await click('#settings-button'); await page.locator('#import-file').setInputFiles({name:'same-ids.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replacement))}); await click('#modal-confirm');
  await Promise.race([held.closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('metadata was not cancelled')),2000))]); mode='ok'; assert.deepEqual(await stored(),replacement);
  // Mobile navigation closes before focusing a newly created question.
  await page.setViewportSize({width:390,height:844}); await click('#nav-toggle'); await click('#create'); assert.equal(await page.evaluate(()=>document.body.classList.contains('nav-open')),false); assert.equal(await page.locator('#draft').evaluate(el=>el===document.activeElement),true); assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'),'false'); await screenshot('mobile-new-question');
  await page.setViewportSize({width:1440,height:1000});
  // Legacy v1 remains valid; damaged data is not automatically overwritten.
  const legacy=await stored(); legacy.branches.forEach(b=>{delete b.tags;delete b.method;delete b.metadataDone;}); await page.evaluate(s=>localStorage.setItem('learning-branches.v1',JSON.stringify(s)),legacy); await page.reload(); await page.locator('#draft').waitFor(); assert.deepEqual(await stored(),legacy);
  await page.evaluate(()=>localStorage.setItem('learning-branches.v1','{broken')); await page.reload(); await page.getByText(/无法读取本地记录/).waitFor(); assert.equal(await page.evaluate(()=>localStorage.getItem('learning-branches.v1')),'{broken'); await click('#retry'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(()=>localStorage.getItem('learning-branches.v1')),'{broken'); await click('#retry'); await click('#modal-confirm'); assert.equal((await stored()).branches.length,0);
  // Offline service runs without any key and retains the question without fake answers.
  offline=createServer({base:'http://127.0.0.1:1',key:'',model:'',timeout:100}); const offlineOrigin=await listen(offline); await page.goto(offlineOrigin); await page.locator('[data-new]').waitFor(); await click('[data-new]'); await page.locator('#draft').fill('离线问题不会丢失'); await click('#send'); await page.locator('[data-retry-answer]').waitFor(); assert.equal((await active()).entries.length,1); assert.equal((await active()).entries[0].text,'离线问题不会丢失'); await click('[data-edit-question]'); assert.equal(await page.locator('#draft').inputValue(),'离线问题不会丢失'); await screenshot('offline');
  assert.deepEqual(errors,[]); assert.ok(requests.filter(u=>/^https?:/.test(u)).every(u=>u.startsWith(origin+'/')||u.startsWith(offlineOrigin+'/')));
  console.log('PASS browser: desktop/mobile, Markdown/math/XSS and CRLF/source mapping, repeated selection, context/anchor and history gate, chat/reranking, background selection isolation, metadata edit/delete/import cancellation, cancel/error/retry, deletion/undo, export content/import, quota/corruption/legacy, offline, mobile navigation focus and local network boundary.');
} finally { await browser?.close(); if(app) await stop(app); if(offline) await stop(offline); await stop(upstream); }
