// Live Ambulance Telemetry & Route Interpolation Utilities

export interface LatLon {
  lat: number;
  lon: number;
}

export type Point = [number, number]; // [lat, lon]

/**
 * Calculates great-circle distance between two points in meters using Haversine formula.
 */
export function haversineDistanceM(p1: Point, p2: Point): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates initial bearing (heading in degrees from 0 to 360) from p1 to p2.
 */
export function calculateBearing(p1: Point, p2: Point): number {
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Calculates total cumulative length of a polyline in meters.
 */
export function polylineLengthM(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineDistanceM(points[i], points[i + 1]);
  }
  return total;
}

export interface InterpolationResult {
  position: Point;
  heading: number;
  segmentIndex: number;
  remainingDistanceM: number;
  completedDistanceM: number;
}

/**
 * Interpolates a point along a polyline given a progress fraction [0, 1].
 */
export function interpolateAlongPolyline(
  points: Point[],
  progress: number
): InterpolationResult {
  if (points.length === 0) {
    return {
      position: [0, 0],
      heading: 0,
      segmentIndex: 0,
      remainingDistanceM: 0,
      completedDistanceM: 0,
    };
  }
  if (points.length === 1 || progress <= 0) {
    const heading = points.length > 1 ? calculateBearing(points[0], points[1]) : 0;
    const total = polylineLengthM(points);
    return {
      position: points[0],
      heading,
      segmentIndex: 0,
      remainingDistanceM: total,
      completedDistanceM: 0,
    };
  }
  if (progress >= 1) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const heading = calculateBearing(prev, last);
    const total = polylineLengthM(points);
    return {
      position: last,
      heading,
      segmentIndex: points.length - 2,
      remainingDistanceM: 0,
      completedDistanceM: total,
    };
  }

  const totalLength = polylineLengthM(points);
  const targetDistance = totalLength * progress;

  let accumulated = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segDist = haversineDistanceM(points[i], points[i + 1]);
    if (accumulated + segDist >= targetDistance) {
      const segmentProgress = segDist > 0 ? (targetDistance - accumulated) / segDist : 0;
      const lat = points[i][0] + (points[i + 1][0] - points[i][0]) * segmentProgress;
      const lon = points[i][1] + (points[i + 1][1] - points[i][1]) * segmentProgress;
      const heading = calculateBearing(points[i], points[i + 1]);
      return {
        position: [lat, lon],
        heading,
        segmentIndex: i,
        remainingDistanceM: totalLength - targetDistance,
        completedDistanceM: targetDistance,
      };
    }
    accumulated += segDist;
  }

  // Fallback to last point
  return {
    position: points[points.length - 1],
    heading: calculateBearing(points[points.length - 2], points[points.length - 1]),
    segmentIndex: points.length - 2,
    remainingDistanceM: 0,
    completedDistanceM: totalLength,
  };
}

/**
 * Generates an organic, road-like multi-segment polyline connecting start and end
 * when no precomputed OSRM route is available.
 */
export function generateCurvedRoute(
  start: Point,
  end: Point,
  waypointsCount = 8
): Point[] {
  const result: Point[] = [start];
  const dLat = end[0] - start[0];
  const dLon = end[1] - start[1];

  // Perpendicular offset vector for natural road deviations
  const perpLat = -dLon * 0.15;
  const perpLon = dLat * 0.15;

  for (let i = 1; i < waypointsCount; i++) {
    const t = i / waypointsCount;
    // Sinusoidal arc + pseudo-deterministic curve
    const arc = Math.sin(t * Math.PI);
    const wobble = Math.sin(t * Math.PI * 3) * 0.3;
    const factor = arc + wobble;

    const lat = start[0] + dLat * t + perpLat * factor;
    const lon = start[1] + dLon * t + perpLon * factor;
    result.push([lat, lon]);
  }

  result.push(end);
  return result;
}
