"use client";

// Operations map: patients, facilities and open escalations on one canvas.
//
// CircleMarker throughout, not Marker. Leaflet's default Marker pulls PNG icons by
// relative URL, which breaks under every bundler and needs L.Icon.Default patching;
// circles need no assets, render on canvas, and stay cheap at ~800 points.
//
// This file is imported with ssr:false — Leaflet touches window at module scope.

import { useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  LayersControl,
  LayerGroup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Patient, Facility, Escalation } from "@/hooks/use-supabase";

// Bihar + Assam. Zoom 6 shows both Patna and Guwahati, which is the whole point:
// the acute layer is in Bihar and the flood advisory fires in Assam.
const CENTER: [number, number] = [25.9, 87.5];

const RISK_COLOR: Record<string, string> = {
  High: "#dc2626",
  Moderate: "#f59e0b",
  Low: "#10b981",
};

type Props = {
  patients: Patient[];
  facilities: Facility[];
  escalations: Escalation[];
};

function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="absolute bottom-4 left-4 z-[500] rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 font-semibold">Legend</div>
      {[
        ["#dc2626", `High risk patient (${counts.high})`],
        ["#f59e0b", `Moderate risk (${counts.moderate})`],
        ["#10b981", `Low risk (${counts.low})`],
        ["#2563eb", `Facility, dispatch-eligible (${counts.eligible})`],
        ["#94a3b8", `Facility, not receiving (${counts.ineligible})`],
        ["#7c3aed", `Open escalation (${counts.escalations})`],
      ].map(([color, label]) => (
        <div key={label} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-muted-foreground">{label}</span>
        </div>
      ))}
      {/* The map's own caveat, next to the map rather than in a doc nobody opens. */}
      <div className="mt-2 max-w-[15rem] border-t pt-2 text-[11px] leading-snug text-muted-foreground">
        Patient pins are locality centroids with an offset, not household
        locations. Facility names and coordinates are OpenStreetMap; bed counts
        are simulated.
      </div>
    </div>
  );
}

