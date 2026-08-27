import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { LlmClient } from "./llm";
import {
  ContradictionSettings,
  ContradictionSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { Contradiction, EmbeddingCacheEntry, scanVault } from "./scanner";
import { ContradictionsView, VIEW_TYPE_CONTRADICTIONS } from "./view";

/** Everything persisted via loadData/saveData. */
interface PluginData {
  settings: ContradictionSettings;
  embeddingCache: Record<string, EmbeddingCacheEntry>;
  contradictions: Contradiction[];
}

export default class ContradictionFinderPlugin extends Plugin {
  settings: ContradictionSettings = { ...DEFAULT_SETTINGS };
  embeddingCache: Record<string, EmbeddingCacheEntry> = {};
  contradictions: Contradiction[] = [];
  scanning = false;

  async onload(): Promise<void> {
    await this.loadStoredData();

    this.registerView(
      VIEW_TYPE_CONTRADICTIONS,
      (leaf) => new ContradictionsView(leaf, this),
    );

    this.addRibbonIcon("git-compare", "Show contradictions", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "scan-vault-for-contradictions",
      name: "Scan vault for contradictions",
      callback: () => {
        void this.runScan();
      },
    });

    this.addCommand({
      id: "open-contradictions-panel",
      name: "Open contradictions panel",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new ContradictionSettingTab(this.app, this));
  }

  // Note: leaves are deliberately NOT detached in onunload — Obsidian's plugin
  // guidelines forbid it, so the user's panel placement survives plugin updates.

  /** Reveal (or create) the right-side panel. */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CONTRADICTIONS)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("Could not open the Contradictions panel.");
        return;
      }
      await leaf.setViewState({ type: VIEW_TYPE_CONTRADICTIONS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Run the full scan pipeline, driving a progress Notice and refreshing the view. */
  async runScan(): Promise<void> {
    if (this.scanning) {
      new Notice("A scan is already running.");
      return;
    }

    const client = new LlmClient(this.settings);
    if (!client.configured()) {
      new Notice("Contradiction Finder: set your LLM API key/base URL in settings first.");
      return;
    }

    this.scanning = true;
    this.refreshView();
    await this.activateView();

    const notice = new Notice("Starting contradiction scan...", 0);
    try {
      const results = await scanVault({
        vault: this.app.vault,
        client,
        settings: this.settings,
        cache: this.embeddingCache,
        onProgress: (msg) => notice.setMessage(msg),
        saveCache: () => this.saveStoredData(),
      });
      this.contradictions = results;
      await this.saveStoredData();
      notice.setMessage(
        results.length === 0
          ? "Scan complete: no contradictions found."
          : `Scan complete: ${results.length} contradiction(s) found.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notice.setMessage(`Contradiction scan failed: ${msg}`);
    } finally {
      this.scanning = false;
      this.refreshView();
      // Let the final message linger, then dismiss.
      window.setTimeout(() => notice.hide(), 4000);
    }
  }

  /** Repaint any open Contradictions views. */
  private refreshView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTRADICTIONS)) {
      const view = leaf.view;
      if (view instanceof ContradictionsView) view.render();
    }
  }

  async loadStoredData(): Promise<void> {
    const data = (await this.loadData()) as Partial<PluginData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.embeddingCache = data?.embeddingCache ?? {};
    this.contradictions = data?.contradictions ?? [];
  }

  async saveStoredData(): Promise<void> {
    const data: PluginData = {
      settings: this.settings,
      embeddingCache: this.embeddingCache,
      contradictions: this.contradictions,
    };
    await this.saveData(data);
  }

  /** Used by the settings tab after each change. */
  async saveSettings(): Promise<void> {
    await this.saveStoredData();
  }
}
