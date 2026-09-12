import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#connection').getByText('离线模式').waitFor();

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
  await page.locator('#modal-confirm').click();
  await page.locator('#chat-header h1').getByText('为什么平方项总是非负？').waitFor();

  await page.locator('#refresh').click();
  await page.locator('#create').click();
  await page.locator('#chat-header h1').getByText('新的学习问题').waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: join('test-results', 'browser-smoke.png'), fullPage: true });
} finally {
  await browser.close();
}
