import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {cardHasQuote, cardHasThought, cardCanFlip, cardPreview, fragmentFront, fragmentFace} from '../public/assets/reading-deck-model.js';
import {ReadingDeck} from '../public/assets/reading-deck.js';
import {PublicReadingDeck, PublicReadingPanel} from '../public/assets/reading.js';
import {ReadingGraph, buildReadingGraphModel} from '../public/assets/reading-graph.js';

// Synthetic records stay in tests, never in a public asset or API fallback.
const item = (id = 'test-card', changes = {}) => ({id, bookId: 'test-book', bookTitle: '测试书', author: '测试作者',
  chapterTitle: '测试章节', quoteText: '测试原文。', thoughtText: '测试想法。', topics: ['reading_creation'],
  sourceUrl: null, quoteAvailability: 'present', ...changes});
const reflection = (id = 'reflection', changes = {}) => item(id, {quoteText: '', thoughtText: '  我的想法。\n另一个段落。  ', quoteAvailability: 'unavailable', ...changes});
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const withClass = (node, name) => descendants(node).filter(child => (child.className || '').split(' ').includes(name));
const first = (node, name) => withClass(node, name)[0];

// Deliberately small DOM adapter: verifies rendered content, callbacks, focus,
// and history without a browser dependency. It does not simulate CSS layout.
class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.doc = doc; this.children = []; this.handlers = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.value = ''; this._text = ''; this.style = {}; this.open = false;
    this.scrollTop = 0; this.clientWidth = 360;
  }
  set textContent(value) {this.replaceChildren(); this._text = String(value);}
  get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
  append(...nodes) {for (const node of nodes) {node.parent = this; this.children.push(node);}}
  replaceChildren(...nodes) {for (const node of this.children) node.parent = null; this.children = []; this._text = ''; this.append(...nodes);}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  getAttribute(key) {return this.attributes[key];}
  removeAttribute(key) {delete this.attributes[key];}
  addEventListener(name, callback) {(this.handlers[name] ??= []).push(callback);}
  fire(name, event = {}) {for (const callback of this.handlers[name] || []) callback({target: this, preventDefault() {}, stopPropagation() {}, ...event});}
  click() {if (!this.disabled) this.fire('click');}
  focus() {if (!this.disabled) this.doc.activeElement = this;}
  showModal() {this.open = true;}
  close() {this.open = false;}
  get isConnected() {return this === this.doc.body || Boolean(this.parent?.isConnected);}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  getClientRects() {return this.hidden ? [] : [{}];}
  getBoundingClientRect() {return {left: 0, top: 0, right: 400, bottom: 800};}
  closest(selector) {
    for (let node = this; node; node = node.parent) for (const value of selector.split(',').map(value => value.trim())) {
      if (value.startsWith('.') && (node.className || '').split(' ').includes(value.slice(1))) return node;
      if (value.toUpperCase() === node.tagName) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    if (selector.startsWith('.')) return withClass(this, selector.slice(1));
    if (selector === 'button') return descendants(this).filter(node => node.tagName === 'BUTTON');
    return descendants(this).filter(node => (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !node.disabled) || node.tabIndex >= 0);
  }
}
const mountedPanels = [];
afterEach(() => {
  for (const panel of mountedPanels.splice(0)) {panel.cancelPrefetch(); panel.abort?.abort(); panel.graphAbort?.abort();}
  for (const key of ['document', 'window', 'history', 'location']) delete globalThis[key];
});
function mount({Deck = ReadingDeck, search = ''} = {}) {
  const events = {}, ids = {};
  const doc = {createElement: tag => new Node(tag, doc), getElementById: id => ids[id] || null};
  doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  const win = {addEventListener(name, callback) {(events[name] ??= []).push(callback);}, getSelection: () => ({isCollapsed: true})};
  Object.assign(globalThis, {document: doc, window: win, location: new URL(`https://example.test/reading${search}`)});
  const stack = [{state: {}, url: location.href}]; let index = 0, pending = null;
  globalThis.history = {
    get state() {return stack[index].state;},
    replaceState(state, unused, url = location.href) {stack[index] = {state, url: new URL(url, location.href).href}; globalThis.location = new URL(stack[index].url);},
    pushState(state, unused, url = location.href) {stack.splice(index + 1); stack.push({state, url: new URL(url, location.href).href}); index++; globalThis.location = new URL(stack[index].url);},
    back() {pending = Math.max(0, index - 1);}, forward() {pending = Math.min(stack.length - 1, index + 1);},
  };
  for (const id of ['reading-library', 'reading-loading', 'reading-state', 'reading-error', 'reading-reload', 'reading-title']) {
    ids[id] = doc.createElement(id === 'reading-reload' ? 'button' : 'div'); ids[id].id = id; doc.body.append(ids[id]);
  }
  const deck = new Deck();
  return {deck, doc, win, ids, stack,
    flush() {if (pending !== null) {index = pending; pending = null; globalThis.location = new URL(stack[index].url); for (const callback of events.popstate || []) callback({state: stack[index].state});}},
  };
}
function mountPanel(cards, options = {}) {
  const env = mount({Deck: PublicReadingDeck, ...options}), calls = [];
  const books = [...new Set(cards.map(card => card.bookId))].map(bookId => {
    const entries = cards.filter(card => card.bookId === bookId), card = entries[0];
    return {bookId, bookTitle: card.bookTitle, author: card.author, count: entries.length};
  });
  const topics = [...new Set(cards.flatMap(card => card.topics))].map(topic => ({topic, count: cards.filter(card => card.topics.includes(topic)).length}));
  const panel = new PublicReadingPanel({document: env.doc, window: env.win, deck: env.deck, seedFactory: () => 'test-seed',
    graphFactory: async options => new ReadingGraph(options), fetch: async (url, options) => {
      calls.push({url, options});
      const params = new URL(url, location).searchParams, offset = Number(params.get('offset') || 0), limit = Number(params.get('limit'));
      const filtered = cards.filter(card => (!params.has('bookId') || params.get('bookId') === card.bookId) && (!params.has('topic') || card.topics.includes(params.get('topic'))));
      return {ok: true, status: 200, json: async () => ({version: 'test-version', snapshotTotal: cards.length, total: filtered.length,
        items: filtered.slice(offset, offset + limit), books, topics, nextOffset: offset + limit < filtered.length ? offset + limit : null})};
    }});
  mountedPanels.push(panel);
  return {...env, panel, calls};
}
function assertThought(deck, card) {
  assert.equal(first(deck.body, 'reading-card-title').textContent, '本人想法');
  assert.equal(first(deck.body, 'fragment-thought-text').textContent, card.thoughtText);
  assert.equal(withClass(deck.body, 'fragment-original-text').length, 0);
  assert.equal(withClass(deck.body, 'fragment-flip').length, 0);
  assert.match(first(deck.body, 'fragment-scroll').getAttribute('aria-label'), /^本人想法全文/);
  assert.match(deck.live.textContent, /本人想法/);
  assert.doesNotMatch(deck.live.textContent, /原文|背面/);
}

