import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { ChatMessage } from "../src/llm";
import {
  Contradiction,
  EmbeddingCacheEntry,
  NoteRepr,
  ScanDeps,
  ScanLlm,
  VaultReader,
  candidatePairs,
  chunk,
  scanVault,
} from "../src/scanner";
import { DEFAULT_SETTINGS, ContradictionSettings } from "../src/settings";

// ---- helpers -----------------------------------------------------------------

function makeFile(path: string, mtime = 100): TFile {
  const f = new TFile();
  f.path = path;
  f.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  f.name = `${f.basename}.md`;
  f.stat = { ctime: 0, mtime, size: 0 };
  return f;
}

function makeRepr(path: string, text = "text"): NoteRepr {
  const file = makeFile(path);
  return { file, title: file.basename, text };
}

interface FakeNote {
  file: TFile;
  content: string;
  /** When true, cachedRead rejects for this file. */
  unreadable?: boolean;
}

class FakeVault implements VaultReader {
  constructor(private notes: FakeNote[]) {}
  getMarkdownFiles(): TFile[] {
    return this.notes.map((n) => n.file);
  }
  async cachedRead(file: TFile): Promise<string> {
    const note = this.notes.find((n) => n.file.path === file.path);
    if (!note || note.unreadable) throw new Error("unreadable");
    return note.content;
  }
}

/** Deterministic LLM double: vectors come from a title -> vector map, verdicts from a "titleA|titleB" map. */
class FakeLlm implements ScanLlm {
  embedCalls: string[][] = [];
  chatCalls: string[] = [];
  constructor(
    private vectorByTitle: Record<string, number[]> = {},
    private verdictByPair: Record<string, unknown> = {},
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    this.embedCalls.push(texts);
    return texts.map((t) => {
      const title = t.split("\n")[0];
      return this.vectorByTitle[title] ?? [1, 0];
    });
  }

  async chatJson<T>(messages: ChatMessage[]): Promise<T> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const a = user.match(/Note A title: (.*)\n/)?.[1] ?? "?";
    const b = user.match(/Note B title: (.*)\n/)?.[1] ?? "?";
    const key = `${a}|${b}`;
    this.chatCalls.push(key);
    const verdict = this.verdictByPair[key];
    if (verdict instanceof Error) throw verdict;
    if (verdict === undefined) return { contradiction: false } as T;
    return verdict as T;
  }
}

function makeDeps(overrides: {
  vault: VaultReader;
  client: ScanLlm;
  settings?: Partial<ContradictionSettings>;
  cache?: Record<string, EmbeddingCacheEntry>;
}): ScanDeps & { progress: string[]; saveCache: ReturnType<typeof vi.fn> } {
  const progress: string[] = [];
  const saveCache = vi.fn(async () => {});
  return {
    vault: overrides.vault,
    client: overrides.client,
    settings: { ...DEFAULT_SETTINGS, ...(overrides.settings ?? {}) },
    cache: overrides.cache ?? {},
    onProgress: (m) => progress.push(m),
    saveCache,
    progress,
  };
}

const MODEL = DEFAULT_SETTINGS.embeddingModel;

// ---- chunk ---------------------------------------------------------------------

describe("chunk", () => {
  it("splits into fixed-size chunks with a smaller remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("returns one chunk when size covers everything", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });
});

// ---- candidatePairs --------------------------------------------------------------

describe("candidatePairs", () => {
  it("keeps only pairs at or above the threshold, sorted most-similar first", () => {
    const reprs = [makeRepr("a.md"), makeRepr("b.md"), makeRepr("c.md")];
    const vectors = new Map<string, number[]>([
      ["a.md", [1, 0]],
      ["b.md", [0.9, 0.1]], // cos(a,b) ~ 0.994
      ["c.md", [0, 1]], // cos(a,c) = 0, cos(b,c) ~ 0.110
    ]);

    const pairs = candidatePairs(reprs, vectors, 0.5, 100);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.file.path).toBe("a.md");
    expect(pairs[0].b.file.path).toBe("b.md");
    expect(pairs[0].similarity).toBeCloseTo(0.9939, 3);
  });

  it("includes pairs exactly at the threshold (>= comparison)", () => {
    const reprs = [makeRepr("a.md"), makeRepr("b.md")];
    const vectors = new Map<string, number[]>([
      ["a.md", [1, 0]],
      ["b.md", [1, 0]], // cosine exactly 1
    ]);
    expect(candidatePairs(reprs, vectors, 1, 10)).toHaveLength(1);
  });

  it("sorts descending and caps to maxPairs, keeping the most similar", () => {
    // Four notes: a-b highly similar, a-c medium, everything with d dissimilar.
    const reprs = [makeRepr("a.md"), makeRepr("b.md"), makeRepr("c.md"), makeRepr("d.md")];
    const vectors = new Map<string, number[]>([
      ["a.md", [1, 0]],
      ["b.md", [0.99, 0.01]],
      ["c.md", [0.8, 0.6]], // cos(a,c) = 0.8
      ["d.md", [0, 1]],
    ]);

    const all = candidatePairs(reprs, vectors, 0.7, 100);
    const sims = all.map((p) => p.similarity);
    expect(sims).toEqual([...sims].sort((x, y) => y - x)); // descending

    const capped = candidatePairs(reprs, vectors, 0.7, 1);
    expect(capped).toHaveLength(1);
    expect(capped[0].a.file.path).toBe("a.md");
    expect(capped[0].b.file.path).toBe("b.md"); // the single most-similar pair survives the cap
  });

  it("skips notes that have no vector instead of crashing", () => {
    const reprs = [makeRepr("a.md"), makeRepr("b.md"), makeRepr("c.md")];
    const vectors = new Map<string, number[]>([
      ["a.md", [1, 0]],
      ["c.md", [1, 0]],
      // b.md deliberately missing
    ]);
    const pairs = candidatePairs(reprs, vectors, 0.9, 10);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.file.path).toBe("a.md");
    expect(pairs[0].b.file.path).toBe("c.md");
  });

  it("returns empty for fewer than two vectored notes", () => {
    const reprs = [makeRepr("a.md")];
    const vectors = new Map([["a.md", [1, 0]]]);
    expect(candidatePairs(reprs, vectors, 0, 10)).toEqual([]);
  });
});

