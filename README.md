# Contradiction Finder

Finds pairs of notes in your vault whose claims contradict each other, using
embeddings to find related notes and an LLM to verify genuine conflicts.
Knowledge bases drift: two notes written months apart can end up asserting
opposite things ("we deploy on Fridays" vs. "we never deploy on Fridays").
This plugin surfaces those conflicts so you can reconcile them.

## Features

- **Four-stage scan pipeline**:
  1. **Represent** — every markdown note is reduced to its title plus the first
     ~1500 characters of body text (configurable).
  2. **Embed** — notes are embedded in batches of 50 via the configured embedding
     model. Vectors are cached in plugin data keyed by file path + mtime, so
     re-scans only re-embed notes that changed.
  3. **Pair** — cosine similarity is computed across all note pairs; only pairs
     above the similarity threshold (default 0.80) are kept, since unrelated notes
     cannot meaningfully contradict. The most-similar pairs are capped (default 40)
     to bound LLM cost.
  4. **Verify** — each candidate pair is sent to the chat model, which returns a
     strict-JSON verdict: `{ contradiction, confidence, statementA, statementB,
     explanation }`. Only confirmed contradictions are kept.
- **Side panel** — one card per confirmed contradiction: both note titles (click
  to open the file), the two conflicting statements, an explanation, and a
  confidence percentage. A **Rescan** button re-runs the pipeline.
- **Persistent results** — results survive restarts until the next scan.
- **Works with any OpenAI-compatible endpoint** — OpenAI, Ollama, LM Studio.

## How to use

1. Open the plugin settings and enter your LLM base URL and API key (leave the
   key empty for local servers such as Ollama or LM Studio).
2. Run the **Scan vault for contradictions** command, or click the compare
   ribbon icon and press **Rescan** in the panel.
3. A progress notice reports each stage (embedding, pairing, verifying).
4. When the scan finishes, review the cards in the **Contradictions** panel;
   click a note title to jump to that note. The **Open contradictions panel**
   command reveals the panel at any time.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| API base URL | `https://api.openai.com/v1` | OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio). |
| API key | _(empty)_ | Bearer token; leave empty for local servers. |
| Chat model | `gpt-4o-mini` | Verifies whether a pair truly contradicts. |
| Embedding model | `text-embedding-3-small` | Finds related notes. |
| Similarity threshold | `0.80` | Minimum cosine similarity for a pair to be verified. |
| Max pairs to verify | `40` | Upper bound on LLM verification calls per scan. |
| Characters per note | `1500` | How much of each note is embedded and shown to the model. |

## Limitations

- Only the first ~1500 characters of each note are considered; contradictions
  buried deeper in long notes may be missed.
- Similarity + verification are pairwise; a claim spread across three or more
  notes is not detected as a group.
- Verdicts are only as reliable as the chosen model; confidence is the model's
  self-report, not a calibrated probability.
- Large vaults produce O(n²) similarity comparisons in memory; the LLM cost is
  bounded by `maxPairs`, but embedding cost scales with the number of notes.
- Embeddings are cached per file (keyed by mtime and embedding model);
  changing the embedding model automatically re-embeds all notes on the next
  scan, which can be slow/costly on large vaults.
- Note text is sent to the configured LLM endpoint; do not scan a vault whose
  contents may not leave your machine unless the endpoint is local.

## Installation

This plugin is **not yet in the community store**. To install it manually:

1. Build the monorepo so `main.js` is produced from `src/main.ts`.
2. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/contradiction-finder/`.
3. Enable **Contradiction Finder** in Settings → Community plugins.
4. Open the plugin settings and enter your LLM base URL / API key.
5. Add a couple of notes that disagree (e.g. one saying "The office opens at
   8am", another saying "The office opens at 9am"), then run
   **Scan vault for contradictions** and open the panel.
