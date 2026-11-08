import {ReadingDeck} from './reading-deck.js';
import {fragmentFace} from './reading-deck-model.js';

export const PAGE_SIZE = 20;
export const BUFFER_SIZE = 12;
export const FIRST_CARD_SIZE = 1;
export const REQUEST_TIMEOUT_MS = 10000;
export const HISTORY_LIMIT = 100;
const PREFETCH_AT = 4;
const ENTRY_KEY = 'personal-reading-entry-v2';
const ENDPOINT = '/api/reading/cards';
const TOPIC_LABELS = Object.freeze({
  life_time: '生活、关系与自我', uncertainty: '判断、风险与财富',
  work_organization: '工作、组织与行动', society_power: '社会、制度与历史',
  technology_information: '技术、系统与信息', fiction_experience: '文学、叙事与经验',
  reading_creation: '阅读、学习与表达', ethics_meaning: '自由、伦理与意义',
});
export const topicLabel = topic => Object.hasOwn(TOPIC_LABELS, topic) ? TOPIC_LABELS[topic] : topic;
const count = value => Number.isSafeInteger(value) && value >= 0;
const string = value => typeof value === 'string';
const key = value => string(value) && value.length > 0 && value.length <= 500;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {throw new Error('Invalid public reading page');};

// Copy only the public DTO. Extra response fields never reach the directory,
// reader, history, or a persistent browser store. Text is preserved verbatim.
export function validatePublicReadingPage(value, {offset = 0, version = '', limit = PAGE_SIZE} = {}) {
  if (!object(value) || !key(value.version) || (version && value.version !== version) ||
    !count(value.snapshotTotal) || !count(value.total) || value.total > value.snapshotTotal ||
    !count(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE || (offset > 0 && !version) || !Array.isArray(value.items) || value.items.length > PAGE_SIZE ||
    !Array.isArray(value.books) || !Array.isArray(value.topics)) invalid();
  if (value.items.length !== Math.min(limit, Math.max(0, value.total - offset)) ||
    (offset > 0 && offset >= value.total)) invalid();
  const next = offset + value.items.length < value.total ? offset + value.items.length : null;
  if (value.nextOffset !== next) invalid();
  const bookIds = new Set(), topicIds = new Set(), cardIds = new Set();
  const books = value.books.map(book => {
    if (!object(book) || !key(book.bookId) || bookIds.has(book.bookId) ||
      !string(book.bookTitle) || !string(book.author) || !count(book.count) || book.count < 1 || book.count > value.snapshotTotal) invalid();
    bookIds.add(book.bookId);
    return {bookId: book.bookId, bookTitle: book.bookTitle, author: book.author, count: book.count};
  });
  if (books.reduce((sum, book) => sum + book.count, 0) !== value.snapshotTotal) invalid();
  const topics = value.topics.map(item => {
    if (!object(item) || !key(item.topic) || topicIds.has(item.topic) ||
      !count(item.count) || item.count < 1 || item.count > value.snapshotTotal) invalid();
    topicIds.add(item.topic);
    return {topic: item.topic, count: item.count};
  });
  const items = value.items.map(item => {
    if (!object(item) || !key(item.id) || cardIds.has(item.id) || !bookIds.has(item.bookId) ||
      !['bookTitle', 'author', 'chapterTitle', 'quoteText', 'thoughtText'].every(field => string(item[field])) ||
      !Array.isArray(item.topics) || !item.topics.every(topic => topicIds.has(topic)) ||
      new Set(item.topics).size !== item.topics.length || item.sourceUrl !== null ||
      !['present', 'unavailable'].includes(item.quoteAvailability) ||
      (item.quoteAvailability === 'present') !== Boolean(item.quoteText.trim())) invalid();
    cardIds.add(item.id);
    return {id: item.id, bookId: item.bookId, bookTitle: item.bookTitle, author: item.author,
      chapterTitle: item.chapterTitle, topics: [...item.topics], quoteText: item.quoteText,
      thoughtText: item.thoughtText, sourceUrl: null, quoteAvailability: item.quoteAvailability};
  });
  return {version: value.version, snapshotTotal: value.snapshotTotal, total: value.total, items, books, topics, nextOffset: next};
}

// Only identifiers and this consumed-entry marker enter browser history. Card
// text stays in this live page, with a deliberately bounded recent trail.
export function randomSeed() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export class PublicReadingDeck extends ReadingDeck {
  constructor() {
    super();
    this.dialog.className += ' public-reading-dialog';
    this.closeButton.textContent = '← 暂时合上';
    this.allButton.textContent = '随便读读';
    this.previous.textContent = '刚才那张';
    this.next.textContent = '再遇见一张';
    this.help.textContent = '全文上下读 · 下方左右换卡';
    this.position.hidden = true;
    this.dots.hidden = true;
    this.tools = document.createElement('div'); this.tools.className = 'public-reader-tools';
    this.graphButton = document.createElement('button'); this.graphButton.type = 'button'; this.graphButton.textContent = '看看关联';
    this.bookButton = document.createElement('button'); this.bookButton.type = 'button'; this.bookButton.textContent = '找一本书';
    this.graphButton.addEventListener('click', () => this.controller?.openGraph(this.graphButton));
    this.bookButton.addEventListener('click', () => this.controller?.openBookSearch(this.bookButton));
    this.tools.append(this.graphButton, this.bookButton);
    this.status = document.createElement('p'); this.status.className = 'public-reader-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.retryButton = document.createElement('button'); this.retryButton.className = 'public-reader-retry';
    this.retryButton.type = 'button'; this.retryButton.textContent = '再试一次'; this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () => this.controller?.retry());
    this.dialog.append(this.tools, this.status, this.retryButton);
    for (const [name, callback] of [['pointerdown', 'startSwipe'], ['pointermove', 'trackSwipe'], ['pointerup', 'endSwipe']]) {
      this.footer.addEventListener(name, event => this[callback](event));
    }
    this.footer.addEventListener('pointercancel', () => {this.gesture = null;});
  }

  // Text is for reading and selection, not a horizontal navigation target.
  startSwipe(event) {
    if (!this.footer.contains(event.target)) return;
    super.startSwipe(event);
  }

  writeHistory(push = false) {
    if (this.state && this.controller) this.state = {...this.state, trailIndex: this.controller.cursor};
    super.writeHistory(push);
  }

  move(delta) {return this.controller?.move(delta);}
  changeScope(scope) {return this.controller?.chooseScope(scope);}
  dismiss() {if (this.controller) this.controller.dismissEpoch++; this.controller?.closeOverlays(); super.dismiss();}

  render(focusTitle) {
    super.render(focusTitle);
    if (!this.state || !this.entries.length) return;
    this.position.textContent = ''; this.position.removeAttribute('aria-label');
    this.dots.replaceChildren();
    for (const top of this.body.querySelectorAll('.fragment-topline')) {
      for (const child of top.children) if (child.tagName === 'SPAN') {child.textContent = ''; child.hidden = true;}
    }
    for (const chip of this.body.querySelectorAll('.topic-chip')) {
      const raw = chip.textContent;
      chip.textContent = topicLabel(raw);
      chip.setAttribute('aria-label', `沿“${topicLabel(raw)}”随机阅读，话题为助理分类`);
    }
    if (this.controller) {
      const saved = history.state?.[this.historyKey];
      if (saved?.activeId === this.state.activeId && this.controller.trail[saved.trailIndex]?.id === this.state.activeId) {
        this.controller.cursor = saved.trailIndex;
      } else if (this.controller.current?.id !== this.state.activeId) {
        const cursor = this.controller.trail.findLastIndex(entry => entry.id === this.state.activeId);
        if (cursor >= 0) this.controller.cursor = cursor;
      }
      this.controller.updateControls();
    }
    const entry = this.entries.find(entry => entry.id === this.state.activeId);
    this.live.textContent = `${this.contextText.textContent}。${fragmentFace(entry, this.face).label}。`;
  }

  clear() {
    this.entries = []; this.state = null; this.body.replaceChildren(); this.dots.replaceChildren();
    this.position.textContent = ''; this.contextText.textContent = '';
  }
}