// ---- scanVault: note reading -------------------------------------------------------

describe("scanVault note reading", () => {
  it("throws when fewer than two non-empty notes exist", async () => {
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "only note" },
      { file: makeFile("empty.md"), content: "   \n  " }, // whitespace-only: skipped
    ]);
    const deps = makeDeps({ vault, client: new FakeLlm() });
    await expect(scanVault(deps)).rejects.toThrow(/at least two/i);
  });

  it("skips unreadable and empty notes but scans the rest", async () => {
    const client = new FakeLlm({ a: [1, 0], b: [1, 0] });
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "alpha" },
      { file: makeFile("broken.md"), content: "", unreadable: true },
      { file: makeFile("empty.md"), content: "" },
      { file: makeFile("b.md"), content: "beta" },
    ]);
    const deps = makeDeps({ vault, client, settings: { similarityThreshold: 0.9 } });

    await scanVault(deps);
    // Only a.md and b.md were embedded.
    expect(client.embedCalls).toHaveLength(1);
    expect(client.embedCalls[0]).toEqual(["a\n\nalpha", "b\n\nbeta"]);
  });

  it("truncates note text to maxCharsPerNote before embedding", async () => {
    const client = new FakeLlm();
    const vault = new FakeVault([
      { file: makeFile("long.md"), content: "x".repeat(500) },
      { file: makeFile("short.md"), content: "hi" },
    ]);
    const deps = makeDeps({ vault, client, settings: { maxCharsPerNote: 10, similarityThreshold: 1.01 } });

    await scanVault(deps);
    const longInput = client.embedCalls[0][0];
    expect(longInput).toBe(`long\n\n${"x".repeat(10)}`);
  });
});

// ---- scanVault: cache behavior -----------------------------------------------------

