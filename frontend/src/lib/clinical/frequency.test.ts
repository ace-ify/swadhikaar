/**
 * Self-check for the PS-01 frequency parser. Run: npm test (node --test).
 *
 * The checks that matter most: (1) a schedule parsed from an abbreviation never
 * leaks that abbreviation into the patient-facing text (ISMP safety), and (2) the
 * "on" collision — "Morning on empty stomach" must NOT be read as omni-nocte
 * (night). Both are the written-but-never-read class of failure: the app renders
 * something plausible while quietly scheduling the wrong time.
 *
 * No network, no rendering, no fixtures.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// Specifier in a variable so tsc (moduleResolution: bundler) accepts it while
// node's native type stripping still gets the .ts extension it needs.
const spec = "./frequency.ts";
const { parseFrequency, scheduleToText, scheduleToCanonicalFrequency, buildMedicationICS } = (await import(spec)) as typeof import("./frequency");

test("positional 1-0-1 = morning + night", () => {
  const s = parseFrequency("1-0-1");
  assert.deepEqual(s.slots, { morning: 1, afternoon: 0, evening: 0, night: 1 });
  assert.equal(s.timesPerDay, 2);
  assert.equal(scheduleToText(s), "1 in the morning and 1 at night");
});

test("positional 1-1-1 = morning + afternoon + night", () => {
  assert.deepEqual(parseFrequency("1-1-1").slots, { morning: 1, afternoon: 1, evening: 0, night: 1 });
});

test("4-position 1-0-0-1 keeps evening slot", () => {
  assert.deepEqual(parseFrequency("1-0-0-1").slots, { morning: 1, afternoon: 0, evening: 0, night: 1 });
});

test("BD = twice, morning + night; no raw abbreviation leaks", () => {
  const s = parseFrequency("Twice daily (BD)");
  assert.equal(s.timesPerDay, 2);
  assert.equal(s.slots.morning, 1);
  assert.equal(s.slots.night, 1);
  assert.doesNotMatch(scheduleToText(s).toLowerCase(), /\bbd\b/);
});

test("TDS = three doses; QID = four", () => {
  assert.equal(parseFrequency("Thrice daily (TDS)").timesPerDay, 3);
  assert.equal(parseFrequency("QID").timesPerDay, 4);
});

test("once daily at bedtime (HS) = night only", () => {
  const s = parseFrequency("Once daily at bedtime (HS)");
  assert.equal(s.timesPerDay, 1);
  assert.equal(s.slots.night, 1);
  assert.equal(scheduleToText(s), "1 at night");
});

test("once daily after lunch = afternoon + after food", () => {
  const s = parseFrequency("Once daily after lunch (OD)");
  assert.equal(s.slots.afternoon, 1);
  assert.equal(s.food, "after");
});

test("the 'on' collision: morning on empty stomach is MORNING (before food), not night", () => {
  const s = parseFrequency("Morning on empty stomach (OD)");
  assert.equal(s.slots.morning, 1);
  assert.equal(s.slots.night, 0);
  assert.equal(s.food, "before");
});

test("SOS / as needed for fever = prn, no fixed dose", () => {
  const s = parseFrequency("SOS / As needed for fever");
  assert.equal(s.prn, true);
  assert.equal(s.timesPerDay, 0);
  assert.equal(s.prnCondition, "fever");
});

test("q8h = three slots, q6h = four", () => {
  assert.equal(parseFrequency("q8h").timesPerDay, 3);
  assert.equal(parseFrequency("q6h").timesPerDay, 4);
});

test("STAT = one dose now", () => {
  const s = parseFrequency("STAT");
  assert.equal(s.stat, true);
  assert.match(scheduleToText(s), /One dose now/);
});

test("empty and gibberish flag needsReview instead of guessing", () => {
  assert.equal(parseFrequency("").needsReview, true);
  assert.equal(parseFrequency("qwerty zzz").needsReview, true);
  assert.match(scheduleToText(parseFrequency("")), /confirm the timing/);
});

test("Hindi rendering uses times, not abbreviations", () => {
  const s = parseFrequency("BD");
  const hi = scheduleToText(s, "hi");
  assert.match(hi, /सुबह/);
  assert.match(hi, /रात/);
});

test("schedule round-trips through canonical frequency (persistence)", () => {
  // Verified schedules persist in the existing text column; parsing the serialized
  // form back must reproduce the slots/prn/food so a patient's correction sticks.
  for (const raw of [
    "1-0-1",
    "BD",
    "TDS",
    "Once daily at bedtime (HS)",
    "Once daily after lunch (OD)",
    "q8h",
    "SOS / As needed for fever",
  ]) {
    const a = parseFrequency(raw);
    const b = parseFrequency(scheduleToCanonicalFrequency(a));
    assert.deepEqual(b.slots, a.slots, `slots mismatch for "${raw}"`);
    assert.equal(b.prn, a.prn, `prn mismatch for "${raw}"`);
    assert.equal(b.food, a.food, `food mismatch for "${raw}"`);
    assert.equal(b.timesPerDay, a.timesPerDay, `count mismatch for "${raw}"`);
  }
});

test("ICS: a BD medicine yields two daily recurring reminder events", () => {
  const ics = buildMedicationICS([
    { name: "Metoprolol", dosage: "50 mg", duration_days: 30, schedule: parseFrequency("BD") },
  ]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2); // morning + night
  assert.match(ics, /RRULE:FREQ=DAILY;COUNT=30/);
  assert.match(ics, /SUMMARY:Take Metoprolol 50 mg/);
  assert.match(ics, /BEGIN:VALARM/);
});

test("ICS: as-needed (prn) medicines produce no recurring reminder", () => {
  const ics = buildMedicationICS([{ name: "Paracetamol", schedule: parseFrequency("SOS / As needed for fever") }]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});

test("ICS: uses CRLF line endings (RFC 5545)", () => {
  assert.match(buildMedicationICS([{ name: "X", schedule: parseFrequency("OD") }]), /\r\n/);
});