test('thought-only content is the labelled front and is preserved verbatim', () => {
  for (const quoteText of ['', ' \n\t ']) {
    const card = reflection('one', {quoteText}), before = structuredClone(card), front = fragmentFront(card);
    assert.equal(cardHasQuote(card), false); assert.equal(cardHasThought(card), true); assert.equal(cardCanFlip(card), false);
    assert.deepEqual(front, {field: 'thoughtText', label: '本人想法', text: card.thoughtText, truncated: false, missing: false});
    assert.deepEqual(fragmentFace(card, 'back'), front); assert.deepEqual(card, before);
    assert.equal(cardPreview(card), '我的想法。 另一个段落。');
  }
});

test('dual content has a quotation front and a separately attributed thought back', () => {
  const card = item('dual', {quoteText: ' \n原文  ', thoughtText: '  想法\n '});
  assert.equal(cardCanFlip(card), true);
  assert.equal(fragmentFront(card).field, 'quoteText'); assert.equal(fragmentFront(card).text, card.quoteText);
  assert.equal(fragmentFace(card, 'back').field, 'thoughtText'); assert.equal(fragmentFace(card, 'back').text, card.thoughtText);
});

test('quotation-only and wholly empty records cannot create a fake thought face', () => {
  for (const thoughtText of ['', ' \n ', undefined, null]) {
    const card = item('quote', {thoughtText});
    assert.equal(cardCanFlip(card), false); assert.equal(fragmentFace(card, 'back').field, 'quoteText');
  }
  assert.equal(fragmentFront(reflection('empty', {thoughtText: ' '})).label, '阅读碎片');
  assert.equal(fragmentFront(null).missing, true);
});

