/**
 * Self-check for the bounded PM-JAY retrieval. Run: npm test (node --test).
 * The check that matters: off-topic / out-of-corpus questions retrieve NOTHING, so
 * the assistant refuses instead of hallucinating scheme facts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const corpusSpec = "./corpus.ts";
const retrieveSpec = "./retrieve.ts";
const { PMJAY_CORPUS } = (await import(corpusSpec)) as typeof import("./corpus");
const { retrieve } = (await import(retrieveSpec)) as typeof import("./retrieve");

test("a documents question retrieves the documents passage", () => {
  const r = retrieve("what documents do I carry to the hospital", PMJAY_CORPUS);
  assert.ok(r.length > 0);
  assert.equal(r[0].chunk.id, "documents");
});

test("a cover-amount question hits the cover passage", () => {
  const r = retrieve("how much money cover per year", PMJAY_CORPUS);
  assert.ok(r.some((x) => x.chunk.id === "cover"));
});

test("off-topic questions are refused (nothing clears the grounding gate)", () => {
  assert.equal(retrieve("what is today's weather forecast", PMJAY_CORPUS).length, 0);
  assert.equal(retrieve("latest cricket score", PMJAY_CORPUS).length, 0);
});

test("an empty query refuses", () => {
  assert.equal(retrieve("", PMJAY_CORPUS).length, 0);
});

test("every corpus chunk carries a citation", () => {
  for (const c of PMJAY_CORPUS) {
    assert.ok(c.source && c.url, c.id);
  }
});
