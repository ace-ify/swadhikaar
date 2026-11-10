/**
 * Real road routing for the hospital map via the public OSRM demo server (no API key).
 * Returns the route as [lat, lon][] for Leaflet, or null on any failure — the map then
 * falls back to a straight dashed line, and the per-hospital "Directions" button still
 * hands off to the device's Maps app for precise turn-by-turn. The public OSRM server
 * is best-effort / demo-grade; a keyed OSRM or OpenRouteService can drop in later.
 */
export async function fetchRoadRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords)) return null;
    // OSRM returns [lon, lat]; Leaflet wants [lat, lon].
    return coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
  } catch {
    return null;
  }
}
