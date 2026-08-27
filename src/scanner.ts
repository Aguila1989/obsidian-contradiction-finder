import { TFile } from "obsidian";
import { ChatMessage, cosineSimilarity } from "./llm";
import { ContradictionSettings } from "./settings";

/** One cached embedding, keyed by file path. `mtime` invalidates it on edit. */
export interface EmbeddingCacheEntry {
  mtime: number;
  vector: number[];
  /** Embedding model that produced the vector; vectors from different models are not comparable. */
  model?: string;
}

/** A confirmed contradiction between two notes, ready to render. */
export interface Contradiction {
  pathA: string;
  titleA: string;
  pathB: string;
  titleB: string;
  statementA: string;
  statementB: string;
  explanation: string;
  confidence: number;
}

/** Compact per-note representation fed to the embedder and the verifier. */
export interface NoteRepr {
  file: TFile;
  title: string;
  text: string;
}

/** The slice of `Vault` the scanner needs (injectable for tests). */
export interface VaultReader {
  getMarkdownFiles(): TFile[];
  cachedRead(file: TFile): Promise<string>;
}

/** The slice of `LlmClient` the scanner needs (injectable for tests). */
export interface ScanLlm {
  embed(texts: string[]): Promise<number[][]>;
  chatJson<T = unknown>(
    messages: ChatMessage[],
    opts?: { temperature?: number },
  ): Promise<T>;
}

/** Shape the LLM must return for each candidate pair. */
interface VerifyResult {
  contradiction: boolean;
  confidence: number;
  statementA: string;
  statementB: string;
  explanation: string;
}

export interface ScanDeps {
  vault: VaultReader;
  client: ScanLlm;
  settings: ContradictionSettings;
  /** Persistent embedding cache (mutated in place, then saved by the caller). */
  cache: Record<string, EmbeddingCacheEntry>;
  /** Report human-readable progress (e.g. drive a Notice). */
  onProgress: (message: string) => void;
  /** Persist the embedding cache after it is refreshed. */
  saveCache: () => Promise<void>;
}

const EMBED_CHUNK = 50;

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read every markdown file and reduce it to title + a leading text slice.
 * Frontmatter delimiters add noise, so the raw body is used as-is up to the cap.
 */
async function buildReprs(vault: VaultReader, maxChars: number): Promise<NoteRepr[]> {
  const files = vault.getMarkdownFiles();
  const reprs: NoteRepr[] = [];
  for (const file of files) {
    let body = "";
    try {
      body = await vault.cachedRead(file);
    } catch {
      continue; // unreadable file: skip rather than abort the whole scan
    }
    const text = body.slice(0, maxChars).trim();
    if (text.length === 0) continue; // nothing to compare
    reprs.push({ file, title: file.basename, text });
  }
  return reprs;
}

/**
 * Ensure every note has a current embedding, reusing the cache when the file's
 * mtime is unchanged and the vector came from the currently configured
 * embedding model. Returns a path -> vector map for the pairing step.
 */
async function ensureEmbeddings(
  deps: ScanDeps,
  reprs: NoteRepr[],
): Promise<Map<string, number[]>> {
  const { client, cache, onProgress, saveCache, settings } = deps;
  const model = settings.embeddingModel;
  const vectors = new Map<string, number[]>();
  const toEmbed: NoteRepr[] = [];

  for (const r of reprs) {
    const cached = cache[r.file.path];
    if (cached && cached.mtime === r.file.stat.mtime && cached.model === model) {
      vectors.set(r.file.path, cached.vector);
    } else {
      toEmbed.push(r);
    }
  }

  // Drop cache entries for notes that no longer exist / were skipped.
  const alive = new Set(reprs.map((r) => r.file.path));
  let pruned = false;
  for (const path of Object.keys(cache)) {
    if (!alive.has(path)) {
      delete cache[path];
      pruned = true;
    }
  }

  if (toEmbed.length === 0) {
    if (pruned) await saveCache();
    return vectors;
  }

  const batches = chunk(toEmbed, EMBED_CHUNK);
  let done = 0;
  for (const batch of batches) {
    onProgress(`Embedding notes ${done + 1}-${done + batch.length} of ${toEmbed.length}...`);
    const embeddings = await client.embed(batch.map((r) => `${r.title}\n\n${r.text}`));
    for (let i = 0; i < batch.length; i++) {
      const vec = embeddings[i];
      if (!vec) continue;
      const path = batch[i].file.path;
      cache[path] = { mtime: batch[i].file.stat.mtime, vector: vec, model };
      vectors.set(path, vec);
    }
    done += batch.length;
  }

  await saveCache();
  return vectors;
}