export default function OperationsMap({ patients, facilities, escalations }: Props) {
  const [showSimulatedCapacity, setShowSimulatedCapacity] = useState(false);

  const plotted = useMemo(
    () => patients.filter((p) => p.lat != null && p.lon != null),
    [patients]
  );

  // An escalation carries no coordinates of its own; it borrows its patient's.
  const escalationPoints = useMemo(() => {
    const byId = new Map(plotted.map((p) => [p.id, p]));
    return escalations
      .filter((e) => e.status !== "resolved")
      .map((e) => ({ escalation: e, patient: byId.get(e.patient_id) }))
      .filter((x): x is { escalation: Escalation; patient: Patient } => !!x.patient);
  }, [escalations, plotted]);

  const counts = useMemo(
    () => ({
      high: plotted.filter((p) => p.risk_level === "High").length,
      moderate: plotted.filter((p) => p.risk_level === "Moderate").length,
      low: plotted.filter((p) => p.risk_level === "Low").length,
      eligible: facilities.filter((f) => f.dispatch_eligible).length,
      ineligible: facilities.filter((f) => !f.dispatch_eligible).length,
      escalations: escalationPoints.length,
    }),
    [plotted, facilities, escalationPoints]
  );

  const unplotted = patients.length - plotted.length;

  // Leaflet paints in insertion order, so ineligible facilities go down first and
  // the receiving hospitals sit on top of them. On a campus this matters: GMCH and
  // "GMCH Postmortem Ward" are 0.0006 degrees apart, and at national zoom the
  // morgue was winning the hover over the 1087-bed hospital behind it.
  const orderedFacilities = useMemo(
    () =>
      [...facilities].sort(
        (a, b) => Number(a.dispatch_eligible) - Number(b.dispatch_eligible)
      ),
    [facilities]
  );

  return (
    <div className="relative h-[70vh] w-full overflow-hidden rounded-xl border">
      <MapContainer
        center={CENTER}
        zoom={6}
        // Off deliberately. The page continues below the map, so a wheel over the
        // canvas would hijack the page scroll and silently fly the view somewhere
        // else — which is exactly what happened the first time this was opened.
        // The +/- control and double-click still zoom.
        scrollWheelZoom={false}
        className="h-full w-full"
        preferCanvas
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={18}
        />

        <LayersControl position="topright">
          <LayersControl.Overlay checked name={`Patients (${plotted.length})`}>
            <LayerGroup>
              {plotted.map((p) => (
                <CircleMarker
                  key={p.id}
                  center={[p.lat as number, p.lon as number]}
                  radius={5}
                  pathOptions={{
                    color: RISK_COLOR[p.risk_level] ?? "#64748b",
                    fillColor: RISK_COLOR[p.risk_level] ?? "#64748b",
                    fillOpacity: 0.7,
                    weight: 1,
                  }}
                >
                  <Tooltip>
                    <div className="text-xs">
                      <div className="font-semibold">{p.name}</div>
                      <div>
                        {p.risk_level} risk &middot; {p.language}
                      </div>
                      <div className="text-muted-foreground">
                        {[p.village, p.district].filter(Boolean).join(", ") || "location unknown"}
                      </div>
                      <div className="mt-1 text-[10px] italic text-muted-foreground">
                        approximate — locality centroid
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay checked name={`Facilities (${facilities.length})`}>
            <LayerGroup>
              {orderedFacilities.map((f) => (
                <CircleMarker
                  key={f.id}
                  center={[f.lat, f.lon]}
                  // Dispatch-eligible facilities are the ones an acute case can
                  // actually go to, so they read as solid; the rest sit back.
                  radius={f.dispatch_eligible ? 6 : 3}
                  pathOptions={{
                    color: f.dispatch_eligible ? "#2563eb" : "#94a3b8",
                    fillColor: f.dispatch_eligible ? "#2563eb" : "#94a3b8",
                    fillOpacity: f.dispatch_eligible ? 0.75 : 0.35,
                    weight: 1,
                  }}
                >
                  <Tooltip>
                    <div className="text-xs">
                      <div className="font-semibold">{f.name}</div>
                      <div className="text-muted-foreground">
                        {f.healthcare ?? f.amenity ?? "health facility"}
                        {f.emergency === true ? " · emergency dept" : ""}
                      </div>
                      {!f.dispatch_eligible ? (
                        <div className="text-amber-600">not an acute receiving facility</div>
                      ) : null}
                      {showSimulatedCapacity && f.beds_total != null ? (
                        <div>
                          {f.beds_available}/{f.beds_total} beds free
                          <span className="ml-1 italic text-muted-foreground">
                            (simulated)
                          </span>
                        </div>
                      ) : null}
                      <div className="mt-1 text-[10px] italic text-muted-foreground">
                        name &amp; location: OpenStreetMap
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay
            checked
            name={`Open escalations (${escalationPoints.length})`}
          >
            <LayerGroup>
              {escalationPoints.map(({ escalation, patient }) => (
                <CircleMarker
                  key={escalation.id}
                  center={[patient.lat as number, patient.lon as number]}
                  radius={11}
                  pathOptions={{
                    color: "#7c3aed",
                    fillColor: "#7c3aed",
                    fillOpacity: 0.15,
                    weight: 2,
                  }}
                >
                  <Tooltip>
                    <div className="text-xs">
                      <div className="font-semibold">{escalation.severity} escalation</div>
                      <div>{patient.name}</div>
                      <div className="text-muted-foreground">{escalation.reason}</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>

      <Legend counts={counts} />

      {/* Beside the zoom buttons, not top-right: LayersControl lives there and the
          label was rendering clipped underneath it. */}
      <div className="absolute left-16 top-4 z-[500] flex flex-col gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
          <input
            type="checkbox"
            checked={showSimulatedCapacity}
            onChange={(e) => setShowSimulatedCapacity(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Simulated bed counts
        </label>
        {unplotted > 0 ? (
          <div className="max-w-[13rem] rounded-lg border bg-background/95 px-3 py-2 text-[11px] leading-snug text-muted-foreground shadow-lg backdrop-blur">
            {unplotted} patient{unplotted === 1 ? "" : "s"} not shown — no district
            recorded at the camp, so there is nothing to place them by.
          </div>
        ) : null}
      </div>
    </div>
  );
}

