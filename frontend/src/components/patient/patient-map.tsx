"use client";

// The ambulance on its way, on a map, for the person waiting for it.
//
// CircleMarker throughout, not Marker: Leaflet's default Marker pulls PNG icons by
// relative URL and breaks under a bundler. Same reason the operations map avoids it.
//
// Three points and a straight line between two of them. NOT a route: we have no road
// geometry on the client, and drawing a curve down streets the vehicle is not following
// would be a more convincing lie than a straight line. The label says "straight line",
// so what is drawn and what is claimed match.

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = { lat: number; lon: number; label: string };

export default function PatientMap({
  scene,
  unit,
  hospital,
  // Where the vehicle is actually heading. Before pickup that is the scene; after it,
  // the hospital -- and a line to the scene while it drives away from you would show
  // the ambulance going the wrong way.
  heading = "scene",
  // Real road geometry as [lat, lon] pairs, when we have it. Null falls back to the
  // dashed straight line, which is what happens with no routing key, no quota, or a
  // scene the router cannot reach. The caption below changes to match, so the map never
  // claims a road route it is not drawing.
  route = null,
}: {
  scene: MapPoint;
  unit?: MapPoint | null;
  hospital?: MapPoint | null;
  heading?: "scene" | "hospital";
  route?: [number, number][] | null;
}) {
  const target = heading === "hospital" && hospital ? hospital : scene;
  const onRoads = Array.isArray(route) && route.length > 1;
  const points = useMemo(
    () => [scene, unit, hospital].filter((p): p is MapPoint => Boolean(p)),
    [scene, unit, hospital],
  );

  // Fit whatever exists rather than a fixed zoom: before a hospital accepts there is one
  // point, and a city-wide view of a single dot tells the person nothing.
  const center: [number, number] = [
    points.reduce((a, p) => a + p.lat, 0) / points.length,
    points.reduce((a, p) => a + p.lon, 0) / points.length,
  ];
  const spread = Math.max(
    ...points.map((p) => Math.abs(p.lat - center[0]) + Math.abs(p.lon - center[1])),
    0.004,
  );
  const zoom = spread > 0.08 ? 11 : spread > 0.03 ? 12 : spread > 0.012 ? 13 : 14;

  return (
    <div className="overflow-hidden rounded-xl border">
      <MapContainer
        center={center}
        zoom={zoom}
        // A person watching for an ambulance should not lose the map to a stray scroll.
        scrollWheelZoom={false}
        style={{ height: "260px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {onRoads ? (
          // Solid, and drawn under the markers: this is the road the vehicle is on, not
          // an estimate. Two strokes so it reads as a route on a busy OSM tile rather
          // than as one more street.
          <>
            <Polyline
              positions={route as [number, number][]}
              pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9 }}
            />
            <Polyline
              positions={route as [number, number][]}
              pathOptions={{ color: "#0891b2", weight: 4, opacity: 1 }}
            />
          </>
        ) : unit ? (
          <Polyline
            positions={[
              [unit.lat, unit.lon],
              [target.lat, target.lon],
            ]}
            pathOptions={{ color: "#0891b2", weight: 3, dashArray: "6 6" }}
          />
        ) : null}

        {/* Drawn after the line so it sits on top: Leaflet paints in insertion order. */}
        <CircleMarker
          center={[scene.lat, scene.lon]}
          radius={9}
          pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9, weight: 2 }}
        >
          <Tooltip permanent direction="top">
            {scene.label}
          </Tooltip>
        </CircleMarker>

        {unit ? (
          <CircleMarker
            center={[unit.lat, unit.lon]}
            radius={8}
            pathOptions={{ color: "#0891b2", fillColor: "#0891b2", fillOpacity: 0.95, weight: 2 }}
          >
            <Tooltip permanent direction="bottom">
              {unit.label}
            </Tooltip>
          </CircleMarker>
        ) : null}

        {hospital ? (
          <CircleMarker
            center={[hospital.lat, hospital.lon]}
            radius={7}
            pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.8, weight: 2 }}
          >
            <Tooltip direction="top">{hospital.label}</Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>
    </div>
  );
}
