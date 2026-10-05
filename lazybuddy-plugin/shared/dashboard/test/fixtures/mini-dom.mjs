// Minimal DOM shim for exercising the T03 spike view modules under `node --test`.
// Implements only the APIs the spike modules use (HTML + SVG element tree, listeners,
// focus tracking, simple selector queries). It is a test fixture, not a shipped runtime.

class MiniText {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

const KEbab = key => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
const camel = name => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function parseSimple(selector) {
  const match = /^([a-z]+)?((?:\.[A-Za-z0-9_-]+)*)((?:\[[^\]]+\])*)$/.exec(selector);
  if (!match) return null;
  const classes = (match[2]?.match(/\.[A-Za-z0-9_-]+/g) ?? []).map(name => name.slice(1));
  const attrs = (match[3]?.match(/\[[^\]]+\]/g) ?? []).map(part => {
    const inner = part.slice(1, -1);
    const eq = inner.indexOf('=');
    if (eq === -1) return { name: inner, value: null };
    return { name: inner.slice(0, eq), value: inner.slice(eq + 1).replace(/^"|"$/g, '') };
  });
  return { tag: match[1] ? match[1].toUpperCase() : null, classes, attrs };
}

class MiniElement {
  constructor(tag, namespace = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.namespaceURI = namespace;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this._className = '';
    this._hidden = false;
    this._disabled = false;
    this._tabIndex = -1;
    this._value = '';
    this._title = '';
  }
  get className() { return this._className; }
  set className(value) { this._className = String(value); }
  get classList() {
    const self = this;
    const tokens = () => self._className.split(/\s+/).filter(Boolean);
    return { add(...names) { const set = new Set(tokens()); for (const name of names) set.add(name); self._className = [...set].join(' '); },
      remove(...names) { const set = new Set(tokens()); for (const name of names) set.delete(name); self._className = [...set].join(' '); },
      contains(name) { return tokens().includes(name); },
      toggle(name) { const set = new Set(tokens()); if (set.has(name)) set.delete(name); else set.add(name); self._className = [...set].join(' '); return set.has(name); } };
  }
  get dataset() {
    const self = this;
    return new Proxy({}, { get(_, key) { return self.attributes.get(KEbab(String(key))) ?? ''; },
      set(_, key, value) { self.attributes.set(KEbab(String(key)), String(value)); return true; },
      has(_, key) { return self.attributes.has(KEbab(String(key))); },
      ownKeys() { return [...self.attributes.keys()].filter(name => name.startsWith('data-')).map(camel); },
      getOwnPropertyDescriptor(_, key) { const stored = self.attributes.get(KEbab(String(key))); return stored === undefined ? undefined : { value: stored, enumerable: true, configurable: true }; } });
  }
  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }
  getAttribute(name) { const value = this.attributes.get(String(name).toLowerCase()); return value === undefined ? '' : value; }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }
  get hidden() { return this._hidden || this.hasAttribute('hidden'); }
  set hidden(value) { this._hidden = Boolean(value); if (this._hidden) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get disabled() { return this._disabled || this.hasAttribute('disabled'); }
  set disabled(value) { this._disabled = Boolean(value); if (this._disabled) this.attributes.set('disabled', ''); else this.attributes.delete('disabled'); }
  get tabIndex() { return this._tabIndex; }
  set tabIndex(value) { this._tabIndex = Number(value); }
  get title() { return this._title; }
  set title(value) { this._title = String(value); }
  get value() { return this._value; }
  set value(next) { this._value = String(next); }
  get id() { return this.getAttribute('id'); }
  set id(next) { this.attributes.set('id', String(next)); }
  get type() { return this.getAttribute('type'); }
  set type(next) { this.attributes.set('type', String(next)); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { for (const child of [...this.childNodes]) this.removeChild(child); if (value !== '') this.appendChild(new MiniText(value)); }
  get innerText() { return this.textContent; }
  append(...items) { for (const item of items) this.appendChild(typeof item === 'string' ? new MiniText(item) : item); }
  prepend(...items) { for (const item of items.reverse()) this.insertBefore(typeof item === 'string' ? new MiniText(item) : item, this.firstChild); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, node);
    return node;
  }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index !== -1) this.childNodes.splice(index, 1); node.parentNode = null; return node; }
  replaceChildren(...items) { for (const child of [...this.childNodes]) this.removeChild(child); this.append(...items); }
  remove() { this.parentNode?.removeChild(this); }
  contains(node) { let current = node; while (current) { if (current === this) return true; current = current.parentNode; } return false; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  removeEventListener(type, handler) { const list = this.listeners.get(type) ?? []; const index = list.indexOf(handler); if (index !== -1) list.splice(index, 1); }
  dispatchEvent(event) {
    Object.assign(event, { target: event.target ?? this, defaultPrevented: false, bubbles: true });
    if (!event.preventDefault) event.preventDefault = function preventDefault() { this.defaultPrevented = true; };
    if (!event.stopPropagation) event.stopPropagation = function stopPropagation() { this._stopped = true; };
    let node = event.target ?? this;
    while (node) {
      event.currentTarget = node;
      for (const handler of [...(node.listeners.get(event.type) ?? [])]) {
        handler(event);
        if (event._stopped) return !event.defaultPrevented;
      }
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() { activeDocument.activeElement = this; activeDocument._focusLog.push(this); }
  blur() { if (activeDocument.activeElement === this) activeDocument.activeElement = activeDocument.body; }
  matches(selector) {
    for (const part of String(selector).split(',').map(item => item.trim()).filter(Boolean)) {
      const segments = part.split(/\s+/).map(parseSimple);
      if (segments.some(parsed => parsed === null)) continue;
      if (this.matchesParsed(segments[segments.length - 1]) && this.matchesAncestry(segments.slice(0, -1))) return true;
    }
    return false;
  }
  matchesAncestry(segments) {
    if (!segments.length) return true;
    let node = this.parentNode;
    while (node && node.nodeType === 1) {
      if (node.matchesParsed(segments[segments.length - 1]) && node.matchesAncestry(segments.slice(0, -1))) return true;
      node = node.parentNode;
    }
    return false;
  }
  matchesParsed({ tag, classes, attrs }) {
    if (tag && this.tagName !== tag) return false;
    const own = this.classList;
    if (classes.some(name => !own.contains(name))) return false;
    return attrs.every(({ name, value }) => (value === null ? this.hasAttribute(name) : this.getAttribute(name) === value));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) { if (child.matches(selector)) found.push(child); visit(child); }
      }
    };
    visit(this);
    return found;
  }
}

