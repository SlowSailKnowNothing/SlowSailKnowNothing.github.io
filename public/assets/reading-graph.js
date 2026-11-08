// A local view of supplied public cards, not a semantic-similarity graph.
// This module deliberately performs no I/O and never edits its input records.
import {fragmentFront} from './reading-deck-model.js';
const MAX_RELATED = 4;
const MAX_TOPICS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';
let instanceId = 0;

const key = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
const text = value => typeof value === 'string' ? value : '';
const preview = card => {const content = fragmentFront(card); return {label: content.text, contentLabel: content.label};};

// Code-point iteration cannot split an emoji's surrogate pair. An ellipsis
// explicitly identifies a display excerpt; full original text remains available.
export function shortGraphLabel(value, limit = 12) {
  const original = text(value);
  const characters = [];
  for (const character of original) {
    if (characters.length === limit) return characters.join('') + '…';
    characters.push(character);
  }
  return original;
}

function labelForTopic(labels, id) {
  const value = labels instanceof Map ? labels.get(id)
    : labels && Object.hasOwn(labels, id) ? labels[id] : undefined;
  return typeof value === 'string' && value.trim() ? value : id;
}

function orbitPositions(length, lower = false) {
  const positions = {
    1: [[50, 88]],
    2: [[25, 83], [75, 83]],
    3: [[15, 78], [50, 89], [85, 78]],
    4: [[12, 77], [37, 89], [63, 89], [88, 77]],
  }[length] || [];
  return positions.map(([x, y]) => ({x, y: lower ? y : 100 - y}));
}

export function buildReadingGraphModel({current, related = [], topicLabels = {}} = {}) {
  if (!current || !key(current.id) || !key(current.bookId)) {
    throw new TypeError('A public reading card with an id and bookId is required');
  }
  const used = new Set([current.id]);
  const peers = [];
  for (const card of Array.isArray(related) ? related : []) {
    if (!card || !key(card.id) || card.bookId !== current.bookId || used.has(card.id)) continue;
    used.add(card.id);
    peers.push(card);
    if (peers.length === MAX_RELATED) break;
  }
  const topicIds = [];
  const usedTopics = new Set();
  for (const id of Array.isArray(current.topics) ? current.topics : []) {
    if (!key(id) || usedTopics.has(id)) continue;
    usedTopics.add(id);
    if (topicIds.length < MAX_TOPICS) topicIds.push(id);
  }
  const nodes = [
    {key: 'current', kind: 'current', ...preview(current), card: current, x: 50, y: 55},
    {key: 'book', kind: 'book', value: current.bookId,
      label: text(current.bookTitle).trim() ? current.bookTitle : '未标注书名', x: 50, y: 33},
  ];
  const edges = [{from: 'current', to: 'book', kind: 'book'}];
  const peerPositions = orbitPositions(peers.length);
  peers.forEach((card, index) => {
    const node = {key: `card-${index}`, kind: 'card', ...preview(card), card, ...peerPositions[index]};
    nodes.push(node);
    edges.push({from: 'book', to: node.key, kind: 'book'});
  });
  const topicPositions = orbitPositions(topicIds.length, true);
  topicIds.forEach((id, index) => {
    const node = {key: `topic-${index}`, kind: 'topic', value: id,
      label: labelForTopic(topicLabels, id), ...topicPositions[index]};
    nodes.push(node);
    edges.push({from: 'current', to: node.key, kind: 'topic'});
  });
  return {nodes, edges, related: peers, omittedTopics: Math.max(0, usedTopics.size - MAX_TOPICS)};
}

/**
 * Usage: new ReadingGraph({document, onCard, onScope, onClose}).
 * open({current, related, topicLabels, trigger}) uses already loaded public DTOs.
 * onCard receives the exact supplied DTO; onScope receives a raw book/topic ID.
 * Each action closes and restores focus before calling its controller callback.
 */