export class PublicReadingPanel {
  constructor({document: doc = globalThis.document, window: win = globalThis.window,
    fetch: fetcher = globalThis.fetch, deck = new PublicReadingDeck(), seedFactory = randomSeed,
    graphFactory, requestTimeoutMs = REQUEST_TIMEOUT_MS, url = globalThis.location.href, history: navigation = globalThis.history} = {}) {
    this.doc = doc; this.win = win; this.fetcher = fetcher.bind(win || globalThis); this.deck = deck;
    this.deck.controller = this; this.seedFactory = seedFactory;
    this.graphFactory = graphFactory || (async options => {
      const {ReadingGraph} = await import('./reading-graph.js'); return new ReadingGraph(options);
    });
    this.root = doc.getElementById('reading-library');
    this.stateMessage = doc.getElementById('reading-state');
    this.errorMessage = doc.getElementById('reading-error');
    this.loading = doc.getElementById('reading-loading');
    this.reloadButton = doc.getElementById('reading-reload');
    this.epoch = 0; this.dismissEpoch = 0; this.abort = null; this.graphAbort = null; this.graphEpoch = 0;
    this.page = null; this.stream = null; this.pending = false; this.moving = false; this.failure = '';
    this.trail = []; this.cursor = -1; this.seen = new Set(); this.filters = {bookId: '', topic: ''};
    this.catalog = {books: [], topics: []}; this.version = ''; this.graph = null;
    this.requestTimeoutMs = requestTimeoutMs; this.scopeLoading = false; this.moveEpoch = 0;
    this.prefetchTimer = null; this.prefetchFrame = null;
    const entry = new URL(url);
    this.shouldAutoOpen = !navigation.state?.[ENTRY_KEY];
    entry.searchParams.delete('open');
    entry.searchParams.delete('example');
    navigation.replaceState({...navigation.state, [ENTRY_KEY]: true}, '', entry.href);
    this.reloadButton.hidden = true;
    this.reloadButton.addEventListener('click', () => this.retry());
    // Back during the first fetch consumes entry intent too, before a dialog exists.
    win?.addEventListener('popstate', () => {this.dismissEpoch++; this.shouldAutoOpen = false;});
    win?.addEventListener('pagehide', () => {this.dismissEpoch++; this.cancelPrefetch();});
    this.renderLanding();
  }