class MiniDocument extends MiniElement {
  constructor() {
    super('#document');
    this.body = new MiniElement('body');
    this.appendChild(this.body);
    this.activeElement = this.body;
    this._focusLog = [];
  }
  createElement(tag) { return new MiniElement(tag); }
  createElementNS(namespace, tag) { return new MiniElement(tag, namespace); }
  createTextNode(data) { return new MiniText(data); }
}

let activeDocument = null;

export function createMiniDom() {
  const miniDocument = new MiniDocument();
  activeDocument = miniDocument;
  const globals = { document: miniDocument };
  return { document: miniDocument, globals, focusLog: miniDocument._focusLog,
    serialize(node = miniDocument.body) {
      const lines = [];
      const visit = (current, depth) => {
        const attributes = [...current.attributes.entries()].filter(([name]) => name !== 'hidden').sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`).join(' ');
        lines.push(`${'  '.repeat(depth)}${current.tagName}${current._className ? `.${current._className.replaceAll(' ', '.')}` : ''}${attributes ? ` ${attributes}` : ''}${current._hidden ? ' [hidden]' : ''}`);
        for (const child of current.childNodes) {
          if (child.nodeType === 3) lines.push(`${'  '.repeat(depth + 1)}"${child.data}"`);
          else visit(child, depth + 1);
        }
      };
      visit(node, 0);
      return lines.join('\n');
    } };
}
