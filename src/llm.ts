// Shared, dependency-free LLM client for OpenAI-compatible endpoints (OpenAI, Ollama, LM Studio, ...).
// Provided identically to every AI plugin. Do not add npm dependencies.
import { requestUrl } from "obsidian";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  transcriptionModel: string;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4o-mini",
  embeddingModel: "text-embedding-3-small",
  transcriptionModel: "whisper-1",
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LlmClient {
  constructor(private settings: LlmSettings) {}

  private base(): string {
    return this.settings.baseUrl.replace(/\/+$/, "");
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.settings.apiKey) h["Authorization"] = "Bearer " + this.settings.apiKey;
    return h;
  }

  configured(): boolean {
    return this.base().length > 0 && (this.settings.apiKey.length > 0 || this.base().includes("localhost") || this.base().includes("127.0.0.1"));
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; json?: boolean } = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.settings.chatModel,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.json) body.response_format = { type: "json_object" };
    const res = await requestUrl({
      url: this.base() + "/chat/completions",
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status >= 400) throw new Error("LLM chat failed (" + res.status + "): " + res.text);
    return res.json?.choices?.[0]?.message?.content ?? "";
  }

  async chatJson<T = unknown>(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<T> {
    const raw = await this.chat(messages, { ...opts, json: true });
    return JSON.parse(extractJson(raw)) as T;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await requestUrl({
      url: this.base() + "/embeddings",
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ model: this.settings.embeddingModel, input: texts }),
      throw: false,
    });
    if (res.status >= 400) throw new Error("LLM embed failed (" + res.status + "): " + res.text);
    return (res.json?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
  }

  async transcribe(audio: Blob, filename = "audio.webm"): Promise<string> {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", this.settings.transcriptionModel);
    const res = await fetch(this.base() + "/audio/transcriptions", {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error("Transcription failed (" + res.status + "): " + (await res.text()));
    const data = await res.json();
    return data.text ?? "";
  }
}

/** Pull the first JSON object/array out of a possibly fenced LLM response. */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return body.trim();
  return body.slice(start).trim();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
