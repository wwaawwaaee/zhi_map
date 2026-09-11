import type { Selection } from '@zhijing/domain';

export function readSelection(selection: globalThis.Selection, container: Element): Selection {
  if (selection.isCollapsed || selection.rangeCount !== 1) throw new Error('请先在一条消息正文中选择文字。');
  const range = selection.getRangeAt(0);
  const bodyOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>('.message-text');
  const body = bodyOf(range.startContainer), endBody = bodyOf(range.endContainer);
  if (!body || body !== endBody || !container.contains(body)) throw new Error('不能跨多个消息框选；请只选择一条消息的正文。');
  if (body.closest('[data-kind]')?.getAttribute('data-kind') !== 'message') throw new Error('引用快照不能作为展开截点。');
  const offset = (node: Node, amount: number) => {
    const leaf = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>('[data-source-start]');
    if (!leaf || !body.contains(leaf)) throw new Error('公式请使用“选择原文”精确选取。');
    const partial = document.createRange(); partial.selectNodeContents(leaf); partial.setEnd(node, amount);
    return Number(leaf.dataset.sourceStart) + partial.toString().length;
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset), source = body.dataset.source!;
  if (end <= start || end > source.length) throw new Error('无法确定选区范围，请重新选择。');
  return { entryId: body.closest<HTMLElement>('[data-entry]')!.dataset.entry!, start, end, text: source.slice(start, end) };
}

export function restoreSelection(body: HTMLElement, start: number, end: number) {
  body.replaceChildren(document.createTextNode(body.dataset.source!)); body.classList.add('raw-source');
  const node = body.firstChild!; const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
}
