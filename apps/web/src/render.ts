import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export const escapeHTML = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const span = (text: string, start: number) => `<span data-source-start="${start}">${escapeHTML(text)}</span>`;

function inline(source: string, start: number) {
  let html = '', cursor = 0;
  const math = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
  for (const match of source.matchAll(math)) {
    const index = match.index!;
    html += text(source.slice(cursor, index), start + cursor);
    html += `<span class="math" data-math-start="${start + index}" data-math-end="${start + index + match[0].length}">${katex.renderToString(match[1] ?? match[2]!, { displayMode: Boolean(match[1]), throwOnError: false, trust: false })}</span>`;
    cursor = index + match[0].length;
  }
  return html + text(source.slice(cursor), start + cursor);
}
function text(source: string, start: number) {
  // Keep source offsets on every visible leaf; marker characters deliberately remain unselectable.
  let html = '', cursor = 0;
  const emphasis = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of source.matchAll(emphasis)) {
    const index = match.index!; html += span(source.slice(cursor, index), start + cursor);
    if (match[1]) html += `<strong>${span(match[1], start + index + 2)}</strong>`;
    else if (match[2]) html += `<code>${span(match[2], start + index + 1)}</code>`;
    else html += `<a href="${escapeHTML(match[4])}" target="_blank" rel="noreferrer">${span(match[3], start + index + 1)}</a>`;
    cursor = index + match[0].length;
  }
  return html + span(source.slice(cursor), start + cursor);
}

export function renderMarkdown(source: string) {
  let offset = 0;
  const html = source.split(/(?<=\n)/).map((line) => {
    const start = offset; offset += line.length;
    const trimmed = line.replace(/\n$/, '');
    const heading = /^(#{1,3})\s+/.exec(trimmed);
    if (heading) { const content = trimmed.slice(heading[0].length); return `<h${heading[1].length}>${inline(content, start + heading[0].length)}</h${heading[1].length}>`; }
    if (/^\s*[-*]\s+/.test(trimmed)) { const prefix = trimmed.match(/^\s*[-*]\s+/)![0]; return `<ul><li>${inline(trimmed.slice(prefix.length), start + prefix.length)}</li></ul>`; }
    if (/^>\s?/.test(trimmed)) { const prefix = trimmed.match(/^>\s?/)![0]; return `<blockquote>${inline(trimmed.slice(prefix.length), start + prefix.length)}</blockquote>`; }
    return trimmed ? `<p>${inline(trimmed, start)}</p>` : '';
  }).join('');
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-source-start', 'data-math-start', 'data-math-end', 'target'], FORBID_TAGS: ['img', 'style', 'form', 'input'] });
}
