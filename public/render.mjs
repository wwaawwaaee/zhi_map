import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import katex from '/vendor/katex.js';
marked.use({ extensions: [{ name:'math', level:'inline', start:src => { const i = src.search(/\$|\\[([]/); return i < 0 ? undefined : i; }, tokenizer(src) {
  const m = /^(\$\$)([\s\S]+?)\$\$|^(\$)([^\n$]+?)\$|^(\\\()([\s\S]+?)\\\)|^(\\\[)([\s\S]+?)\\\]/.exec(src);
  if (m) return { type:'math', raw:m[0], text:m[2] ?? m[4] ?? m[6] ?? m[8], display:Boolean(m[1] || m[7]) };
} }] });
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const span = (s, start) => `<span data-source-start="${start}">${escapeHTML(s)}</span>`;
function literal(s, start, math = true) {
  if (!math) return span(s, start);
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
  let out = '', cursor = 0;
  for (const m of s.matchAll(pattern)) {
    out += span(s.slice(cursor, m.index), start + cursor);
    const formula = m[1] ?? m[2];
    out += `<span class="math" data-math-start="${start + m.index}" data-math-end="${start + m.index + m[0].length}" title="公式：可通过选择原文展开">${katex.renderToString(formula, { displayMode: Boolean(m[1]), throwOnError: false, trust: false, output: 'html' })}</span>`;
    cursor = m.index + m[0].length;
  }
  return out + span(s.slice(cursor), start + cursor);
}
// Lexer raw lengths give each token its own source interval; never search selected text.
function tokens(list, start = 0) {
  let out = '', cursor = start;
  for (const t of list) {
    const raw = t.raw || '', contentStart = cursor + Math.max(0, raw.indexOf(t.text ?? ''));
    const children = () => t.tokens ? tokens(t.tokens, contentStart) : literal(t.text ?? raw, contentStart);
    switch (t.type) {
      case 'space': out += literal(raw, cursor, false); break;
      case 'heading': out += `<h${t.depth}>${children()}</h${t.depth}>`; break;
      case 'paragraph': out += `<p>${children()}</p>`; break;
      case 'math': out += `<span class="math" data-math-start="${cursor}" data-math-end="${cursor + raw.length}" title="公式：可通过选择原文展开">${katex.renderToString(t.text, { displayMode:t.display, throwOnError:false, trust:false, output:'html' })}</span>`; break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul'; let position = 0;
        out += `<${tag}${t.ordered ? ` start="${Number(t.start) || 1}"` : ''}>`;
        for (const item of t.items) {
          const index = raw.indexOf(item.raw, position); position = index + item.raw.length;
          let lineOffset = cursor + index;
          out += '<li>';
          for (const line of item.raw.split(/(?<=\n)/)) {
            const prefix = line.match(/^\s*(?:[-+*]|\d+[.)])\s+/)?.[0] || line.match(/^\s*/)[0];
            out += tokens(marked.Lexer.lexInline(line.slice(prefix.length)), lineOffset + prefix.length);
            lineOffset += line.length;
          }
          out += '</li>';
        }
        out += `</${tag}>`; break;
      }
      case 'blockquote': {
        out += '<blockquote>'; let position = cursor;
        for (const line of raw.split(/(?<=\n)/)) { const prefix = line.match(/^ {0,3}> ?/)?.[0] || ''; out += tokens(marked.Lexer.lexInline(line.slice(prefix.length)), position + prefix.length); position += line.length; }
        out += '</blockquote>'; break;
      }
      case 'table': {
        out += '<div class="table-scroll"><table>'; let position = cursor, row = 0;
        for (const line of raw.split(/(?<=\n)/)) {
          if (row !== 1 && line.trim()) {
            out += '<tr>'; const pattern = /(?:\\.|[^|])+/g;
            for (const cell of line.matchAll(pattern)) {
              if (!cell[0].trim()) continue;
              const tag = row === 0 ? 'th' : 'td'; out += `<${tag}>${tokens(marked.Lexer.lexInline(cell[0]), position + cell.index)}</${tag}>`;
            }
            out += '</tr>';
          }
          position += line.length; row++;
        }
        out += '</table></div>'; break;
      }
      case 'hr': out += '<hr>'; break;
      case 'strong': out += `<strong>${children()}</strong>`; break;
      case 'em': out += `<em>${children()}</em>`; break;
      case 'del': out += `<del>${children()}</del>`; break;
      case 'codespan': out += `<code>${raw.includes(t.text) ? literal(t.text, contentStart, false) : literal(raw, cursor, false)}</code>`; break;
      case 'code': {
        const start = /^ {0,3}(?:`{3,}|~{3,})/.test(raw) ? raw.indexOf('\n') + 1 : 0;
        out += `<pre><code>${raw.slice(start, start + t.text.length) === t.text ? literal(t.text, cursor + start, false) : literal(raw, cursor, false)}</code></pre>`; break;
      }
      case 'link': out += `<a href="${escapeHTML(t.href)}" target="_blank" rel="noreferrer">${children()}</a>`; break;
      case 'text': out += t.tokens ? children() : literal(raw, cursor); break;
      case 'br': out += `<br>${span(raw, cursor)}`; break;
      default: out += `<span class="source-format">${literal(raw, cursor)}</span>`;
    }
    cursor += raw.length;
  }
  return out;
}
export function renderMarkdown(source) {
  return DOMPurify.sanitize(tokens(marked.lexer(source)), { ADD_ATTR:['target'], FORBID_TAGS:['img','style','input','form'] });
}
