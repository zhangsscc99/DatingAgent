/// <reference types="node" />
/**
 * Minimal DOM just complete enough to run react-dom/client + this app under
 * vitest's node environment: element/text/comment nodes, attribute, class
 * and dataset handling, querySelector for the simple compound selectors the
 * app uses, capture/bubble event dispatch, and a fake localStorage. Used by
 * tests that need to mount real components rather than renderToStaticMarkup
 * (P224's send-while-streaming regression test, for example).
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

/** Attribute → DOM property for the boolean-reflected attributes this app
 *  touches (React writes `disabled`/`checked` via setAttribute, the browser
 *  then mirrors them onto the property). */
const BOOL_ATTR_PROPS: Record<string, string> = {
  disabled: 'disabled',
  checked: 'checked',
  selected: 'selected',
  hidden: 'hidden',
  readonly: 'readOnly',
  required: 'required',
  multiple: 'multiple',
  open: 'open',
};

export interface EventInitLike {
  bubbles?: boolean;
  cancelable?: boolean;
  props?: Record<string, unknown>;
}

export class FakeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  target: any = null;
  currentTarget: any = null;
  defaultPrevented = false;
  _stopped = false;
  _immediateStopped = false;
  [key: string]: unknown;

  constructor(type: string, opts: EventInitLike = {}) {
    this.type = type;
    this.bubbles = Boolean(opts.bubbles);
    this.cancelable = Boolean(opts.cancelable);
    Object.assign(this, opts.props ?? {});
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stopped = true;
  }
  stopImmediatePropagation() {
    this._stopped = true;
    this._immediateStopped = true;
  }
}

type Listener = { fn: (e: FakeEvent) => void; capture: boolean };

export class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  ownerDocument: FakeDocument = null as unknown as FakeDocument;
  nodeValue = '';
  _listeners = new Map<string, Listener[]>();

  get parentElement(): FakeElement | null {
    return this.parentNode && this.parentNode.nodeType === ELEMENT_NODE
      ? (this.parentNode as FakeElement)
      : null;
  }
  get nodeType(): number {
    return 0;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] ?? null;
  }
  get previousSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i - 1] ?? null;
  }
  appendChild<T extends FakeNode>(node: T): T {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
    if (ref == null) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(node);
    node.parentNode = this;
    this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild<T extends FakeNode>(node: T): T {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  contains(node: FakeNode | null): boolean {
    let n: FakeNode | null = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  addEventListener(
    type: string,
    fn: (e: FakeEvent) => void,
    opts?: boolean | { capture?: boolean },
  ) {
    const capture = opts === true || Boolean((opts as { capture?: boolean })?.capture);
    const arr = this._listeners.get(type) ?? [];
    arr.push({ fn, capture });
    this._listeners.set(type, arr);
  }
  removeEventListener(
    type: string,
    fn: (e: FakeEvent) => void,
    opts?: boolean | { capture?: boolean },
  ) {
    const capture = opts === true || Boolean((opts as { capture?: boolean })?.capture);
    const arr = this._listeners.get(type);
    if (!arr) return;
    const i = arr.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i >= 0) arr.splice(i, 1);
  }
  _invokeListeners(event: FakeEvent, capturePhase: boolean) {
    const arr = this._listeners.get(event.type);
    if (!arr) return;
    for (const l of [...arr]) {
      if (l.capture !== capturePhase) continue;
      if (event._immediateStopped) return;
      event.currentTarget = this;
      l.fn.call(this, event);
    }
  }
  dispatchEvent(event: FakeEvent): boolean {
    if (!event.target) event.target = this;
    const path: FakeNode[] = [];
    let node: FakeNode | null = this;
    while (node) {
      path.push(node);
      node = node.parentNode;
    }
    if (event.bubbles) {
      for (let i = path.length - 1; i > 0; i--) {
        if (event._stopped) break;
        path[i]._invokeListeners(event, true);
      }
      if (!event._stopped) this._invokeListeners(event, true);
      if (!event._stopped) this._invokeListeners(event, false);
      for (let i = 1; i < path.length; i++) {
        if (event._stopped) break;
        path[i]._invokeListeners(event, false);
      }
    } else {
      this._invokeListeners(event, true);
      this._invokeListeners(event, false);
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
  get textContent(): string {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) return this.nodeValue;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) {
      this.nodeValue = v;
      return;
    }
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== '') this.appendChild(this.ownerDocument.createTextNode(v));
  }
}

export class FakeText extends FakeNode {
  constructor(doc: FakeDocument, data: string) {
    super();
    this.ownerDocument = doc;
    this.nodeValue = data;
  }
  get nodeType() {
    return TEXT_NODE;
  }
  get data() {
    return this.nodeValue;
  }
  set data(v: string) {
    this.nodeValue = v;
  }
}

export class FakeComment extends FakeNode {
  constructor(doc: FakeDocument, data: string) {
    super();
    this.ownerDocument = doc;
    this.nodeValue = data;
  }
  get nodeType() {
    return COMMENT_NODE;
  }
  get data() {
    return this.nodeValue;
  }
}

