import {safeReadingLink} from './reading-model.js';
import {cardTopics, cardTitle, cardHasQuote, cardCanFlip, cardsInScope, selectScope, moveCard, swipeDirection, validScope, fragmentFace} from './reading-deck-model.js';
const el = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
// Decorative artwork is local and explicitly attributed, never a book illustration.
const decorativeIllustrations = new Set([
  '/assets/reading-fragments/thought-sprout.webp',
  '/assets/reading-fragments/cards-paper-plane.webp',
  '/assets/reading-fragments/reading-lamp.webp'
]);
const focusable = 'button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
export class ReadingDeck {
  constructor() {
    this.entries = []; this.state = null; this.trigger = null; this.gesture = null;
    this.face = 'front';
    this.historyKey = 'personal-reading-deck-v1';
    this.pendingClose = false; this.queuedOpen = null;
    // A page reload cannot safely revive an in-memory deck. Clear only our marker.
    if (history.state?.[this.historyKey]) {
      const clean = {...history.state}; delete clean[this.historyKey];
      history.replaceState(clean, '', location.href);
    }
    this.dialog = el('dialog', 'reading-card-dialog fragment-stage');
    this.dialog.setAttribute('aria-labelledby', 'reading-card-title');
    this.dialog.setAttribute('aria-describedby', 'reading-card-help');
    const header = el('header', 'card-reader-header');
    this.closeButton = el('button', 'reader-back', '← 碎片目录'); this.closeButton.type = 'button';
    this.closeButton.addEventListener('click', () => this.close());
    this.position = el('span', 'reader-position');
    header.append(this.closeButton, this.position);
    this.context = el('div', 'reader-context');
    this.contextText = el('span');
    this.allButton = el('button', 'reader-all', '返回全部'); this.allButton.type = 'button';
    this.allButton.addEventListener('click', () => this.changeScope({kind: 'all'}));
    this.context.append(this.contextText, this.allButton);
    this.body = el('div', 'reading-card-body'); this.body.tabIndex = -1;
    this.footer = el('footer', 'reader-controls');
    this.previous = el('button', 'reader-nav', '← 上一张'); this.previous.type = 'button';
    this.next = el('button', 'reader-nav', '下一张 →'); this.next.type = 'button';
    this.previous.addEventListener('click', () => this.move(-1)); this.next.addEventListener('click', () => this.move(1));
    this.help = el('span', 'reader-help', '上下读全文 · 左右换卡'); this.help.id = 'reading-card-help';
    this.dots = el('div', 'fragment-dots');
    const middle = el('div', 'fragment-pagination'); middle.append(this.dots, this.help);
    this.footer.append(this.previous, middle, this.next);
    this.live = el('p', 'reader-sr-only'); this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.dialog.append(header, this.context, this.body, this.footer, this.live);
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => {event.preventDefault(); this.close();});
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const r = this.dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.close();
    });
    this.dialog.addEventListener('keydown', event => this.onKey(event));
    this.body.addEventListener('pointerdown', event => this.startSwipe(event));
    this.body.addEventListener('pointermove', event => this.trackSwipe(event));
    this.body.addEventListener('pointerup', event => this.endSwipe(event));
    this.body.addEventListener('pointercancel', () => {this.gesture = null;});
    window.addEventListener('popstate', event => {
      if (this.pendingClose) {
        this.pendingClose = false;
        const queued = this.queuedOpen; this.queuedOpen = null;
        if (queued) this.open(...queued);
        return;
      }
      const saved = event.state?.[this.historyKey];
      if (saved && this.entries.some(x => x.id === saved.activeId) && validScope(saved.scope)) {
        this.state = selectScope(this.entries, {activeId: saved.activeId}, saved.scope);
        if (!this.dialog.open) this.show();
        this.render(true);
      } else if (this.dialog.open) this.dismiss();
    });
  }
  open(entries, entryId, {scope, trigger = document.activeElement} = {}) {
    if (this.pendingClose) {this.queuedOpen = [entries, entryId, {scope, trigger}]; return;}
    const entry = entries.find(x => x.id === entryId); if (!entry) return;
    this.entries = entries; this.trigger = trigger; this.face = 'front';
    this.state = selectScope(entries, {activeId: entryId}, scope || {kind: 'book', value: entry.bookId});
    const alreadyOpen = this.dialog.open;
    if (!alreadyOpen) this.show();
    this.render(true);
    this.writeHistory(!alreadyOpen);
  }
  show() {
    this.oldBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.dialog.showModal();
  }
  writeHistory(push = false) {
    const saved = {...this.state};
    const historyState = {...history.state, [this.historyKey]: saved};
    // No note contents or source credentials enter the URL or history.
    if (push) history.pushState(historyState, '', location.href);
    else if (history.state?.[this.historyKey]) history.replaceState(historyState, '', location.href);
  }
  close() {
    if (!this.dialog.open) return;
    const ownsHistory = Boolean(history.state?.[this.historyKey]);
    this.pendingClose = ownsHistory;
    this.dismiss();
    if (ownsHistory) history.back();
  }
  dismiss() {
    this.gesture = null;
    this.dialog.close();
    document.body.style.overflow = this.oldBodyOverflow || '';
    if (this.trigger?.isConnected) this.trigger.focus({preventScroll: true});
  }
  move(delta) {
    const next = moveCard(this.entries, this.state, delta);
    if (next.activeId === this.state.activeId) return;
    const keepFocus = document.activeElement === this.previous ? 'previous' : document.activeElement === this.next ? 'next' : null;
    const focusWasInCard = this.body.contains(document.activeElement);
    this.state = next; this.face = 'front'; this.render(focusWasInCard); this.writeHistory();
    // A disabled endpoint must not strand keyboard focus.
    if (keepFocus && this[keepFocus].disabled) this[keepFocus === 'next' ? 'previous' : 'next'].focus({preventScroll: true});
  }
  changeScope(scope) {
    this.state = selectScope(this.entries, this.state, scope); this.face = 'front'; this.render(true); this.writeHistory();
  }
  flip() {
    if (!this.state) return;
    const entry = cardsInScope(this.entries, this.state.scope).find(card => card.id === this.state.activeId);
    if (!cardCanFlip(entry)) {
      this.face = 'front';
      this.render(true);
      return;
    }
    this.face = this.face === 'front' ? 'back' : 'front';
    this.render(true);
  }
  render(focusTitle) {
    const cards = cardsInScope(this.entries, this.state.scope);
    const index = Math.max(0, cards.findIndex(x => x.id === this.state.activeId));
    const entry = cards[index]; if (!entry) return;
    const canFlip = cardCanFlip(entry);
    // Single-sided cards stay on their content, including restored history.
    if (!canFlip) this.face = 'front';
    this.position.textContent = `${index + 1} / ${cards.length}`;
    this.position.setAttribute('aria-label', `第 ${index + 1} 张，共 ${cards.length} 张`);
    const scope = this.state.scope;
    this.contextText.textContent = scope.kind === 'topic' ? `话题 · ${scope.value} · 跨书关联` : scope.kind === 'book' ? entry.bookTitle : '全部阅读碎片';
    this.allButton.hidden = scope.kind === 'all';
    this.previous.disabled = index === 0; this.next.disabled = index === cards.length - 1;
    this.body.replaceChildren(); this.body.scrollTop = 0;
    const stack = el('article', `fragment-stack fragment-${this.face}`);
    const paper = el('div', 'fragment-paper');
    const content = fragmentFace(entry, this.face);
    const faceLabel = content.label;
    const top = el('div', 'fragment-topline');
    const title = el('h2', 'reading-card-title', faceLabel);
    title.id = 'reading-card-title';
    top.append(title, el('span', '', String(index + 1).padStart(2, '0')));
    paper.append(top);

    // Only this inner region scrolls; flip and card navigation remain reachable.
    const scroll = el('div', 'fragment-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', `${faceLabel}全文，可上下滚动 · ${cardTitle(entry)}`);
    scroll.setAttribute('aria-describedby', 'reading-card-help');
    scroll.addEventListener('scroll', () => {if (this.gesture) this.gesture.verticalLocked = true;}, {passive: true});
    const source = el('div', 'fragment-source');
    source.append(el('p', 'fragment-book', [entry.bookTitle ? `《${entry.bookTitle}》` : '书名未提供', entry.author].filter(Boolean).join(' · ')));
    if (entry.chapterTitle) source.append(el('p', 'fragment-chapter', entry.chapterTitle));
    const href = safeReadingLink(entry.sourceUrl);
    if (href) {
      const link = el('a', 'fragment-source-link', cardHasQuote(entry) ? '查看原文出处 ↗' : '查看阅读来源 ↗');
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link);
    }
    scroll.append(source);
    const copy = el('p', content.field === 'thoughtText' ? 'fragment-thought-text' : 'fragment-original-text', content.text);
    if (content.missing) copy.className += ' fragment-missing';
    scroll.append(copy);
    if (this.face === 'front') {
      const showIllustration = decorativeIllustrations.has(entry.illustration) && entry.illustrationOrigin === 'ai_generated_decorative';
      if (showIllustration) {
        const decoration = el('div', 'fragment-decoration');
        const art = el('div', 'fragment-art');
        const img = el('img'); img.src = entry.illustration; img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.width = 1536; img.height = 1024; img.decoding = 'async';
        art.append(img); decoration.append(art, el('p', 'fragment-art-label', 'AI 配图 · 非原书插图')); scroll.append(decoration);
      }
    }
    paper.append(scroll);
    const bottom=el('div','fragment-bottom');
    const topics=el('div','topic-chips');topics.setAttribute('aria-label','关联话题，可跨书查看');
    for(const topic of cardTopics(entry)){
      const count=cardsInScope(this.entries,{kind:'topic',value:topic}).length;
      const button=el('button','topic-chip',topic);button.type='button';button.setAttribute('aria-label',`查看话题“${topic}”的 ${count} 张碎片`);button.setAttribute('aria-pressed',String(scope.kind==='topic'&&scope.value===topic));
      button.addEventListener('click',()=>this.changeScope({kind:'topic',value:topic}));topics.append(button);
    }
    bottom.append(topics);
    if (canFlip) {
      const flip=el('button','fragment-flip',this.face==='front'?'翻到背面 · 看我的想法 ↻':'↶ 回到正面 · 看原文');flip.type='button';flip.setAttribute('aria-label',this.face==='front'?'翻到背面，查看本人想法':'翻回正面，查看原文');flip.addEventListener('click',()=>this.flip());bottom.append(flip);
    }
    paper.append(bottom);stack.append(paper);this.body.append(stack);
    this.dots.replaceChildren();
    const start=Math.max(0,Math.min(index-2,cards.length-5));
    for(let i=start;i<Math.min(start+5,cards.length);i++){
      const dot=el('button','fragment-dot');dot.type='button';dot.setAttribute('aria-label',`查看第 ${i+1} 张碎片`);dot.setAttribute('aria-current',String(i===index));
      dot.addEventListener('click',()=>this.move(i-index));this.dots.append(dot);
    }
    this.live.textContent=`${this.contextText.textContent}。第 ${index+1} 张，共 ${cards.length} 张。${faceLabel}。${cardTitle(entry)}`;
    if(focusTitle)scroll.focus({preventScroll:true});
  }
  onKey(event) {
    if (event.key === 'Tab') {
      const nodes = [...this.dialog.querySelectorAll(focusable)].filter(n => !n.hidden && n.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {event.preventDefault(); this.move(event.key === 'ArrowRight' ? 1 : -1);}
  }
  startSwipe(event) {
    if (event.pointerType !== 'touch' || !event.isPrimary || event.target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
    const scroll = event.target.closest('.fragment-scroll');
    this.gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), scroll, top: scroll?.scrollTop || 0, verticalLocked: false};
  }
  trackSwipe(event) {
    const g = this.gesture; if (!g || g.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - g.x), dy = Math.abs(event.clientY - g.y);
    if ((dy > 8 && dy >= dx * .8) || Math.abs((g.scroll?.scrollTop || 0) - g.top) > 3) g.verticalLocked = true;
  }
  endSwipe(event) {
    const g = this.gesture; this.gesture = null;
    if (!g || g.id !== event.pointerId || !window.getSelection()?.isCollapsed) return;
    const direction = swipeDirection({dx: event.clientX - g.x, dy: event.clientY - g.y, duration: performance.now() - g.at, width: this.body.clientWidth, verticalLocked: g.verticalLocked || Math.abs((g.scroll?.scrollTop || 0) - g.top) > 3});
    if (direction) this.move(direction);
  }
}