export interface CandidatePair {
  a: NoteRepr;
  b: NoteRepr;
  similarity: number;
}

/** All above-threshold pairs, most-similar first, capped to maxPairs. */
export function candidatePairs(
  reprs: NoteRepr[],
  vectors: Map<string, number[]>,
  threshold: number,
  maxPairs: number,
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (let i = 0; i < reprs.length; i++) {
    const va = vectors.get(reprs[i].file.path);
    if (!va) continue;
    for (let j = i + 1; j < reprs.length; j++) {
      const vb = vectors.get(reprs[j].file.path);
      if (!vb) continue;
      const sim = cosineSimilarity(va, vb);
      if (sim >= threshold) pairs.push({ a: reprs[i], b: reprs[j], similarity: sim });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs.slice(0, maxPairs);
}

const SYSTEM_PROMPT =
  "You are a meticulous fact-checking assistant. You are given two notes and must decide " +
  "whether they contain claims that logically contradict each other (they cannot both be true). " +
  "Differences in scope, topic, or opinion are NOT contradictions. Respond with strict JSON only.";

/** Ask the LLM whether a single pair genuinely contradicts. Returns null on error. */
async function verifyPair(
  client: ScanLlm,
  pair: CandidatePair,
): Promise<VerifyResult | null> {
  const user =
    `Note A title: ${pair.a.title}\nNote A text:\n${pair.a.text}\n\n` +
    `Note B title: ${pair.b.title}\nNote B text:\n${pair.b.text}\n\n` +
    `Return JSON with exactly these fields:\n` +
    `{"contradiction": boolean, "confidence": number (0-1), ` +
    `"statementA": string (the conflicting claim from A, verbatim or paraphrased), ` +
    `"statementB": string (the conflicting claim from B), ` +
    `"explanation": string (one sentence on why they conflict)}. ` +
    `If there is no genuine contradiction, set contradiction=false and leave the statement fields empty.`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];

  try {
    const r = await client.chatJson<VerifyResult>(messages, { temperature: 0 });
    if (typeof r.contradiction !== "boolean") return null;
    return r;
  } catch {
    return null; // one bad pair should not abort the scan
  }
}

/**
 * Full pipeline: build reprs -> embed (cached) -> pair by similarity ->
 * verify each candidate with the LLM -> collect confirmed contradictions.
 */
export async function scanVault(deps: ScanDeps): Promise<Contradiction[]> {
  const { vault, client, settings, onProgress } = deps;

  onProgress("Reading notes...");
  const reprs = await buildReprs(vault, settings.maxCharsPerNote);
  if (reprs.length < 2) {
    throw new Error("Need at least two non-empty notes to compare.");
  }

  const vectors = await ensureEmbeddings(deps, reprs);

  onProgress("Finding related pairs...");
  const candidates = candidatePairs(
    reprs,
    vectors,
    settings.similarityThreshold,
    settings.maxPairs,
  );
  if (candidates.length === 0) {
    return [];
  }

  const confirmed: Contradiction[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const pair = candidates[i];
    onProgress(`Verifying pair ${i + 1} of ${candidates.length}...`);
    const result = await verifyPair(client, pair);
    if (result && result.contradiction) {
      confirmed.push({
        pathA: pair.a.file.path,
        titleA: pair.a.title,
        pathB: pair.b.file.path,
        titleB: pair.b.title,
        statementA: result.statementA ?? "",
        statementB: result.statementB ?? "",
        explanation: result.explanation ?? "",
        confidence: typeof result.confidence === "number" ? result.confidence : 0,
      });
    }
  }

  confirmed.sort((a, b) => b.confidence - a.confidence);
  return confirmed;
}