/** Single-compound selectors: `tag`, `.a.b`, `#id`, `[a]`, `[a="v"]`,
 *  `tag[attr="v"]`; comma-separated at the querySelector level. */
export function matchesSelector(el: FakeElement, selector: string): boolean {
  let rest = selector.trim();
  if (!rest) return false;
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9_-]*/.exec(rest);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest.startsWith('.')) {
      const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('#')) {
      const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      if (end < 0) return false;
      const inner = rest.slice(1, end);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (!el.hasAttribute(inner.trim())) return false;
      } else {
        const name = inner.slice(0, eq).trim();
        const val = inner
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (el.getAttribute(name) !== val) return false;
      }
      rest = rest.slice(end + 1);
    } else {
      return false;
    }
  }
  return true;
}

export class FakeElement extends FakeNode {
  tagName: string;
  nodeName: string;
  namespaceURI: string;
  attributes = new Map<string, string>();
  style: Record<string, unknown>;
  dataset: Record<string, unknown>;
  value = '';
  checked = false;
  selected = false;
  disabled = false;
  selectionStart = 0;
  selectionEnd = 0;
  scrollTop = 0;
  scrollHeight = 0;
  scrollWidth = 0;
  clientHeight = 0;
  clientWidth = 0;
  lang = '';
  isContentEditable = false;

  constructor(doc: FakeDocument, tag: string, ns?: string) {
    super();
    this.ownerDocument = doc;
    this.namespaceURI = ns ?? 'http://www.w3.org/1999/xhtml';
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    const backing: Record<string, unknown> = {};
    this.style = new Proxy(backing, {
      get: (t, k) => {
        if (k === 'setProperty')
          return (n: string, v: string) => {
            t[n] = v;
          };
        return t[k as string];
      },
      set: (t, k, v) => {
        t[k as string] = v;
        return true;
      },
    });
    this.dataset = new Proxy(
      {},
      {
        get: (_t, k) =>
          this.getAttribute(
            'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
          ) ?? undefined,
        set: (_t, k, v) => {
          this.setAttribute(
            'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
            String(v),
          );
          return true;
        },
      },
    );
  }

  get nodeType() {
    return ELEMENT_NODE;
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }
  get classList() {
    const self = this;
    return {
      contains: (c: string) => self.className.split(/\s+/).includes(c),
      add: (c: string) => {
        const s = new Set(self.className.split(/\s+/).filter(Boolean));
        s.add(c);
        self.className = [...s].join(' ');
      },
      remove: (c: string) => {
        const s = new Set(self.className.split(/\s+/).filter(Boolean));
        s.delete(c);
        self.className = [...s].join(' ');
      },
      toggle: (c: string) => {
        if (self.classList.contains(c)) self.classList.remove(c);
        else self.classList.add(c);
      },
    };
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
    // React's isEventSupported() probes `setAttribute('oninput','return;')`
    // and expects a function-valued property afterwards.
    if (/^on[a-z]+$/.test(name)) {
      (this as unknown as Record<string, unknown>)[name] = () => undefined;
    }
    // Real DOM reflects boolean attributes onto properties (`.disabled`,
    // `.checked`, …); React sets them via attributes, not properties.
    const prop = BOOL_ATTR_PROPS[name];
    if (prop) {
      (this as unknown as Record<string, unknown>)[prop] = true;
    }
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    const prop = BOOL_ATTR_PROPS[name];
    if (prop) {
      (this as unknown as Record<string, unknown>)[prop] = false;
    }
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n) => n.nodeType === ELEMENT_NODE) as FakeElement[];
  }
  get options(): FakeElement[] {
    return this.children.filter((n) => n.tagName === 'OPTION');
  }
  _walk(out: FakeElement[] = []): FakeElement[] {
    for (const c of this.childNodes) {
      if (c.nodeType === ELEMENT_NODE) {
        const e = c as FakeElement;
        out.push(e);
        e._walk(out);
      }
    }
    return out;
  }
  getElementsByTagName(tag: string): FakeElement[] {
    return this._walk().filter((e) => e.tagName === tag.toUpperCase());
  }
  querySelector(sel: string): FakeElement | null {
    const parts = sel.split(',');
    return this._walk().find((e) => parts.some((s) => matchesSelector(e, s))) ?? null;
  }
  querySelectorAll(sel: string): FakeElement[] {
    const parts = sel.split(',');
    return this._walk().filter((e) => parts.some((s) => matchesSelector(e, s)));
  }
  closest(sel: string): FakeElement | null {
    let node: FakeNode | null = this;
    while (node && node.nodeType === ELEMENT_NODE) {
      if (matchesSelector(node as FakeElement, sel)) return node as FakeElement;
      node = node.parentNode;
    }
    return null;
  }
  private _html = '';
  get innerHTML(): string {
    return this._html;
  }
  set innerHTML(v: string) {
    this._html = v;
    for (const c of [...this.childNodes]) this.removeChild(c);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }
  click() {
    this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
  }
  select() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

