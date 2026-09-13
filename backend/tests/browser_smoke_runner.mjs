import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.argv[2];
const chrome = process.env.CHROME_PATH ?? [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find(existsSync);
if (!url || !chrome || !existsSync(chrome)) throw new Error('Set CHROME_PATH to a Chrome or Chromium executable.');

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const snapshotRequests = [], sizes = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/workspace') snapshotRequests.push(request.url()); });
  page.on('response', async response => { if (/\/api\/(workspace\/view|topics|branches\/|workspace\/actions)/.test(response.url())) { try { const body = await response.body(); sizes.push(body.length); } catch {} } });
  const current = () => page.evaluate(async () => { const view = await (await fetch('/api/workspace/view')).json(); const branch = await (await fetch(`/api/branches/${view.active}`)).json(); const entries = await (await fetch(`/api/branches/${view.active}/entries?limit=40`)).json(); return { ...branch, entries: entries.items }; });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#connection').getByText('本地分页存储').waitFor();

  await page.locator('[data-sample]').click();
  const assistant = page.locator('article.message.assistant').first();
  await assistant.locator('[data-source-start]').filter({ hasText: '平方项总是非负' }).evaluate((element) => {
    const text = element.textContent ?? '';
    const start = text.indexOf('平方项总是非负');
    if (start < 0) throw new Error('Expected sample text is missing');
    const range = document.createRange();
    range.setStart(element.firstChild, start);
    range.setEnd(element.firstChild, start + '平方项总是非负'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.locator('#expand-selection').click();
  await page.locator('#fork-prompt').fill('为什么平方项总是非负？');
  await page.locator('#modal-body summary').filter({ hasText: '继承背景' }).click();
  for (const checkbox of await page.locator('[data-context-id]').all()) await checkbox.uncheck();
  await page.locator('#modal-confirm').click();
  await page.locator('#chat-header h1').getByText('为什么平方项总是非负？').waitFor();
  const child = await current();
  if (child.selection.text !== '平方项总是非负' || child.entries.some(e => e.inherited)) throw new Error('Selection anchor or cancelled background was lost');
  await page.locator('[data-return]').click();
  await page.locator('#chat-header h1').getByText('二次函数：从配方看见顶点').waitFor();
  await page.waitForFunction(() => window.getSelection()?.toString() === '平方项总是非负');

  await page.locator('#refresh').click();
  await page.locator('#create').click();
  await page.locator('#chat-header h1').getByText('新的学习问题').waitFor();
  for (const family of ['openai', 'anthropic', 'gemini']) {
    await page.locator('#settings-button').click();
    await page.locator('#ai-provider').selectOption(family);
    await page.locator('#ai-base-url').fill(`${url}/mock`);
    await page.locator('#ai-model').fill('test-model');
    await page.locator('#ai-key').fill('test-secret');
    await page.locator('#save-ai-config').click();
    await page.locator('#ai-settings-feedback').getByText('已保存。密钥不会再次显示。').waitFor();
    const configuredFamily = await page.evaluate(async () => (await (await fetch('/api/ai/config')).json()).provider);
    if (configuredFamily !== family) throw new Error(`Provider choice was overwritten: ${configuredFamily} != ${family}`);
    await page.locator('#close-modal').click();
    await page.locator('#draft').fill(`stream ${family}`);
    await page.locator('#send').click();
    await page.locator('#stream-output').getByText('增量😀', { exact: false }).waitFor();
    await page.locator('[data-cancel]').click();
    await page.locator('[data-retry-answer]').waitFor();
    if (family === 'openai') {
      await page.locator('[data-edit-question]').click();
      await page.waitForFunction(() => document.querySelector('#draft')?.value === 'stream openai');
      await page.locator('#send').click();
      await page.locator('#stream-output').getByText('增量😀', { exact: false }).waitFor();
      await page.locator('[data-cancel]').click();
      await page.locator('[data-retry-answer]').waitFor();
    }
    await page.locator('[data-retry-answer]').click();
    await page.locator('#stream-output').getByText('增量😀', { exact: false }).waitFor();
    await page.locator('#request-status').waitFor({ state: 'hidden' });
    const branch = await current();
    if (branch.entries.filter(e => e.role === 'assistant').length !== ['openai', 'anthropic', 'gemini'].indexOf(family) + 1) throw new Error('Cancelled or late answer was persisted');
  }
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('article.message.assistant[data-entry]').count() !== 3) throw new Error('Restart/reload lost answers');
  await page.locator('#related-button').click();
  await page.locator('.reference-choice').first().locator('input[type=checkbox]').check();
  await page.locator('.reference-choice').first().locator('details').evaluate(el => el.open = true);
  await page.locator('.reference-choice').first().locator('[data-end]').fill('4');
  await page.locator('#modal-confirm').click();
  await page.locator('article.reference').waitFor();
  const reference = (await current()).entries.find(e => e.kind === 'reference');
  if (reference.text.length !== 4) throw new Error('Partial reference was not preserved');
  await page.locator('article.reference [data-jump]').click();
  await page.locator('#chat-header h1').getByText('二次函数：从配方看见顶点').waitFor();
  await page.waitForFunction(text => window.getSelection()?.toString() === text, reference.text);
  await page.locator('#create').click();
  await page.locator('#chat-header h1').getByText('新的学习问题').waitFor();
  const backgroundRun = (await current()).id;
  await page.locator('#draft').fill('background generation');
  await page.locator('#send').click();
  await page.locator('#stream-output').getByText('增量😀', { exact: false }).waitFor();
  await page.locator(`[data-switch="${child.parent.branchId}"]`).click();
  await page.locator('#chat-header h1').getByText('二次函数：从配方看见顶点').waitFor();
  await page.locator('#draft').fill('draft on another branch');
  await page.waitForFunction(async id => !(await (await fetch(`/api/branches/${id}`)).json()).awaiting, backgroundRun);
  if (await page.locator('#draft').inputValue() !== 'draft on another branch') throw new Error('Background completion changed active draft');
  if (!(await page.locator('#chat-header h1').textContent()).includes('二次函数')) throw new Error('Background completion changed active branch');
  await mkdir('test-results', { recursive: true });
  const records = [{ type: 'manifest', schemaVersion: 3, active: 'large-0' }, { type: 'session', data: { id: 'large-session', title: 'Large history' } }];
  for (let b = 0; b < 100; b++) records.push({ type: 'branch', data: { id: `large-${b}`, sessionId: 'large-session', title: `Large ${b}`, tags: [], parent: null, kept: false, draft: '' } });
  for (let b = 0; b < 100; b++) for (let e = 0; e < 100; e++) records.push({ type: 'entry', branchId: `large-${b}`, data: { id: `large-${b}-${e}`, kind: 'message', role: e % 2 ? 'assistant' : 'user', text: `Large text 😀 ${b}/${e}`, inherited: false, source: { sessionId: 'large-session', sessionTitle: 'Large history', branchId: `large-${b}`, branchTitle: `Large ${b}`, messageId: `large-${b}-${e}` } } });
  records.push({ type: 'end', entries: 10000 });
  const fixture = join('test-results', 'large.ndjson');
  await writeFile(fixture, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  await page.locator('#settings-button').click();
  await page.locator('#import-ndjson').setInputFiles(fixture);
  await page.locator('#transfer-progress').getByText('已导入 10000 条消息。').waitFor();
  await page.locator('#close-modal').click();
  await page.locator('#chat-header h1').getByText('Large 0', { exact: true }).waitFor();
  if (await page.locator('#messages [data-entry]').count() > 40 || await page.locator('#tree [data-switch]').count() > 40) throw new Error('DOM window is not bounded');
  await page.locator('#messages').getByRole('button', { name: '下一页' }).click();
  await page.locator('#messages [data-entry="large-0-40"]').waitFor();
  if (await page.locator('#messages [data-entry]').count() !== 40) throw new Error('Message paging failed');
  await page.locator('#related-button').click();
  await page.getByLabel('搜索来源主题').fill('Large 99');
  await page.locator('#source-select option[value="large-99"]').waitFor({ state: 'attached' });
  await page.locator('#source-select').selectOption('large-99');
  await page.locator('.reference-choice').first().locator('input[type=checkbox]').check();
  await page.locator('#modal-body').getByRole('button', { name: '下一页' }).last().click();
  await page.locator('.reference-choice[data-entry="large-99-40"]').waitFor();
  await page.locator('.reference-choice').first().locator('input[type=checkbox]').check();
  await page.getByText('已选 2 / 100 条', { exact: false }).waitFor();
  if (await page.locator('.reference-choice').count() > 40) throw new Error('Reference dialog unbounded');
  await page.locator('#modal-body').getByRole('button', { name: '上一页' }).last().click();
  await page.locator('.reference-choice[data-entry="large-99-0"]').waitFor();
  if (!await page.locator('.reference-choice').first().locator('input[type=checkbox]').isChecked()) throw new Error('Cross-page reference selection lost');
  await page.keyboard.press('Escape');
  if (!await page.locator('#related-button').evaluate(e => document.activeElement === e)) throw new Error('Dialog focus was not restored');
  // Dirty drafts survive stream completion and failed flush prevents navigation.
  await page.locator('#draft').fill('preserved draft');
  await page.route('**/api/workspace/actions?response=compact', route => {
    if (route.request().postDataJSON().type === 'draft') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'draft disk failure' }) });
    return route.continue();
  });
  await page.locator('[data-switch="large-1"]').click();
  await page.locator('#notice').getByText('draft disk failure').waitFor();
  if (await page.locator('#draft').inputValue() !== 'preserved draft') throw new Error('Failed flush lost draft');
  await page.unroute('**/api/workspace/actions?response=compact');
  for (let b = 1; b <= 10; b++) {
    await page.locator(`[data-switch="large-${b}"]`).click();
    await page.locator('#chat-header h1').getByText(`Large ${b}`, { exact: true }).waitFor();
    const limits = await page.locator('[data-cache-pages]').evaluate(e => ({ pages: Number(e.dataset.cachePages), entries: Number(e.dataset.cacheEntries) }));
    if (limits.pages > 8 || limits.entries > 320) throw new Error(`Cache unbounded: ${JSON.stringify(limits)}`);
  }
  await page.locator('[data-switch="large-0"]').click();
  await page.locator('#draft').getAttribute('id');
  await page.waitForFunction(() => document.querySelector('#draft')?.value === 'preserved draft');
  await page.locator('#manage-button').click();
  await page.getByLabel('确认删除（独立子分支保留）').check();
  await page.locator('[data-delete-branch]').click();
  await page.locator('#undo').click();
  await page.locator('#chat-header h1').getByText('Large 0', { exact: true }).waitFor();
  await page.locator('#settings-button').click();
  const downloading = page.waitForEvent('download');
  await page.getByText('流式导出 NDJSON').click();
  const download = await downloading;
  const backup = join('test-results', 'large-export.ndjson');
  await download.saveAs(backup);
  if ((await readFile(backup, 'utf8')).trim().split('\n').length !== 10103) throw new Error('Large backup incomplete');
  await page.locator('#close-modal').click();
  if (errors.length) throw new Error(errors.join('\n'));
  if (snapshotRequests.length) throw new Error(`UI requested full snapshots: ${snapshotRequests.length}`);
  if (Math.max(...sizes) > 100000) throw new Error(`Unbounded normal response: ${Math.max(...sizes)}`);
  console.log(`Browser: selection/expand, exact source return, partial reference, 3 protocols, stream/cancel/retry/reload, failed draft flush, token undo, 100 topics/10000 entries passed. snapshot_requests=0 max_normal_response_bytes=${Math.max(...sizes)} cache_pages<=8 cache_entries<=320 DOM_rows<=40.`);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: join('test-results', 'browser-smoke.png'), fullPage: true });
} finally {
  await browser.close();
}
