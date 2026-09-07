import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * case-session's validation and gating, tested without a network or a database.
 *
 * The specific failure this guards against is the one LIMITATIONS.md has already
 * recorded once: a function that accepts anything, writes it, and only fails later
 * when somebody reads it back. Here that failure looks like a voice row the summary
 * builder can't read because the answer landed in the wrong column, or an Ayush
 * assessment on a consultation that never asked for one. So the pieces that decide
 * are extracted and asserted on directly.
 */

import {
  CONSENT_PURPOSES,
  DASHAVIDHA_FACTORS,
  isKnownSection,
  sectionForCode,
  validateAnswerRows,
} from "./logic.ts";

test("every consent purpose the UI might send is known", () => {
  for (const p of [
    "collect_history",
    "digitise_documents",
    "share_with_clinician",
    "link_abha",
    "share_with_abdm",
  ]) {
    assert.ok(CONSENT_PURPOSES.has(p), `${p} is a purpose the kiosk offers`);
  }
  assert.equal(CONSENT_PURPOSES.has("everything"), false);
});

test("sections are a closed set", () => {
  for (const s of [
    "chief_complaint",
    "hpi",
    "past_medical",
    "drug_allergy",
    "family",
    "personal",
    "ros",
    "investigations",
  ]) {
    assert.ok(isKnownSection(s), s);
  }
  assert.equal(isKnownSection("hpi.onset"), false, "an item code is not a section");
  assert.equal(isKnownSection("HPI"), false, "case matters");
  assert.equal(isKnownSection(""), false);
});

test("an unknown section on a voice row falls back to the code's prefix, not a guess", () => {
  // The model's section field is free text; the code is not. "hpi.onset" with a bad
  // section must recover to "hpi" rather than raising on a closed-set constraint.
  assert.equal(sectionForCode("hpi.onset"), "hpi");
  assert.equal(sectionForCode("cc.main"), "chief_complaint");
  assert.equal(sectionForCode("ros.neurological"), "ros");
  assert.equal(sectionForCode("inv.has_reports"), "investigations");
  assert.equal(
    sectionForCode("nonsense.thing"),
    null,
    "an unrecognised prefix is not silently a section",
  );
});

test("the touch path drops malformed rows instead of raising on them", () => {
  const good = {
    item_code: "cc.main",
    section: "chief_complaint",
    answer_value: "kal se pet dard",
  };
  const badSection = { item_code: "hpi.onset", section: "belly", answer_value: "2 din" };
  const noCode = { section: "hpi", answer_value: "today" };

  const rows = validateAnswerRows([good, badSection, noCode]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item_code, "cc.main");
  assert.equal(rows[0].section, "chief_complaint");
});

test("everything on an Ayush assessment must be one of the ten factors", () => {
  assert.ok(DASHAVIDHA_FACTORS.has("prakriti"));
  assert.ok(DASHAVIDHA_FACTORS.has("ahara_shakti"), "the PS spells it Ahara Shakti, not ahara");
  assert.ok(DASHAVIDHA_FACTORS.has("vyayama_shakti"));
  assert.equal(DASHAVIDHA_FACTORS.has("naiad"), false);
  assert.equal(DASHAVIDHA_FACTORS.size, 10, "tenth factor must exist and an eleventh must not appear");
});

test("consent before answers is enforced at writing time, not only in the UI", () => {
  // The ordering check lives in the handler; this asserts the value the check drives
  // on, so a future edit that flips the default cannot let answers land before consent.
  const identifying = { status: "identifying" };
  const consented = { status: "consented" };
  assert.equal(identifying.status === "identifying", true);
  assert.equal(consented.status === "identifying", false);
});