describe("scanVault embedding cache", () => {
  it("reuses cached vectors when mtime and model match", async () => {
    const fileA = makeFile("a.md", 111);
    const fileB = makeFile("b.md", 222);
    const client = new FakeLlm();
    const vault = new FakeVault([
      { file: fileA, content: "alpha" },
      { file: fileB, content: "beta" },
    ]);
    const cache: Record<string, EmbeddingCacheEntry> = {
      "a.md": { mtime: 111, vector: [1, 0], model: MODEL },
      "b.md": { mtime: 222, vector: [0, 1], model: MODEL },
    };
    const deps = makeDeps({ vault, client, cache });

    await scanVault(deps);
    expect(client.embedCalls).toHaveLength(0); // nothing re-embedded
    expect(deps.saveCache).not.toHaveBeenCalled(); // nothing changed either
  });

  it("re-embeds a note whose mtime changed and updates the cache entry", async () => {
    const fileA = makeFile("a.md", 999); // newer than cached mtime
    const fileB = makeFile("b.md", 222);
    const client = new FakeLlm({ a: [0.5, 0.5] });
    const vault = new FakeVault([
      { file: fileA, content: "alpha" },
      { file: fileB, content: "beta" },
    ]);
    const cache: Record<string, EmbeddingCacheEntry> = {
      "a.md": { mtime: 111, vector: [1, 0], model: MODEL },
      "b.md": { mtime: 222, vector: [0, 1], model: MODEL },
    };
    const deps = makeDeps({ vault, client, cache });

    await scanVault(deps);
    expect(client.embedCalls).toHaveLength(1);
    expect(client.embedCalls[0]).toEqual(["a\n\nalpha"]); // only the stale note
    expect(cache["a.md"]).toEqual({ mtime: 999, vector: [0.5, 0.5], model: MODEL });
    expect(deps.saveCache).toHaveBeenCalledTimes(1);
  });

  it("re-embeds everything when the embedding model changed", async () => {
    const client = new FakeLlm();
    const vault = new FakeVault([
      { file: makeFile("a.md", 111), content: "alpha" },
      { file: makeFile("b.md", 222), content: "beta" },
    ]);
    const cache: Record<string, EmbeddingCacheEntry> = {
      "a.md": { mtime: 111, vector: [1, 0], model: "old-model" },
      "b.md": { mtime: 222, vector: [0, 1], model: "old-model" },
    };
    const deps = makeDeps({ vault, client, cache, settings: { embeddingModel: "new-model" } });

    await scanVault(deps);
    expect(client.embedCalls[0]).toHaveLength(2);
    expect(cache["a.md"].model).toBe("new-model");
    expect(cache["b.md"].model).toBe("new-model");
  });

  it("treats legacy cache entries without a model field as stale", async () => {
    const client = new FakeLlm();
    const vault = new FakeVault([
      { file: makeFile("a.md", 111), content: "alpha" },
      { file: makeFile("b.md", 222), content: "beta" },
    ]);
    const cache: Record<string, EmbeddingCacheEntry> = {
      "a.md": { mtime: 111, vector: [1, 0] }, // pre-model cache entry
      "b.md": { mtime: 222, vector: [0, 1], model: MODEL },
    };
    const deps = makeDeps({ vault, client, cache });

    await scanVault(deps);
    expect(client.embedCalls[0]).toEqual(["a\n\nalpha"]);
  });

  it("prunes cache entries for deleted notes and persists even when nothing needs embedding", async () => {
    const client = new FakeLlm();
    const vault = new FakeVault([
      { file: makeFile("a.md", 111), content: "alpha" },
      { file: makeFile("b.md", 222), content: "beta" },
    ]);
    const cache: Record<string, EmbeddingCacheEntry> = {
      "a.md": { mtime: 111, vector: [1, 0], model: MODEL },
      "b.md": { mtime: 222, vector: [0, 1], model: MODEL },
      "deleted.md": { mtime: 5, vector: [1, 1], model: MODEL },
    };
    const deps = makeDeps({ vault, client, cache });

    await scanVault(deps);
    expect(cache["deleted.md"]).toBeUndefined();
    expect(client.embedCalls).toHaveLength(0);
    expect(deps.saveCache).toHaveBeenCalledTimes(1); // prune alone still persists
  });

  it("embeds in batches of 50", async () => {
    const notes: FakeNote[] = [];
    for (let i = 0; i < 72; i++) {
      notes.push({ file: makeFile(`n${i}.md`, i), content: `note ${i}` });
    }
    const client = new FakeLlm();
    // Threshold above 1 so the pairing stage yields nothing (we only care about embedding here).
    const deps = makeDeps({ vault: new FakeVault(notes), client, settings: { similarityThreshold: 1.01 } });

    await scanVault(deps);
    expect(client.embedCalls.map((c) => c.length)).toEqual([50, 22]);
    expect(Object.keys(deps.cache)).toHaveLength(72);
  });

  it("skips caching when the API returns fewer vectors than requested", async () => {
    const client = new FakeLlm();
    client.embed = async (texts: string[]) => {
      client.embedCalls.push(texts);
      return [[1, 0]]; // one vector for two inputs
    };
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "alpha" },
      { file: makeFile("b.md"), content: "beta" },
    ]);
    const deps = makeDeps({ vault, client, settings: { similarityThreshold: 0 } });

    const results = await scanVault(deps);
    expect(deps.cache["a.md"]).toBeDefined();
    expect(deps.cache["b.md"]).toBeUndefined(); // no vector, no cache entry
    expect(results).toEqual([]); // single vectored note -> no pairs, no crash
  });
});

// ---- scanVault: verification -------------------------------------------------------

function twoSimilarNotes(): FakeVault {
  return new FakeVault([
    { file: makeFile("a.md"), content: "The office opens at 8am." },
    { file: makeFile("b.md"), content: "The office opens at 9am." },
  ]);
}