export class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  head: FakeElement;
  body: FakeElement;
  activeElement: FakeElement | null;
  defaultView: unknown = null;
  hidden = false;

  constructor() {
    super();
    this.ownerDocument = this;
    const html = new FakeElement(this, 'html');
    const head = new FakeElement(this, 'head');
    const body = new FakeElement(this, 'body');
    this.appendChild(html);
    html.appendChild(head);
    html.appendChild(body);
    this.documentElement = html;
    this.head = head;
    this.body = body;
    this.activeElement = body;
  }
  get nodeType() {
    return DOCUMENT_NODE;
  }
  createElement(tag: string) {
    return new FakeElement(this, tag);
  }
  createElementNS(ns: string, tag: string) {
    return new FakeElement(this, tag, ns);
  }
  createTextNode(data: string) {
    return new FakeText(this, String(data));
  }
  createComment(data: string) {
    return new FakeComment(this, String(data));
  }
  createDocumentFragment() {
    const f = new FakeNode();
    f.ownerDocument = this;
    return f;
  }
  querySelector(sel: string) {
    return this.documentElement.querySelector(sel);
  }
  querySelectorAll(sel: string) {
    return this.documentElement.querySelectorAll(sel);
  }
  getElementById(id: string) {
    return this.documentElement._walk().find((e) => e.id === id) ?? null;
  }
}

export interface FakeDom {
  document: FakeDocument;
  window: FakeNode & Record<string, unknown>;
  localStorage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
    _store: Map<string, string>;
  };
}

export function installFakeDom(): FakeDom {
  const document = new FakeDocument();
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(String(k), String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
  const window = new FakeNode() as FakeDom['window'];
  // DOM constructors React's internals read through ownerDocument.defaultView.
  for (const name of [
    'HTMLIFrameElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLAnchorElement',
    'HTMLButtonElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLOptionElement',
    'HTMLFormElement',
    'HTMLLabelElement',
    'HTMLUnknownElement',
    'HTMLLIElement',
    'HTMLUListElement',
    'HTMLImageElement',
    'HTMLMetaElement',
  ]) {
    window[name] = class extends FakeElement {};
  }
  Object.assign(window, {
    document,
    localStorage,
    navigator: { onLine: true, platform: 'linux', userAgent: 'FakeDom/1.0' },
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    matchMedia: (q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    confirm: () => true,
    alert: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    CSS: { escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    HTMLElement: FakeElement,
    Element: FakeElement,
    SVGElement: FakeElement,
    Node: FakeNode,
    Text: FakeText,
    Comment: FakeComment,
    Document: FakeDocument,
    innerWidth: 390,
    innerHeight: 844,
    scrollTo: () => {},
  });
  (document as { defaultView: unknown }).defaultView = window;
  const g = globalThis as Record<string, unknown>;
  g.window = window;
  g.document = document;
  g.localStorage = localStorage;
  g.self = window;
  Object.defineProperty(g, 'navigator', {
    value: (window as Record<string, unknown>).navigator,
    configurable: true,
    writable: true,
  });
  g.Node = FakeNode;
  g.Element = FakeElement;
  g.HTMLElement = FakeElement;
  g.SVGElement = FakeElement;
  g.Text = FakeText;
  g.Comment = FakeComment;
  g.Event = FakeEvent;
  g.CustomEvent = FakeEvent;
  g.requestAnimationFrame = window.requestAnimationFrame;
  g.cancelAnimationFrame = window.cancelAnimationFrame;
  g.matchMedia = window.matchMedia;
  g.getComputedStyle = window.getComputedStyle;
  g.CSS = window.CSS;
  g.confirm = window.confirm;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return { document, window, localStorage, FakeEvent } as FakeDom;
}

/** A fetch-body reader the test drives by hand: queued chunks are emitted in
 *  order, and read() parks until push()/close() — the "slow SSE stream". */
export class ControlledSseStream {
  private encoder = new TextEncoder();
  private chunks: Uint8Array[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(...frames: string[]) {
    for (const frame of frames) this.chunks.push(this.encoder.encode(frame));
    this.release();
  }
  close() {
    this.closed = true;
    this.release();
  }
  private release() {
    while (this.waiters.length > 0 && (this.chunks.length > 0 || this.closed)) {
      const next = this.waiters.shift();
      next?.();
    }
  }
  reader = {
    read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (this.chunks.length > 0) {
        return Promise.resolve({ done: false, value: this.chunks.shift() });
      }
      if (this.closed) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => {
        this.waiters.push(() => resolve(this.reader.read()));
      });
    },
    cancel: () => {
      this.closed = true;
      this.release();
      return Promise.resolve();
    },
    releaseLock: () => {},
  };
}

export function sseResponse(stream: ControlledSseStream) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: { getReader: () => stream.reader },
  };
}

export function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(data),
    body: null,
  };
}

export const sse = (type: string, data: unknown) =>
  `data: ${JSON.stringify({ type, data })}\n\n`;
