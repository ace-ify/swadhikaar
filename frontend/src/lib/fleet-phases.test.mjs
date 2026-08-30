// One check, and it guards the thing most likely to break: the crew's buttons drifting
// out of step with set_ambulance_phase's transition table. A button the database refuses
// is a crew pressing "arrived" on a roadside and being told nothing happened.
//
//   node --test src/lib/fleet-phases.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED,
  LADDER,
  PHASE_LABEL,
  metresBetween,
  ON_SCENE_RADIUS_M,
} from "./fleet-phases.ts";

test("every ladder button proposes a transition the database accepts", () => {
  for (const step of LADDER) {
    const from = ALLOWED[step.next];
    assert.ok(from, `no ALLOWED entry for phase ${step.next}`);
    assert.ok(
      from.includes(step.from),
      `button "${step.label}" fires ${step.from} -> ${step.next}, which set_ambulance_phase refuses`,
    );
  }
});

test("the ladder is one unbroken chain from en_route to complete", () => {
  let at = "en_route";
  const seen = [at];
  for (let i = 0; i < LADDER.length; i++) {
    const step = LADDER.find((s) => s.from === at);
    assert.ok(step, `nothing to press from ${at} — the run would dead-end here`);
    at = step.next;
    seen.push(at);
  }
  assert.equal(at, "complete", `chain ended at ${at}: ${seen.join(" -> ")}`);
  // No forks: two buttons from one state would let a crew skip the hospital.
  assert.equal(new Set(LADDER.map((s) => s.from)).size, LADDER.length);
});

test("every phase the ladder can reach has a label the crew can read", () => {
  for (const step of LADDER) {
    if (step.next === "complete") continue; // not a stored state; the run ends
    assert.ok(PHASE_LABEL[step.next], `no label for ${step.next}`);
  }
  assert.ok(PHASE_LABEL.en_route);
});

test("the geofence measures metres, not degrees or kilometres", () => {
  // Patna Junction to Gandhi Maidan, ~1.9 km apart.
  const d = metresBetween(25.6019, 85.1376, 25.6127, 85.1439);
  assert.ok(d > 1000 && d < 3000, `expected ~1.9 km in metres, got ${d}`);

  // Two points ~150 m apart must fall inside the auto-arrival radius, and the same
  // pair a kilometre apart must not: this is the assertion that fails if the function
  // ever starts returning kilometres.
  assert.ok(metresBetween(25.6019, 85.1376, 25.6032, 85.1376) < ON_SCENE_RADIUS_M);
  assert.ok(metresBetween(25.6019, 85.1376, 25.6109, 85.1376) > ON_SCENE_RADIUS_M);
  assert.equal(metresBetween(25.6019, 85.1376, 25.6019, 85.1376), 0);
});