for (const Deck of [ReadingDeck, PublicReadingDeck]) {
  test(`${Deck.name}: thought-only cards render directly and ignore repeated flips/restored back state`, () => {
    const {deck} = mount({Deck}), card = reflection(); deck.open([card], card.id);
    assertThought(deck, card); deck.flip(); deck.flip(); assertThought(deck, card);
    deck.face = 'back'; deck.render(true); assert.equal(deck.face, 'front'); assertThought(deck, card);
    assert.equal(document.activeElement, first(deck.body, 'fragment-scroll'));
    assert.equal(first(deck.body, 'fragment-book').textContent, '《测试书》 · 测试作者');
  });
  test(`${Deck.name}: real two-sided cards retain flip controls, exact text and attribution`, () => {
    const {deck} = mount({Deck}), card = item(); deck.open([card], card.id);
    assert.equal(first(deck.body, 'reading-card-title').textContent, '原文');
    assert.equal(first(deck.body, 'fragment-original-text').textContent, card.quoteText);
    first(deck.body, 'fragment-flip').click(); assert.equal(deck.face, 'back');
    assert.equal(first(deck.body, 'reading-card-title').textContent, '本人想法');
    assert.equal(first(deck.body, 'fragment-thought-text').textContent, card.thoughtText);
    assert.match(first(deck.body, 'fragment-flip').getAttribute('aria-label'), /原文/);
    first(deck.body, 'fragment-flip').click(); assert.equal(deck.face, 'front');
    assert.equal(first(deck.body, 'fragment-original-text').textContent, card.quoteText);
  });
  test(`${Deck.name}: quotation-only cards have no empty thought or flip control`, () => {
    const {deck} = mount({Deck}), card = item('quote', {thoughtText: ' \n '}); deck.open([card], card.id);
    deck.flip(); deck.face = 'back'; deck.render(true);
    assert.equal(first(deck.body, 'reading-card-title').textContent, '原文');
    assert.equal(first(deck.body, 'fragment-original-text').textContent, card.quoteText);
    assert.equal(withClass(deck.body, 'fragment-thought-text').length, 0);
    assert.equal(withClass(deck.body, 'fragment-flip').length, 0);
  });
}

test('card movement, scopes, close/reopen and Back/Forward never revive an empty face', () => {
  const env = mount(), {deck} = env, dual = item('dual'), thought = reflection(), quote = item('quote', {thoughtText: ''});
  const cards = [dual, thought, quote];
  deck.open(cards, dual.id, {scope: {kind: 'all'}, trigger: env.ids['reading-title']}); deck.flip(); deck.move(1); assertThought(deck, thought);
  deck.changeScope({kind: 'topic', value: 'reading_creation'}); assertThought(deck, thought);
  history.back(); env.flush(); assert.equal(deck.dialog.open, false); assert.equal(document.activeElement, env.ids['reading-title']);
  history.forward(); env.flush(); assert.equal(deck.dialog.open, true); assertThought(deck, thought);
  deck.close(); deck.open(cards, thought.id); assert.equal(deck.dialog.open, false); env.flush(); assertThought(deck, thought);
  deck.move(1); assert.equal(first(deck.body, 'reading-card-title').textContent, '原文');
  assert.equal(withClass(deck.body, 'fragment-flip').length, 0);
});

