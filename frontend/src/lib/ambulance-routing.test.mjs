import test from "node:test";
import assert from "node:assert/strict";
import {
  haversineDistanceM,
  calculateBearing,
  polylineLengthM,
  interpolateAlongPolyline,
  generateCurvedRoute,
} from "./ambulance-routing.ts";

test("haversineDistanceM computes realistic distances", () => {
  // Guwahati station to GMCH (~4.5 km)
  const p1 = [26.1824, 91.7518];
  const p2 = [26.1554, 91.7745];
  const dist = haversineDistanceM(p1, p2);
  assert.ok(dist > 3500 && dist < 5500, `Expected ~4.5km, got ${dist}m`);
});

test("calculateBearing computes cardinal directions correctly", () => {
  // Due North
  const north = calculateBearing([0, 0], [1, 0]);
  assert.ok(Math.abs(north - 0) < 0.1 || Math.abs(north - 360) < 0.1, `Due north should be 0 deg, got ${north}`);

  // Due East
  const east = calculateBearing([0, 0], [0, 1]);
  assert.ok(Math.abs(east - 90) < 0.1, `Due east should be 90 deg, got ${east}`);

  // Due South
  const south = calculateBearing([1, 0], [0, 0]);
  assert.ok(Math.abs(south - 180) < 0.1, `Due south should be 180 deg, got ${south}`);

  // Due West
  const west = calculateBearing([0, 1], [0, 0]);
  assert.ok(Math.abs(west - 270) < 0.1, `Due west should be 270 deg, got ${west}`);
});

test("polylineLengthM calculates sum of segments", () => {
  const points = [
    [26.1824, 91.7518],
    [26.1700, 91.7600],
    [26.1554, 91.7745],
  ];
  const d1 = haversineDistanceM(points[0], points[1]);
  const d2 = haversineDistanceM(points[1], points[2]);
  const total = polylineLengthM(points);
  assert.ok(Math.abs(total - (d1 + d2)) < 0.1);
});

test("interpolateAlongPolyline smoothly walks between points", () => {
  const points = [
    [26.1824, 91.7518],
    [26.1700, 91.7600],
    [26.1554, 91.7745],
  ];

  // At 0% progress
  const start = interpolateAlongPolyline(points, 0);
  assert.deepEqual(start.position, points[0]);
  assert.equal(start.completedDistanceM, 0);

  // At 50% progress
  const mid = interpolateAlongPolyline(points, 0.5);
  assert.ok(mid.position[0] < points[0][0] && mid.position[0] > points[2][0]);
  assert.ok(mid.remainingDistanceM > 0);
  assert.ok(mid.completedDistanceM > 0);

  // At 100% progress
  const end = interpolateAlongPolyline(points, 1.0);
  assert.deepEqual(end.position, points[2]);
  assert.equal(end.remainingDistanceM, 0);
});

test("generateCurvedRoute generates valid non-empty route", () => {
  const start = [26.1824, 91.7518];
  const end = [26.1554, 91.7745];
  const route = generateCurvedRoute(start, end, 8);
  assert.equal(route.length, 9); // start + 7 intermediate + end
  assert.deepEqual(route[0], start);
  assert.deepEqual(route[route.length - 1], end);
});
