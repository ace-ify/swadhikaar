import type { PmjayChunk } from "./corpus";

/**
 * Lexical retrieval for the bounded PM-JAY RAG. A small, bounded scheme corpus does
 * not need vectors — term overlap is enough and is deterministic. The important part
 * (per the design research) is CODE-ENFORCED grounding: a query must share real terms
 * with a passage or retrieval returns nothing, which the route turns into a refusal.
 */

const STOP = new Set([
  "the", "a", "an", "is", "are", "of", "to", "for", "and", "or", "in", "on", "at", "with", "it",
  "this", "that", "if", "you", "your", "my", "i", "can", "will", "be", "do", "does", "what", "how",
  "who", "when", "where", "which", "about", "get", "got", "need", "am", "me", "we", "they",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9₹]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export interface Retrieved {
  chunk: PmjayChunk;
  score: number;
}

export function retrieve(query: string, corpus: PmjayChunk[], k = 3): Retrieved[] {
  const qset = new Set(tokenize(query));
  if (!qset.size) return [];
  const scored = corpus.map((c) => {
    const words = new Set(tokenize(`${c.section} ${c.text}`));
    let score = 0;
    for (const w of qset) if (words.has(w)) score += 1;
    return { chunk: c, score };
  });
  // Grounding gate: require genuine overlap (2 terms, or 1 for a single-term query);
  // nothing clears it => empty => the route refuses rather than inventing an answer.
  const need = Math.min(2, qset.size);
  return scored
    .filter((s) => s.score >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