describe("scanVault verification", () => {
  it("collects confirmed contradictions with all fields mapped", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0] },
      {
        "a|b": {
          contradiction: true,
          confidence: 0.9,
          statementA: "opens at 8am",
          statementB: "opens at 9am",
          explanation: "Opening times conflict.",
        },
      },
    );
    const deps = makeDeps({ vault: twoSimilarNotes(), client });

    const results = await scanVault(deps);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual<Contradiction>({
      pathA: "a.md",
      titleA: "a",
      pathB: "b.md",
      titleB: "b",
      statementA: "opens at 8am",
      statementB: "opens at 9am",
      explanation: "Opening times conflict.",
      confidence: 0.9,
    });
  });

  it("discards pairs the model says are not contradictions", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0] },
      { "a|b": { contradiction: false, confidence: 0.2, statementA: "", statementB: "", explanation: "" } },
    );
    const deps = makeDeps({ vault: twoSimilarNotes(), client });
    expect(await scanVault(deps)).toEqual([]);
    expect(client.chatCalls).toEqual(["a|b"]); // it was checked, just rejected
  });

  it("skips a pair whose verdict is malformed (contradiction not boolean)", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0] },
      { "a|b": { contradiction: "yes", confidence: 1 } },
    );
    const deps = makeDeps({ vault: twoSimilarNotes(), client });
    expect(await scanVault(deps)).toEqual([]);
  });

  it("survives a chatJson failure on one pair and keeps verifying the others", async () => {
    // Three mutually similar notes -> three candidate pairs; the first verdict throws.
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0], c: [1, 0] },
      {
        "a|b": new Error("rate limited"),
        "a|c": { contradiction: true, confidence: 0.7, statementA: "sa", statementB: "sb", explanation: "e" },
        "b|c": { contradiction: false },
      },
    );
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "one" },
      { file: makeFile("b.md"), content: "two" },
      { file: makeFile("c.md"), content: "three" },
    ]);
    const deps = makeDeps({ vault, client });

    const results = await scanVault(deps);
    expect(client.chatCalls.sort()).toEqual(["a|b", "a|c", "b|c"]);
    expect(results).toHaveLength(1);
    expect(results[0].pathB).toBe("c.md");
  });

  it("defaults missing statements to empty strings and bad confidence to 0", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0] },
      { "a|b": { contradiction: true, confidence: "high" } }, // sloppy model output
    );
    const deps = makeDeps({ vault: twoSimilarNotes(), client });

    const results = await scanVault(deps);
    expect(results[0].statementA).toBe("");
    expect(results[0].statementB).toBe("");
    expect(results[0].explanation).toBe("");
    expect(results[0].confidence).toBe(0);
  });

  it("sorts confirmed contradictions by confidence, highest first", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0], c: [1, 0] },
      {
        "a|b": { contradiction: true, confidence: 0.4, statementA: "", statementB: "", explanation: "" },
        "a|c": { contradiction: true, confidence: 0.95, statementA: "", statementB: "", explanation: "" },
        "b|c": { contradiction: true, confidence: 0.6, statementA: "", statementB: "", explanation: "" },
      },
    );
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "one" },
      { file: makeFile("b.md"), content: "two" },
      { file: makeFile("c.md"), content: "three" },
    ]);
    const deps = makeDeps({ vault, client });

    const results = await scanVault(deps);
    expect(results.map((r) => r.confidence)).toEqual([0.95, 0.6, 0.4]);
  });

  it("makes no LLM verification calls when no pair clears the threshold", async () => {
    const client = new FakeLlm({ a: [1, 0], b: [0, 1] }); // orthogonal: similarity 0
    const deps = makeDeps({ vault: twoSimilarNotes(), client, settings: { similarityThreshold: 0.8 } });

    const results = await scanVault(deps);
    expect(results).toEqual([]);
    expect(client.chatCalls).toEqual([]);
  });

  it("reports progress for each stage", async () => {
    const client = new FakeLlm(
      { a: [1, 0], b: [1, 0] },
      { "a|b": { contradiction: false } },
    );
    const deps = makeDeps({ vault: twoSimilarNotes(), client });

    await scanVault(deps);
    expect(deps.progress[0]).toBe("Reading notes...");
    expect(deps.progress).toContain("Embedding notes 1-2 of 2...");
    expect(deps.progress).toContain("Finding related pairs...");
    expect(deps.progress).toContain("Verifying pair 1 of 1...");
  });

  it("respects maxPairs by only verifying the top pairs", async () => {
    const client = new FakeLlm({
      a: [1, 0],
      b: [0.99, 0.01], // a-b most similar
      c: [0.9, 0.1],
    });
    const vault = new FakeVault([
      { file: makeFile("a.md"), content: "one" },
      { file: makeFile("b.md"), content: "two" },
      { file: makeFile("c.md"), content: "three" },
    ]);
    const deps = makeDeps({ vault, client, settings: { similarityThreshold: 0.5, maxPairs: 1 } });

    await scanVault(deps);
    expect(client.chatCalls).toEqual(["a|b"]);
  });
});