test('graph text and accessible labels distinguish thoughts from quotations, keeping real card callbacks', () => {
  const env = mount(), thought = reflection(), dual = item('dual'), quote = item('quote', {thoughtText: ''});
  let activated;
  const graph = new ReadingGraph({document: env.doc, onCard: card => {activated = card;}});
  const model = buildReadingGraphModel({current: thought, related: [dual, quote]});
  assert.equal(model.nodes[0].label, thought.thoughtText); assert.equal(model.nodes[0].contentLabel, '本人想法');
  assert.equal(model.nodes.find(node => node.kind === 'card').contentLabel, '原文');
  graph.open({current: thought, related: [dual, quote], trigger: env.deck.next});
  const current = first(graph.dialog, 'reading-graph-node-current');
  assert.match(current.textContent, /本人想法/); assert.match(current.getAttribute('aria-label'), /^当前碎片，本人想法：/);
  assert.doesNotMatch(graph.dialog.textContent, /未关联原文/);
  const peer = withClass(graph.dialog, 'reading-graph-node-card')[0]; assert.match(peer.textContent, /原文/);
  peer.click(); assert.equal(activated, dual); assert.equal(graph.dialog.open, false);
});

test('legacy example query uses the real anonymous API and displays only approved launch cards', async () => {
  const corpus = JSON.parse(readFileSync('content/reading-library.json', 'utf8'));
  assert.equal(corpus.snapshotTotal, 8); assert.equal(corpus.items.length, 8);
  assert(corpus.items.every(card => !cardHasQuote(card) && cardHasThought(card)));
  const env = mountPanel(corpus.items, {search: '?example=1'}); await env.panel.init();
  assert.equal(location.search, ''); assert.equal(env.calls.length, 1); assertThought(env.deck, env.panel.current);
  assert.equal(env.calls[0].options.credentials, 'omit');
  for (let i = 1; i < 8; i++) {await env.panel.move(1); assertThought(env.deck, env.panel.current);}
  assert.deepEqual(new Set(env.panel.trail.map(card => card.id)), new Set(corpus.items.map(card => card.id)));
  assert.equal(env.deck.next.disabled, true); await env.panel.move(-1); assertThought(env.deck, env.panel.current);
  assert(env.calls.every(call => call.url.startsWith('/api/reading/cards?')));
});

test('book search, topic scopes and relation navigation remain available for thought-only cards', async () => {
  const cards = [reflection('one'), reflection('two'), reflection('three', {bookId: 'other-book', bookTitle: '另一本测试书', author: '另一位作者'})];
  const env = mountPanel(cards); await env.panel.init();
  await env.panel.openGraph(env.deck.graphButton);
  assert.equal(env.panel.graph.dialog.open, true); assert.match(env.panel.graph.dialog.textContent, /本人想法/);
  first(env.panel.graph.dialog, 'reading-graph-node-card').click(); assert.equal(env.panel.current.id, 'two'); assertThought(env.deck, cards[1]);
  env.panel.openBookSearch(env.deck.bookButton); env.panel.searchInput.value = '另一位作者'; env.panel.renderBookResults();
  assert.equal(withClass(env.panel.searchDialog, 'public-book-result').length, 1);
  first(env.panel.searchDialog, 'public-book-result').click(); await env.panel.scopePromise;
  assert.equal(env.panel.searchDialog.open, false); assert.equal(env.panel.filters.bookId, 'other-book'); assertThought(env.deck, cards[2]);
  await env.panel.chooseScope({kind: 'topic', value: 'reading_creation'}); assert.equal(env.panel.filters.topic, 'reading_creation');
  assert.equal(env.deck.allButton.hidden, false);
});

test('public launch HTML, modules and allowlist contain no synthetic data route or demo asset', () => {
  const html = readFileSync('public/reading/index.html', 'utf8');
  const js = readFileSync('public/assets/reading.js', 'utf8') + readFileSync('public/assets/reading-deck.js', 'utf8');
  const manifest = JSON.parse(readFileSync('config/public-files.json', 'utf8'));
  assert.doesNotMatch(html, /example=1|交互示例|reading-demo|reading-example/);
  assert.doesNotMatch(js, /reading-demo|demoPage|demoEntries|this\.demo|synthetic-demo|自拟示例/);
  assert.equal(manifest.public.includes('assets/reading-demo.js'), false);
  assert.equal(existsSync('public/assets/reading-demo.js'), false);
});
