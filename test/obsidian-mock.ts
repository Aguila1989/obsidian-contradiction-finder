// Runtime mock of the "obsidian" module for Vitest. The real package ships only
// type declarations (the runtime is provided by the app), so tests alias
// "obsidian" to this file. Pure-logic tests use the real helper implementations
// (normalizePath, parseYaml, moment, debounce, getAllTags, parseLinktext); the
// class stubs exist only so `import { Plugin, ItemView, ... }` resolves.
import * as jsyaml from "js-yaml";
import momentImpl from "moment";

// ---- helper functions with real-ish behavior --------------------------------

export function normalizePath(path: string): string {
  const cleaned = path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/(^\/+|\/+$)/g, "");
  return cleaned.length > 0 ? cleaned : "/";
}

export function parseYaml(str: string): unknown {
  return jsyaml.load(str);
}

export function stringifyYaml(obj: unknown): string {
  return jsyaml.dump(obj, { lineWidth: -1 });
}

export const moment = momentImpl;

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T): T & { cancel: () => void; run: () => void } {
  // Tests want deterministic behavior: run synchronously, no timer.
  const wrapped = ((...args: unknown[]) => fn(...args)) as T & { cancel: () => void; run: () => void };
  wrapped.cancel = () => {};
  wrapped.run = () => {};
  return wrapped;
}

interface TagCacheLike {
  tags?: Array<{ tag: string }>;
  frontmatter?: Record<string, unknown>;
}

export function getAllTags(cache: TagCacheLike | null | undefined): string[] {
  if (!cache) return [];
  const out = new Set<string>();
  for (const t of cache.tags ?? []) {
    if (t?.tag) out.add(t.tag.startsWith("#") ? t.tag : "#" + t.tag);
  }
  const fmTags = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
  const push = (v: unknown) => {
    if (typeof v === "string") out.add(v.startsWith("#") ? v : "#" + v);
  };
  if (Array.isArray(fmTags)) fmTags.forEach(push);
  else if (typeof fmTags === "string") fmTags.split(/[\s,]+/).forEach(push);
  return [...out];
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf("#");
  if (hash === -1) return { path: linktext, subpath: "" };
  return { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

export function setIcon(): void {}
export function addIcon(): void {}
export function setTooltip(): void {}
export function sanitizeHTMLToDom(html: string): DocumentFragment {
  return document.createDocumentFragment?.() ?? ({} as DocumentFragment);
}

export const Platform = { isDesktop: true, isDesktopApp: true, isMobile: false, isMobileApp: false };
export const Keymap = { isModifier: () => false };

// requestUrl: inert by default. Tests that exercise network paths should
// vi.spyOn / vi.mock this or inject their own client.
export async function requestUrl(): Promise<{ status: number; text: string; json: unknown; arrayBuffer: ArrayBuffer; headers: Record<string, string> }> {
  return { status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} };
}

// ---- data classes ------------------------------------------------------------

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
  vault!: Vault;
}
export class TFile extends TAbstractFile {
  basename = "";
  extension = "md";
  stat = { ctime: 0, mtime: 0, size: 0 };
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.parent === null;
  }
}

// ---- chainable / no-op UI + lifecycle stubs ----------------------------------

const chain = () => new Proxy(function () {} as unknown as Record<string, unknown>, {
  get(_t, prop) {
    if (prop === "inputEl" || prop === "controlEl" || prop === "nameEl" || prop === "descEl" || prop === "settingEl") return chain();
    return () => chain();
  },
  apply() {
    return chain();
  },
});

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  registerInterval(): void {}
  addChild<T>(c: T): T {
    return c;
  }
}

export class Plugin extends Component {
  app: unknown;
  manifest: unknown;
  constructor(app?: unknown, manifest?: unknown) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  addCommand(cmd: unknown): unknown {
    return cmd;
  }
  addRibbonIcon(): HTMLElement {
    return {} as HTMLElement;
  }
  addStatusBarItem(): HTMLElement {
    return {} as HTMLElement;
  }
  addSettingTab(): void {}
  registerView(): void {}
  registerMarkdownCodeBlockProcessor(): void {}
  registerEditorSuggest(): void {}
  registerEditorExtension(): void {}
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(): Promise<void> {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: unknown = chain();
  constructor(app?: unknown, plugin?: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(_containerEl?: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setClass(): this {
    return this;
  }
  addText(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addTextArea(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addToggle(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addDropdown(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addSlider(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addButton(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
  addExtraButton(cb?: (c: unknown) => void): this {
    cb?.(chain());
    return this;
  }
}

export class Notice {
  message: string | DocumentFragment;
  constructor(message: string | DocumentFragment) {
    this.message = message;
  }
  setMessage(m: string | DocumentFragment): this {
    this.message = m;
    return this;
  }
  hide(): void {}
}

export class Modal {
  app: unknown;
  contentEl: unknown = chain();
  titleEl: unknown = chain();
  modalEl: unknown = chain();
  constructor(app?: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
  setTitle(): this {
    return this;
  }
}

export class ItemView extends Component {
  leaf: unknown;
  containerEl: unknown = chain();
  contentEl: unknown = chain();
  app: unknown;
  constructor(leaf?: unknown) {
    super();
    this.leaf = leaf;
  }
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class SuggestModal<T> extends Modal {
  getSuggestions(_query: string): T[] {
    return [];
  }
  renderSuggestion(): void {}
  onChooseSuggestion(): void {}
}
export class FuzzySuggestModal<T> extends SuggestModal<T> {
  getItems(): T[] {
    return [];
  }
  getItemText(): string {
    return "";
  }
  onChooseItem(): void {}
}
export class EditorSuggest<T> extends Component {
  app: unknown;
  constructor(app?: unknown) {
    super();
    this.app = app;
  }
  onTrigger(): unknown {
    return null;
  }
  getSuggestions(_ctx: unknown): T[] {
    return [];
  }
  renderSuggestion(): void {}
  selectSuggestion(): void {}
  close(): void {}
}
export class AbstractInputSuggest<T> extends Component {
  constructor(_app?: unknown, _el?: unknown) {
    super();
  }
  getSuggestions(_q: string): T[] {
    return [];
  }
  renderSuggestion(): void {}
  selectSuggestion(): void {}
}

export class Menu {
  addItem(): this {
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(): void {}
  showAtPosition(): void {}
}

export class FileSystemAdapter {
  getBasePath(): string {
    return "/mock/vault";
  }
}
export class Vault {}
export class MarkdownRenderer extends Component {
  static async render(): Promise<void> {}
  static async renderMarkdown(): Promise<void> {}
}
export class MarkdownView {}
export class Events {
  on(): unknown {
    return {};
  }
  off(): void {}
  trigger(): void {}
}

// Type-only names re-exported as loose aliases so value imports still resolve.
export type App = unknown;
export type Editor = unknown;
export type WorkspaceLeaf = unknown;
export type CachedMetadata = unknown;
export type MarkdownFileInfo = unknown;
export type MarkdownPostProcessorContext = unknown;
export type Debouncer<T extends unknown[], V> = ((...args: T) => V) & { cancel: () => void; run: () => void };
export type EditorPosition = { line: number; ch: number };
export type EditorSuggestContext = unknown;
export type EditorSuggestTriggerInfo = unknown;
export type TextComponent = unknown;
export type ButtonComponent = unknown;
export type PluginManifest = unknown;
