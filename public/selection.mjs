// Raw source selection uses UTF-16 offsets, matching String.slice. No text search.
export function readSelection(selection, container) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) throw new Error('请先在一条消息正文中选择文字。');
  const range = selection.getRangeAt(0);
  const bodyOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('.message-text');
  const body = bodyOf(range.startContainer), endBody = bodyOf(range.endContainer);
  if (!body || body !== endBody || !container.contains(body)) throw new Error('不能跨多个消息框选；请只选择一条消息的正文。');
  if (body.closest('.message').dataset.kind !== 'message') throw new Error('请在消息正文中选择，引用快照不能作为展开截点。');
  const offset = (node, n) => {
    const leaf = (node.nodeType === 1 ? node : node.parentElement).closest('[data-source-start]');
    if (!leaf || !body.contains(leaf)) throw new Error('公式或格式边界请使用「选择原文」，可精确选取任意范围。');
    const prefix = document.createRange(); prefix.selectNodeContents(leaf); prefix.setEnd(node, n);
    const renderedOffset = Number(leaf.dataset.sourceStart) + prefix.toString().length;
    if (body.classList.contains('raw-source')) return renderedOffset;
    // Marked normalizes CRLF before lexing; map its offsets back to the stored original.
    let original = 0;
    for (let i = 0; i < renderedOffset; i++, original++) {
      if (body.dataset.source[original] === '\r' && body.dataset.source[original + 1] === '\n') original++;
    }
    return original;
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  const source = body.dataset.source;
  if (end <= start || end > source.length) throw new Error('无法确定选区范围，请重新选择。');
  return { entryId: body.closest('.message').id.slice(6), start, end, text: source.slice(start, end) };
}
export function restoreSelection(body, start, end) {
  // Return in source mode, so even Markdown delimiter and math offsets are exact.
  const source = body.dataset.source;
  body.replaceChildren(); const leaf = document.createElement('span'); leaf.dataset.sourceStart = '0'; leaf.textContent = source; body.append(leaf); body.classList.add('raw-source');
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node, offset = 0, a, b;
  while ((node = walker.nextNode())) {
    const length = node.textContent.length;
    if (!a && start <= offset + length) a = [node, start - offset];
    if (!b && end <= offset + length) b = [node, end - offset];
    offset += length;
  }
  if (!a || !b) throw new Error('原文范围已失效。');
  const range = document.createRange(); range.setStart(...a); range.setEnd(...b);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
