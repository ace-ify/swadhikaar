"use client";

// Embedded map for the PM-JAY finder. CircleMarker (not Marker) — Leaflet's default
// Marker pulls PNG icons by relative URL and breaks under the bundler, same reason the
// other maps avoid it. Shows empanelled-hospital pins (approximate ones drawn dashed,
// since many are geocoded only to the district), the patient's own location, and — once
// a hospital is picked and OSRM returns geometry — the real road route to it.

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapHospital {
  id: string;
  name: string;
  lat: number;
  lon: number;
  geo_source: string | null;
  hospital_type: string | null;
}

export default function HospitalMap({
  hospitals,
  patient = null,
  selectedId = null,
  route = null,
  onSelect,
}: {
  hospitals: MapHospital[];
  patient?: { lat: number; lon: number } | null;
  selectedId?: string | null;
  route?: [number, number][] | null;
  onSelect?: (id: string) => void;
}) {
  const pts = useMemo(() => {
    const p = hospitals.map((h) => ({ lat: h.lat, lon: h.lon }));
    if (patient) p.push(patient);
    return p;
  }, [hospitals, patient]);

  const center: [number, number] = pts.length
    ? [pts.reduce((a, p) => a + p.lat, 0) / pts.length, pts.reduce((a, p) => a + p.lon, 0) / pts.length]
    : [29.0, 76.3]; // Haryana fallback
  const spread = pts.length
    ? Math.max(...pts.map((p) => Math.abs(p.lat - center[0]) + Math.abs(p.lon - center[1])), 0.01)
    : 1;
  const zoom = spread > 0.4 ? 9 : spread > 0.15 ? 10 : spread > 0.06 ? 11 : spread > 0.02 ? 12 : 13;

  const selected = hospitals.find((h) => h.id === selectedId) || null;
  const onRoads = Array.isArray(route) && route.length > 1;

  return (
    <div className="overflow-hidden rounded-xl border">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} style={{ height: "320px", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {onRoads ? (
          <>
            <Polyline positions={route as [number, number][]} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9 }} />
            <Polyline positions={route as [number, number][]} pathOptions={{ color: "#059669", weight: 4, opacity: 1 }} />
          </>
        ) : patient && selected ? (
          <Polyline
            positions={[[patient.lat, patient.lon], [selected.lat, selected.lon]]}
            pathOptions={{ color: "#059669", weight: 3, dashArray: "6 6" }}
          />
        ) : null}

        {patient ? (
          <CircleMarker center={[patient.lat, patient.lon]} radius={8} pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.9, weight: 2 }}>
            <Tooltip direction="top">You are here</Tooltip>
          </CircleMarker>
        ) : null}

        {hospitals.map((h) => {
          const isSel = h.id === selectedId;
          const approx = h.geo_source === "district";
          return (
            <CircleMarker
              key={h.id}
              center={[h.lat, h.lon]}
              radius={isSel ? 10 : 6}
              eventHandlers={{ click: () => onSelect?.(h.id) }}
              pathOptions={{
                color: isSel ? "#047857" : "#10b981",
                fillColor: isSel ? "#047857" : "#10b981",
                fillOpacity: approx ? 0.35 : 0.85,
                weight: approx ? 1 : 2,
                dashArray: approx ? "3 3" : undefined,
              }}
            >
              <Tooltip direction="top">{h.name}{approx ? " (approx. location)" : ""}</Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
