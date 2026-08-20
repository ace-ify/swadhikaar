// Runnable check for the acute → continuity seam logic.
//   node supabase/functions/_shared/acute-seam.test.ts
// Node >= 22.6 strips the types; no test framework, no deps.

import assert from "node:assert/strict";
import {
  FALLBACK_SCHEDULE_DAYS,
  recoverySchedule,
  validateIncident,
} from "./acute-seam.ts";

// ---- recoverySchedule -------------------------------------------------------

{
  const slots = recoverySchedule("2026-07-30T18:45:00Z", FALLBACK_SCHEDULE_DAYS);
  assert.equal(slots.length, 5, "five protocol days → five slots");
  assert.deepEqual(slots, [
    "2026-07-31T04:30:00.000Z", // +1
    "2026-08-02T04:30:00.000Z", // +3, crosses the month boundary
    "2026-08-06T04:30:00.000Z", // +7
    "2026-08-13T04:30:00.000Z", // +14
    "2026-08-29T04:30:00.000Z", // +30
  ], "day offsets land on the right dates at the fixed call window");
}

{
  // Leap-year February must not be hand-rolled.
  const slots = recoverySchedule("2028-02-27T23:59:59Z", [1, 3]);
  assert.deepEqual(slots, [
    "2028-02-28T04:30:00.000Z",
    "2028-03-01T04:30:00.000Z", // 2028 is a leap year: 29 Feb exists, so +3 = 1 Mar
  ], "leap year arithmetic comes from Date, not from us");
}

{
  // A late-evening incident must not schedule Day 1 in the past-adjacent hours
  // of the same calendar day.
  const [dayOne] = recoverySchedule("2026-07-30T23:30:00Z", [1]);
  assert.ok(
    new Date(dayOne) > new Date("2026-07-30T23:30:00Z"),
    "Day 1 is always in the future relative to completion",
  );
}

assert.throws(
  () => recoverySchedule("not-a-date", [1]),
  /not a valid timestamp/,
  "garbage timestamps are rejected, not silently coerced to Invalid Date",
);

// ---- validateIncident ------------------------------------------------------

{
  const { errors, clean } = validateIncident({
    incident_id: "  H-LKO-18-4471  ",
    name: "  Shikhar Shahi ",
    abha_id: "12-3456-7890-1234",
    language: "hindi",
    incident_type: "road traffic accident",
    severity: "critical",
    completed_at: "2026-07-30T18:45:00Z",
  });
  assert.deepEqual(errors, []);
  assert.equal(clean?.incidentId, "H-LKO-18-4471", "whitespace is trimmed");
  assert.equal(clean?.name, "Shikhar Shahi");
  assert.equal(clean?.severity, "CRITICAL", "severity is normalised upward");
}

{
  const { errors } = validateIncident({ incident_id: "x", name: "Asha Devi" });
  assert.ok(
    errors.some((e) => e.includes("abha_id or phone")),
    "a patient with no identifier at all is rejected",
  );
}

{
  const { errors } = validateIncident({ name: "Asha Devi", phone: "+919876543210" });
  assert.ok(errors.some((e) => e.includes("incident_id")), "incident_id is required");
}

{
  const { errors } = validateIncident({
    incident_id: "x",
    name: "y".repeat(201),
    phone: "+919876543210",
  });
  assert.ok(errors.some((e) => e.includes("name")), "oversized name is rejected");
}

{
  const { errors } = validateIncident({
    incident_id: "x",
    name: "Asha Devi",
    phone: "+919876543210",
    completed_at: "31-07-2026",
  });
  assert.ok(errors.some((e) => e.includes("ISO-8601")), "non-ISO timestamp is rejected");
}

{
  // Phone-only patients are legitimate: most emergency victims have no ABHA ID
  // on them at the scene.
  const { errors, clean } = validateIncident({
    incident_id: "x",
    name: "Asha Devi",
    phone: "+919876543210",
  });
  assert.deepEqual(errors, []);
  assert.equal(clean?.abhaId, undefined);
  assert.equal(clean?.language, "hindi", "language defaults rather than failing");
  assert.equal(clean?.severity, "HIGH", "severity defaults rather than failing");
  assert.ok(clean?.completedAt, "completed_at defaults to now");
}

{
  const { clean } = validateIncident({
    incident_id: "x",
    name: "Asha Devi",
    phone: "+919876543210",
    diagnosis: [
      { code: "22298006", display: "Myocardial infarction" },
      {}, // empty entries are dropped, not passed through as junk codes
      { display: "Polytrauma" },
    ],
  });
  assert.equal(clean?.diagnosis.length, 2, "empty diagnosis entries are dropped");
}

{
  const { clean } = validateIncident({
    incident_id: "x",
    name: "Asha Devi",
    phone: "+919876543210",
    diagnosis: Array.from({ length: 50 }, () => ({ code: "1" })),
  });
  assert.equal(clean?.diagnosis.length, 20, "diagnosis list is capped at 20");
}

console.log("acute-seam: all checks passed");