export class ReadingGraph {
  constructor({document: doc = globalThis.document, onCard = () => {}, onScope = () => {}, onClose = () => {}} = {}) {
    if (!doc?.body) throw new TypeError('ReadingGraph needs a document with a body');
    this.doc = doc;
    this.onCard = onCard;
    this.onScope = onScope;
    this.onClose = onClose;
    this.active = false;
    this.destroyed = false;
    this.trigger = null;
    const prefix = `reading-graph-${++instanceId}`;
    this.dialog = this.element('dialog', 'reading-graph-dialog');
    this.dialog.setAttribute('aria-labelledby', `${prefix}-title`);
    this.dialog.setAttribute('aria-describedby', `${prefix}-legend`);
    this.dialog.setAttribute('aria-modal', 'true');
    const header = this.element('header', 'reading-graph-header');
    const title = this.element('h2', '', '看看关联');
    title.id = `${prefix}-title`;
    this.closeButton = this.button('关闭', 'reading-graph-close', () => this.close());
    this.closeButton.setAttribute('aria-label', '关闭关联图');
    header.append(title, this.closeButton);
    const legend = this.element('p', 'reading-graph-legend');
    legend.id = `${prefix}-legend`;
    legend.append(this.element('span', 'reading-graph-legend-book', '实线：同一本书'),
      this.element('span', 'reading-graph-legend-topic', '虚线：话题归类 · 助理分类'));
    const explanation = this.element('p', 'reading-graph-explanation', '只展示书籍来源与已有话题归类，不表示内容相似。');
    this.content = this.element('div', 'reading-graph-content');
    this.dialog.append(header, legend, explanation, this.content);
    this.dialog.addEventListener('keydown', event => this.keydown(event));
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      event.stopPropagation?.();
      this.close();
    });
    this.dialog.addEventListener('close', () => {
      // A native close event can arrive after a synchronous close and reopen.
      if (!this.dialog.open) this.finishClose();
    });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      const bounds = this.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
    });
    doc.body.append(this.dialog);
  }

  element(tag, className = '', content) {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  button(label, className, action) {
    const button = this.element('button', className, label);
    button.type = 'button';
    button.addEventListener('click', event => {
      event.stopPropagation?.();
      action();
    });
    return button;
  }

  description(node) {
    if (node.kind === 'current') return `当前碎片，${node.contentLabel}：${node.label}`;
    if (node.kind === 'card') return `阅读同书碎片，${node.contentLabel}：${node.label}`;
    if (node.kind === 'book') return `继续读这本书：${node.label}`;
    return `按话题继续读：${node.label}。话题归类 · 助理分类`;
  }

  activate(node) {
    if (!this.active) return;
    this.close();
    if (node.kind === 'card') this.onCard(node.card);
    else if (node.kind === 'book' || node.kind === 'topic') this.onScope({kind: node.kind, value: node.value});
  }

  makeNode(node, list = false) {
    const control = node.kind === 'current'
      ? this.element('p', list ? 'reading-graph-list-current' : 'reading-graph-node reading-graph-node-current')
      : this.button('', list ? 'reading-graph-list-link' : `reading-graph-node reading-graph-node-${node.kind}`, () => this.activate(node));
    if (node.kind === 'current') control.setAttribute('role', 'note');
    control.setAttribute('aria-label', this.description(node));
    control.setAttribute('title', node.label);
    const label = shortGraphLabel(node.label, list ? 60 : node.kind === 'current' ? 22 : 12);
    if (list) {
      const prefix = {current: `这一张 · ${node.contentLabel}：`, book: '来源书籍：', card: `同书碎片 · ${node.contentLabel}：`, topic: '话题归类：'}[node.kind];
      control.textContent = prefix + label;
    } else {
      control.style.left = `${node.x}%`;
      control.style.top = `${node.y}%`;
      const kind = {current: `这一张 · ${node.contentLabel}`, book: '来源书籍', card: `同书碎片 · ${node.contentLabel}`, topic: '话题归类'}[node.kind];
      control.append(this.element('span', 'reading-graph-node-kind', kind),
        this.element('span', 'reading-graph-node-label', label));
    }
    return control;
  }

  render(model, message = '') {
    const canvas = this.element('div', 'reading-graph-canvas');
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', '局部关联图，实线连接同书碎片，虚线连接助理话题归类');
    const svgElement = tag => this.doc.createElementNS ? this.doc.createElementNS(SVG_NS, tag) : this.doc.createElement(tag);
    const svg = svgElement('svg');
    svg.setAttribute('class', 'reading-graph-lines');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const nodeByKey = new Map(model.nodes.map(node => [node.key, node]));
    for (const edge of model.edges) {
      const from = nodeByKey.get(edge.from), to = nodeByKey.get(edge.to), line = svgElement('line');
      for (const [name, value] of Object.entries({x1: from.x, y1: from.y, x2: to.x, y2: to.y})) line.setAttribute(name, String(value));
      line.setAttribute('class', `reading-graph-edge reading-graph-edge-${edge.kind}`);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(line);
    }
    canvas.append(svg);
    this.graphButtons = [];
    for (const node of model.nodes) {
      const control = this.makeNode(node);
      canvas.append(control);
      if (node.kind !== 'current') this.graphButtons.push(control);
    }
    const count = model.related.length;
    const note = this.element('p', 'reading-graph-extent', count
      ? `这里展示 ${count} 张已载入的同书碎片，不是全库关系。点书名或话题，可继续读。`
      : '暂未载入其他同书碎片。点书名，可继续读这本书。');
    if (model.omittedTopics) note.textContent += ` 此处只展示前 ${MAX_TOPICS} 个已有话题。`;
    this.details = this.element('details', 'reading-graph-text-list');
    this.summary = this.element('summary', '', '用文字列表查看');
    const list = this.element('ul');
    this.listButtons = [];
    for (const node of model.nodes) {
      const item = this.element('li'), control = this.makeNode(node, true);
      item.append(control);
      list.append(item);
      if (node.kind !== 'current') this.listButtons.push(control);
    }
    this.details.append(this.summary, list);
    const contents = [canvas, note, this.details];
    if (typeof message === 'string' && message.trim()) {
      const status = this.element('p', 'reading-graph-status', shortGraphLabel(message, 200));
      status.setAttribute('role', 'status');
      contents.unshift(status);
    }
    this.content.replaceChildren(...contents);
  }

  open(options = {}) {
    if (this.destroyed) throw new Error('ReadingGraph has been destroyed');
    const model = buildReadingGraphModel(options);
    if (!this.active) this.trigger = options.trigger || this.doc.activeElement;
    else if (options.trigger) this.trigger = options.trigger;
    this.render(model, options.message);
    if (!this.dialog.open) {
      if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
      else this.dialog.setAttribute('open', '');
    }
    this.active = true;
    this.closeButton.focus();
  }

  keydown(event) {
    if (!this.active) return;
    // A modal above the reader must not flip or navigate the reader underneath.
    event.stopPropagation?.();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [this.closeButton, ...this.graphButtons, this.summary,
      ...(this.details.open ? this.listButtons : [])].filter(control => !control.disabled);
    const first = controls[0], last = controls[controls.length - 1], active = this.doc.activeElement;
    if (event.shiftKey && (active === first || !controls.includes(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
      event.preventDefault(); first.focus();
    }
  }

  finishClose() {
    if (!this.active) return;
    this.active = false;
    const trigger = this.trigger;
    this.trigger = null;
    if (trigger?.isConnected && !trigger.disabled && typeof trigger.focus === 'function') trigger.focus();
    this.onClose();
  }

  close() {
    if (!this.active) return;
    if (typeof this.dialog.close === 'function') this.dialog.close();
    else this.dialog.removeAttribute('open');
    this.finishClose();
  }

  destroy() {
    this.close();
    this.dialog.remove();
    this.destroyed = true;
  }
}
