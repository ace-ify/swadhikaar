/**
 * Self-check for the PS-02 care-need matcher. Run: npm test (node --test).
 * The check that matters: the care-need filter must survive the source data's noise
 * (misspellings, procedure-text leakage) without false positives.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const spec = "./specialties.ts";
const { CARE_NEEDS, matchesCareNeed } = (await import(spec)) as typeof import("./specialties");

test("cardiology matches only hospitals that list it", () => {
  assert.equal(matchesCareNeed(["Cardiology", "General Medicine"], "cardiology"), true);
  assert.equal(matchesCareNeed(["General Medicine"], "cardiology"), false);
});

test("ophthalmology matches the source's misspelling 'Opthalmology'", () => {
  assert.equal(matchesCareNeed(["Opthalmology"], "ophthalmology"), true);
  assert.equal(matchesCareNeed(["Ophthalmology"], "ophthalmology"), true);
});

test("ENT does not false-positive on 'Treatment Procedure' noise", () => {
  assert.equal(matchesCareNeed(["Treatment Procedure Head & Neck"], "ent"), false);
  assert.equal(matchesCareNeed(["Otorhinolaryngology"], "ent"), true);
});

test("an unknown care-need id does not filter anything out", () => {
  assert.equal(matchesCareNeed(["General Medicine"], "nonexistent"), true);
});

test("every care-need has non-empty match tokens", () => {
  for (const c of CARE_NEEDS) assert.ok(c.match.length > 0, c.id);
});
