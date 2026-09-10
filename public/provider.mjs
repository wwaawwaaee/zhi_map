// Replaceable local provider. These are vocabulary rules, NOT semantic retrieval or AI.
export const providerNotice = '本地规则建议：关键词 / 别名匹配，非 AI 概括或真实语义检索';
const vocabulary = [
  ['二次函数', /二次函数|顶点|抛物线/], ['配方法', /配方|完全平方|平方公式/],
];
export function normalizeTags(tags, existing = []) {
  const canonical = raw => {
    const text = String(raw).normalize('NFKC').trim().replace(/\s+/g, ' ');
    return text;
  };
  const pool = new Map(existing.map(canonical).filter(Boolean).map(t => [t.toLowerCase(), t]));
  const result = new Map();
  for (const raw of tags) {
    const tag = canonical(raw), key = tag.toLowerCase();
    if (!tag) continue;
    if (!pool.has(key)) pool.set(key, tag);
    result.set(key, pool.get(key));
  }
  return [...result.values()];
}
export function suggestMetadata(quote, prompt, existing = []) {
  const text = `${prompt}\n${quote}`;
  const tags = normalizeTags(vocabulary.filter(([, rule]) => rule.test(text)).map(([tag]) => tag), existing);
  const subject = prompt.trim().replace(/\s+/g, ' ').slice(0, 36);
  return { title: subject || quote.trim().slice(0, 36) || '新的探索', tags, method: 'local-rules-v1' };
}
export function historyIntent(text) {
  return /(?:结合|参考|引用|联系|根据|沿用|回顾|对比).{0,20}(?:之前|以前|上次|历史|聊过)|(?:之前|以前|上次).{0,16}(?:聊过|讨论过|会话|谈过)/i.test(text);
}
export function matchTopics(branches, target) {
  const query = normalizeTags([...(target.tags || []), ...suggestMetadata(target.selection?.text || '', `${target.pendingPrompt || ''} ${target.title}`).tags]);
  return branches.filter(b => b.id !== target.id).map(b => {
    const tags = normalizeTags(b.tags || []);
    const shared = query.filter(t => tags.includes(t));
    return { id: b.id, title: b.title, score: shared.length, reason: `共同规则标签：${shared.join('、')}` };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}
