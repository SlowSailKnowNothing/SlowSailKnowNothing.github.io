// Pure, public-only card navigation. No storage, network, or private-data access.
export const cardTopics = entry => [...new Set((entry.topics || []).map(x => x.trim()).filter(Boolean))];
export const cardHasThought = entry => typeof entry?.thoughtText === 'string' && Boolean(entry.thoughtText.trim());
export const cardHasQuote = entry => typeof entry?.quoteText === 'string' && Boolean(entry.quoteText.trim());
export const cardCanFlip = entry => cardHasQuote(entry) && cardHasThought(entry);
// Compatibility name: this is a factual source label, never a generated title.
export function cardTitle(entry) {
  return [entry.bookTitle ? `《${entry.bookTitle}》` : '书名未提供', entry.author, entry.chapterTitle].filter(Boolean).join(' · ');
}
export function cardPreview(entry) {
  const text = fragmentFront(entry).text.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(text);
  return chars.length > 90 ? chars.slice(0, 90).join('') + '…' : text;
}
export function cardsInScope(entries, scope = {kind: 'all'}) {
  if (scope.kind === 'book') return entries.filter(x => x.bookId === scope.value);
  if (scope.kind === 'topic') return entries.filter(x => cardTopics(x).includes(scope.value));
  return entries;
}
export function selectScope(entries, state, scope) {
  const cards = cardsInScope(entries, scope);
  if (!cards.length) return state;
  return {scope: {...scope}, activeId: cards.some(x => x.id === state?.activeId) ? state.activeId : cards[0].id};
}
export function moveCard(entries, state, delta) {
  const cards = cardsInScope(entries, state.scope);
  if (!cards.length) return state;
  const current = Math.max(0, cards.findIndex(x => x.id === state.activeId));
  const next = Math.max(0, Math.min(cards.length - 1, current + delta));
  return {...state, activeId: cards[next].id};
}
export function swipeDirection({dx, dy, duration, width = 360, verticalLocked = false}) {
  if (verticalLocked || duration > 700 || duration < 0 || ![dx, dy, duration, width].every(Number.isFinite)) return 0;
  const threshold = Math.min(100, Math.max(48, width * .18));
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.7) return 0;
  return dx < 0 ? 1 : -1;
}
export function validScope(scope) {
  return scope?.kind === 'all' || (['book', 'topic'].includes(scope?.kind) && typeof scope.value === 'string');
}
export function fragmentFront(entry) {
  // Select actual content without relabelling a reflection as a quotation.
  // Preserve the supplied text byte-for-byte, including whitespace.
  if (cardHasQuote(entry)) return {field: 'quoteText', label: '原文', text: entry.quoteText, truncated: false, missing: false};
  if (cardHasThought(entry)) return {field: 'thoughtText', label: '本人想法', text: entry.thoughtText, truncated: false, missing: false};
  return {field: null, label: '阅读碎片', text: '暂时没有公开内容', truncated: false, missing: true};
}
export function fragmentFace(entry, face = 'front') {
  if (face === 'back' && cardCanFlip(entry)) return {field: 'thoughtText', label: '本人想法', text: entry.thoughtText, truncated: false, missing: false};
  return fragmentFront(entry);
}
// Legacy utility only. The reader renders complete text in one scroll region.
export function fragmentPages(text, limit = 130) {
  const chars = Array.from(text || '暂时没有这部分记录。');
  const pages = [];
  for(let start = 0; start < chars.length;) {
    let end = Math.min(start + limit, chars.length);
    if(end < chars.length) for(let i=end-1; i>start+limit*.6; i--) if(/[。！？\n]/u.test(chars[i])) {end=i+1;break;}
    pages.push(chars.slice(start,end).join(''));start=end;
  }
  return pages;
}
