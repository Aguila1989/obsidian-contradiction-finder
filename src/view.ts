import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type ContradictionFinderPlugin from "./main";
import { Contradiction } from "./scanner";

export const VIEW_TYPE_CONTRADICTIONS = "contradiction-finder-view";

/** Right-side panel listing confirmed contradictions as cards. */
export class ContradictionsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ContradictionFinderPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CONTRADICTIONS;
  }

  getDisplayText(): string {
    return "Contradictions";
  }

  getIcon(): string {
    return "git-compare";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Redraw the whole panel from the plugin's current results. */
  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("contradiction-finder");

    const header = root.createDiv({ cls: "cf-header" });
    header.createEl("h4", { text: "Contradictions" });
    const rescan = header.createEl("button", { text: "Rescan", cls: "mod-cta cf-rescan" });
    rescan.disabled = this.plugin.scanning;
    rescan.addEventListener("click", () => {
      void this.plugin.runScan();
    });

    if (this.plugin.scanning) {
      root.createDiv({ cls: "cf-empty", text: "Scanning vault..." });
      return;
    }

    const items = this.plugin.contradictions;
    if (items.length === 0) {
      root.createDiv({
        cls: "cf-empty",
        text: "No contradictions found yet. Run a scan to check your notes.",
      });
      return;
    }

    const list = root.createDiv({ cls: "cf-list" });
    for (const item of items) this.renderCard(list, item);
  }

  /** Render one contradiction as a card with clickable note titles. */
  private renderCard(parent: HTMLElement, item: Contradiction): void {
    const card = parent.createDiv({ cls: "cf-card" });

    const titles = card.createDiv({ cls: "cf-titles" });
    this.renderTitleLink(titles, item.titleA, item.pathA);
    titles.createSpan({ cls: "cf-vs", text: "vs" });
    this.renderTitleLink(titles, item.titleB, item.pathB);

    const pct = Math.round(item.confidence * 100);
    card.createDiv({ cls: "cf-confidence", text: `Confidence: ${pct}%` });

    const statements = card.createDiv({ cls: "cf-statements" });
    const rowA = statements.createDiv({ cls: "cf-statement" });
    rowA.createSpan({ cls: "cf-badge", text: "A" });
    rowA.createSpan({ text: item.statementA || "(no statement extracted)" });
    const rowB = statements.createDiv({ cls: "cf-statement" });
    rowB.createSpan({ cls: "cf-badge", text: "B" });
    rowB.createSpan({ text: item.statementB || "(no statement extracted)" });

    if (item.explanation) {
      card.createDiv({ cls: "cf-explanation", text: item.explanation });
    }
  }

  private renderTitleLink(parent: HTMLElement, title: string, path: string): void {
    const link = parent.createEl("a", { cls: "cf-title", text: title });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf(false).openFile(file);
      } else {
        new Notice(`Note not found: ${path}`);
      }
    });
  }
}
