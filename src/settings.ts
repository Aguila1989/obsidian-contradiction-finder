import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_LLM_SETTINGS, LlmSettings } from "./llm";
import type ContradictionFinderPlugin from "./main";

/** All persisted settings: the shared LLM fields plus this plugin's tuning knobs. */
export interface ContradictionSettings extends LlmSettings {
  /** Minimum cosine similarity for a pair to be worth verifying with the LLM. */
  similarityThreshold: number;
  /** Hard cap on how many candidate pairs get sent to the LLM (bounds cost). */
  maxPairs: number;
  /** How many characters of each note to embed / show the model. */
  maxCharsPerNote: number;
}

export const DEFAULT_SETTINGS: ContradictionSettings = {
  ...DEFAULT_LLM_SETTINGS,
  similarityThreshold: 0.8,
  maxPairs: 40,
  maxCharsPerNote: 1500,
};

export class ContradictionSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ContradictionFinderPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("LLM connection").setHeading();

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("OpenAI-compatible endpoint. Works with OpenAI, Ollama, or LM Studio.")
      .addText((t) =>
        t
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Sent as a Bearer token. Leave empty for local servers.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc("Model used to verify whether a pair of notes actually contradicts.")
      .addText((t) =>
        t
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (v) => {
            this.plugin.settings.chatModel = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Model used to find related notes before verification.")
      .addText((t) =>
        t
          .setPlaceholder("text-embedding-3-small")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (v) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Scan tuning").setHeading();

    new Setting(containerEl)
      .setName("Similarity threshold")
      .setDesc("Only pairs above this cosine similarity (0-1) are checked. Higher = fewer, tighter pairs.")
      .addSlider((s) =>
        s
          .setLimits(0.5, 0.99, 0.01)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.similarityThreshold)
          .onChange(async (v) => {
            this.plugin.settings.similarityThreshold = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max pairs to verify")
      .setDesc("Upper bound on LLM verification calls per scan. Bounds cost and time.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.maxPairs))
          .onChange(async (v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.maxPairs = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Characters per note")
      .setDesc("How much of each note is embedded and shown to the model.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.maxCharsPerNote))
          .onChange(async (v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.maxCharsPerNote = n;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}