  node(tag, className, text) {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  renderLanding() {
    this.launch = this.node('button', 'public-reading-launch', '随便读读'); this.launch.type = 'button';
    this.launch.setAttribute('aria-haspopup', 'dialog');
    this.launch.addEventListener('click', () => this.openReader(this.launch));
    this.explore = this.node('button', 'public-reading-explore', '探索关联'); this.explore.type = 'button';
    this.explore.setAttribute('aria-haspopup', 'dialog');
    this.explore.addEventListener('click', async () => {
      await this.openReader(this.explore);
      if (this.current) await this.openGraph(this.deck.graphButton);
    });
    this.root.replaceChildren(this.launch, this.explore); this.root.hidden = false;
  }

  get current() {return this.trail[this.cursor] || null;}
  get hasFuture() {return this.cursor >= 0 && this.cursor < this.trail.length - 1;}
  scopeText() {
    if (this.filters.topic) return `${topicLabel(this.filters.topic)} · 助理分类`;
    if (this.filters.bookId) return this.catalog.books.find(book => book.bookId === this.filters.bookId)?.bookTitle || '沿着这本书';
    return '偶然翻到，慢慢读。';
  }

  updateControls() {
    const available = Boolean(this.current || this.stream?.buffer.length);
    this.root.setAttribute('aria-busy', String(this.pending));
    if (this.loading) {
      this.loading.hidden = !this.pending || available;
      this.loading.setAttribute('aria-busy', String(!this.loading.hidden));
    }
    this.launch.disabled = !available; this.explore.disabled = !available;
    this.reloadButton.disabled = this.pending; this.reloadButton.hidden = !this.failure;
    this.deck.previous.disabled = this.cursor <= 0 || this.moving || this.scopeLoading;
    this.deck.next.disabled = this.moving || this.scopeLoading || (!this.hasFuture && !this.stream?.buffer.length);
    this.deck.body.setAttribute('aria-busy', String(this.scopeLoading));
    this.deck.next.setAttribute('aria-busy', String(this.pending && !this.stream?.buffer.length));
    this.deck.graphButton.disabled = !this.current || this.graphPending;
    this.deck.bookButton.disabled = !this.catalog.books.length;
    this.deck.contextText.textContent = this.scopeText();
    this.deck.allButton.hidden = !this.filters.bookId && !this.filters.topic;
    this.deck.retryButton.hidden = !this.failure;
    this.deck.retryButton.disabled = this.pending;
    this.deck.status.setAttribute('data-loading', String(this.pending));
    this.deck.status.textContent = this.failure || (this.scopeLoading && this.current ? '正在换一段文字，这张可以继续读…'
      : !this.stream?.buffer.length && this.pending ? '正在寻找下一次偶遇…'
      : !this.hasFuture && this.stream?.nextOffset === null && !this.stream.buffer.length && this.current
        ? (this.filters.bookId || this.filters.topic ? '这里的碎片已经遇见过了，可以回到随便读读。' : '这次已经遇见所有公开碎片，刚才读过的仍可回看。') : '');
  }

  announce(text = '', {error = false} = {}) {
    this.failure = error ? text : '';
    this.errorMessage.hidden = !error; this.errorMessage.textContent = error ? text : '';
    this.stateMessage.textContent = error ? '' : text;
    this.updateControls();
  }

  async init() {
    const autoOpen = this.shouldAutoOpen; this.shouldAutoOpen = false;
    await this.load({autoOpen});
  }

  async request({offset = 0, bookId = '', topic = '', version = '', seed = '', limit = BUFFER_SIZE, signal}) {
    const params = new URLSearchParams({limit: String(limit)});
    if (seed) params.set('seed', seed);
    if (offset) params.set('offset', String(offset));
    if (bookId) params.set('bookId', bookId);
    if (topic) params.set('topic', topic);
    if (version) params.set('version', version);
    // A deadline covers both headers and response.json(): a stalled body must not
    // leave the card waiting forever. Scope cancellation also settles noncompliant fetches.
    const controller = new AbortController(); let timer, cancel;
    const interrupted = new Promise((resolve, reject) => {
      cancel = () => {controller.abort(); reject(new DOMException('Reading request cancelled', 'AbortError'));};
      signal?.addEventListener('abort', cancel, {once: true});
      timer = setTimeout(() => {
        const error = new Error('reading_timeout'); error.timeout = true;
        reject(error); controller.abort();
      }, this.requestTimeoutMs);
    });
    try {
      if (signal?.aborted) cancel();
      return await Promise.race([interrupted, (async () => {
        const response = await this.fetcher(`${ENDPOINT}?${params}`, {method: 'GET', credentials: 'omit', cache: 'no-store',
          redirect: 'error', headers: {Accept: 'application/json'}, signal: controller.signal});
        if (response.status === 409) {const error = new Error('version_conflict'); error.conflict = true; throw error;}
        if (!response.ok) {
          let body; try {body = await response.json();} catch { /* The HTTP failure is enough. */ }
          const error = new Error('unavailable'); error.notReady = response.status === 503 && /not_ready$/.test(body?.error || body?.code || ''); throw error;
        }
        const page = validatePublicReadingPage(await response.json(), {offset, version, limit});
        if (page.items.some(item => (bookId && item.bookId !== bookId) || (topic && !item.topics.includes(topic)))) invalid();
        return page;
      })()]);
    } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel);}
  }

  cancelPrefetch() {
    clearTimeout(this.prefetchTimer); this.prefetchTimer = null;
    if (this.prefetchFrame !== null) this.win?.cancelAnimationFrame?.(this.prefetchFrame);
    this.prefetchFrame = null;
  }

  schedulePrefetch(epoch = this.epoch) {
    if (this.prefetchTimer !== null || this.prefetchFrame !== null || this.pending || this.failure ||
      epoch !== this.epoch || !this.stream || this.stream.nextOffset === null || this.stream.buffer.length > PREFETCH_AT) return;
    const queue = () => {
      this.prefetchFrame = null;
      this.prefetchTimer = setTimeout(() => {
        this.prefetchTimer = null;
        if (epoch === this.epoch && this.stream?.buffer.length <= PREFETCH_AT) void this.fill(epoch);
      }, 0);
    };
    // Yield a paint before parsing the larger buffer, not just before awaiting it.
    if (this.win?.requestAnimationFrame) this.prefetchFrame = this.win.requestAnimationFrame(queue);
    else queue();
  }

  async load({bookId = '', topic = '', version = this.version, autoOpen = false, recovered = false} = {}) {
    const epoch = ++this.epoch, presentation = this.dismissEpoch; this.abort?.abort(); this.graphAbort?.abort(); ++this.graphEpoch;
    this.cancelPrefetch(); ++this.moveEpoch; this.moving = false; this.scopeLoading = true; this.scopeFailure = false;
    this.abort = new AbortController(); this.fetchPromise = null; this.graphCards = [];
    this.filters = {bookId, topic};
    this.stream = {seed: this.seedFactory(), buffer: [], nextOffset: 0, version, recovered};
    this.pending = true; this.announce('正在找一段可以停留的文字。');
    await this.fill(epoch, {autoOpen, limit: FIRST_CARD_SIZE});
    if (epoch !== this.epoch) return;
    this.scopeLoading = false; this.scopeFailure = Boolean(this.failure);
    if (this.stream.buffer.length && presentation === this.dismissEpoch && (autoOpen || this.deck.dialog.open)) await this.advance({forceNew: true, trigger: this.doc.getElementById('reading-title')});
    else if (!this.failure && !this.stream.buffer.length) this.announce(this.page?.snapshotTotal ? '这里的碎片这次已经遇见过了。' : '还没有公开的阅读碎片。');
    else if (!this.failure) this.announce();
    this.updateControls();
    this.schedulePrefetch(epoch);
  }

  async fill(epoch = this.epoch, {autoOpen = false, limit = BUFFER_SIZE} = {}) {
    if (!this.stream || this.stream.nextOffset === null || epoch !== this.epoch) return;
    if (this.fetchPromise) return this.fetchPromise;
    const stream = this.stream, presentation = this.dismissEpoch;
    this.pending = true; this.failure = ''; this.updateControls();
    const operation = (async () => {
      try {
        do {
          const page = await this.request({offset: stream.nextOffset, ...this.filters, version: stream.version,
            seed: stream.seed, limit, signal: this.abort.signal});
          if (epoch !== this.epoch) return;
          this.page = page; this.version = page.version; this.catalog = {books: page.books, topics: page.topics};
          stream.version = page.version; stream.nextOffset = page.nextOffset;
          const buffered = new Set(stream.buffer.map(item => item.id));
          for (const item of page.items) if (!this.seen.has(item.id) && !buffered.has(item.id)) {
            stream.buffer.push(item); buffered.add(item.id);
          }
          limit = BUFFER_SIZE;
        } while (!stream.buffer.length && stream.nextOffset !== null);
        if (epoch === this.epoch) this.announce();
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error.conflict && !stream.recovered) {
          this.closeOverlays(); this.moving = false; this.trail = []; this.cursor = -1; this.deck.clear();
          this.version = ''; this.page = null; this.catalog = {books: [], topics: []};
          await this.load({autoOpen: presentation === this.dismissEpoch && (autoOpen || this.deck.dialog.open), version: '', recovered: true});
          if (!this.failure) this.announce('公开阅读库已更新，继续从最新内容偶遇。');
          return;
        }
        if (error.name === 'AbortError') return;
        this.announce(error.timeout ? '这次等待有点久，已读内容仍在。可以再试一次。'
          : error.notReady ? '公开阅读库还未准备好，请稍后再试。'
          : '暂时没能取到新的碎片。已读内容仍在，可以再试一次。', {error: true});
      } finally {
        if (epoch === this.epoch) {this.pending = false; this.fetchPromise = null; this.updateControls();}
      }
    })();
    this.fetchPromise = operation;
    return operation;
  }

  async retry() {
    if (this.pending) return;
    if (!this.stream) return this.load();
    const scopeFailure = this.scopeFailure, epoch = this.epoch, presentation = this.dismissEpoch;
    this.scopeLoading = scopeFailure; this.updateControls();
    await this.fill(this.epoch, {limit: this.stream.nextOffset === 0 ? FIRST_CARD_SIZE : BUFFER_SIZE});
    if (epoch !== this.epoch) return;
    this.scopeLoading = false; this.scopeFailure = scopeFailure && Boolean(this.failure);
    if ((scopeFailure || !this.current) && presentation === this.dismissEpoch && this.deck.dialog.open && this.stream?.buffer.length) await this.advance({forceNew: scopeFailure});
    this.updateControls();
    this.schedulePrefetch();
  }

  async openReader(trigger) {
    if (this.current) {this.deck.open(this.trail, this.current.id, {scope: {kind: 'all'}, trigger}); return;}
    await this.advance({trigger});
  }

  async advance({forceNew = false, trigger} = {}) {
    if (this.moving) return;
    const movement = ++this.moveEpoch; this.moving = true; this.updateControls();
    const epoch = this.epoch, presentation = this.dismissEpoch;
    try {
      if (!forceNew && this.hasFuture) this.cursor++;
      else {
        if (!this.stream?.buffer.length) await this.fill(epoch);
        if (epoch !== this.epoch || presentation !== this.dismissEpoch || !this.stream?.buffer.length) return;
        let card;
        while (this.stream.buffer.length && !card) {
          const candidate = this.stream.buffer.shift();
          if (!this.seen.has(candidate.id)) card = candidate;
        }
        if (!card) return;
        this.seen.add(card.id);
        this.trail.splice(this.cursor + 1);
        this.trail.push(card);
        if (this.trail.length > HISTORY_LIMIT) this.trail.shift();
        this.cursor = this.trail.length - 1;
      }
      this.showCurrent(trigger);
    } finally {
      if (movement === this.moveEpoch) {this.moving = false; this.updateControls();}
      this.schedulePrefetch(epoch);
    }
  }

  showCurrent(trigger) {
    if (!this.current) return;
    this.deck.open(this.trail, this.current.id, {scope: {kind: 'all'},
      trigger: trigger || this.deck.trigger || this.doc.getElementById('reading-title')});
  }

  async move(delta) {
    if (this.moving || this.scopeLoading) return;
    if (delta < 0) {
      if (this.cursor <= 0) return;
      this.cursor--; this.showCurrent(); this.updateControls();
    } else await this.advance();
  }

  chooseScope(scope) {
    if (!scope || !['all', 'book', 'topic'].includes(scope.kind)) return;
    if (scope.kind === 'book' && !this.catalog.books.some(book => book.bookId === scope.value)) return;
    if (scope.kind === 'topic' && !this.catalog.topics.some(item => item.topic === scope.value)) return;
    const bookId = scope.kind === 'book' ? scope.value : '', topic = scope.kind === 'topic' ? scope.value : '';
    if (this.scopeLoading && this.filters.bookId === bookId && this.filters.topic === topic) return this.scopePromise;
    return this.scopePromise = this.load({bookId, topic, autoOpen: true});
  }

  openExact(card) {
    if (!card || !this.graphCards?.some(entry => entry.id === card.id)) return;
    if (this.current?.id === card.id) return;
    this.seen.add(card.id); this.trail.splice(this.cursor + 1); this.trail.push(card);
    if (this.trail.length > HISTORY_LIMIT) this.trail.shift();
    this.cursor = this.trail.length - 1;
    this.stream.buffer = this.stream.buffer.filter(entry => entry.id !== card.id);
    this.showCurrent(); this.updateControls();
  }

  async openGraph(trigger) {
    if (!this.current || this.graphPending) return;
    const current = this.current, epoch = this.epoch, graphEpoch = ++this.graphEpoch;
    this.graphPending = true; this.graphAbort?.abort(); this.graphAbort = new AbortController(); this.updateControls();
    try {
      let related = [], message = '';
      try {
        const page = await this.request({bookId: current.bookId, limit: 4, version: this.version, signal: this.graphAbort.signal});
        related = page.items.filter(item => item.id !== current.id);
      } catch (error) {
        if (error.conflict) {
          if (epoch !== this.epoch || graphEpoch !== this.graphEpoch) return;
          this.closeOverlays(); this.trail = []; this.cursor = -1; this.deck.clear(); this.version = ''; this.page = null;
          await this.load({autoOpen: this.deck.dialog.open, version: '', recovered: true}); return;
        }
        message = '同书碎片暂时未能载入，已知关系仍可查看。';
      }
      if (epoch !== this.epoch || graphEpoch !== this.graphEpoch || this.current?.id !== current.id || !this.deck.dialog.open) return;
      if (!this.graph) this.graph = await this.graphFactory({document: this.doc, onCard: card => this.openExact(card), onScope: scope => this.chooseScope(scope)});
      if (epoch !== this.epoch || graphEpoch !== this.graphEpoch || !this.deck.dialog.open) return;
      this.graphCards = related;
      this.graph.open({current, related, topicLabels: TOPIC_LABELS, trigger, message});
    } catch {this.announce('关联视图暂时打不开，可以继续读，或稍后再试。', {error: true});}
    finally {this.graphPending = false; this.updateControls();}
  }

  openBookSearch(trigger) {
    if (!this.catalog.books.length) return;
    if (!this.searchDialog) {
      const dialog = this.node('dialog', 'public-book-search'); this.searchDialog = dialog;
      const title = this.node('h2', '', '找一本书'); title.id = 'public-book-search-title';
      dialog.setAttribute('aria-labelledby', title.id);
      const close = this.node('button', 'public-book-search-close', '返回阅读'); close.type = 'button';
      close.addEventListener('click', () => this.closeSearch());
      this.searchInput = this.node('input', 'public-book-search-input'); this.searchInput.type = 'search';
      this.searchInput.placeholder = '书名或作者'; this.searchInput.setAttribute('aria-label', '按书名或作者找书');
      this.searchResults = this.node('div', 'public-book-search-results');
      this.searchResults.setAttribute('aria-live', 'polite');
      this.searchInput.addEventListener('input', () => this.renderBookResults());
      dialog.addEventListener('cancel', event => {event.preventDefault(); this.closeSearch();});
      dialog.addEventListener('keydown', event => {
        event.stopPropagation?.();
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation?.(); this.closeSearch(); return;}
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        const buttons = [...this.searchResults.querySelectorAll('button')];
        if (!buttons.length) return;
        if (event.key === 'Enter' && event.target === this.searchInput) {event.preventDefault(); buttons[0].click(); return;}
        if (event.key === 'Enter') return;
        event.preventDefault();
        const position = buttons.indexOf(this.doc.activeElement);
        const next = event.key === 'ArrowDown' ? Math.min(position + 1, buttons.length - 1) : position - 1;
        if (next < 0) this.searchInput.focus(); else buttons[next].focus();
      });
      dialog.append(close, title, this.searchInput, this.searchResults); this.doc.body.append(dialog);
    }
    this.searchTrigger = trigger; this.searchOldOverflow = this.doc.body.style.overflow;
    this.doc.body.style.overflow = 'hidden'; this.searchInput.value = ''; this.renderBookResults();
    this.searchDialog.showModal(); this.searchInput.focus();
  }

  renderBookResults() {
    const query = this.searchInput.value.trim().toLocaleLowerCase();
    const books = this.catalog.books.filter(book => !query || `${book.bookTitle} ${book.author}`.toLocaleLowerCase().includes(query)).slice(0, 12);
    this.searchResults.replaceChildren();
    for (const book of books) {
      const button = this.node('button', 'public-book-result'); button.type = 'button';
      button.append(this.node('span', '', book.bookTitle || '书名未提供'), this.node('small', '', book.author));
      button.addEventListener('click', () => {this.closeSearch(); this.chooseScope({kind: 'book', value: book.bookId});});
      this.searchResults.append(button);
    }
    if (!books.length) this.searchResults.append(this.node('p', 'reading-subtle', '暂时没找到这本书，换个书名或作者试试。'));
    else if (!query) this.searchResults.append(this.node('p', 'reading-subtle', '输入书名或作者，找找想读的那一本。'));
  }

  closeSearch() {
    if (!this.searchDialog?.open) return;
    this.searchDialog.close(); this.doc.body.style.overflow = this.searchOldOverflow || '';
    if (this.searchTrigger?.isConnected) this.searchTrigger.focus({preventScroll: true});
  }
  closeOverlays() {++this.graphEpoch; this.graphAbort?.abort(); this.graph?.close(); this.closeSearch();}
}

if (globalThis.document?.getElementById('reading-library')) new PublicReadingPanel().init();
