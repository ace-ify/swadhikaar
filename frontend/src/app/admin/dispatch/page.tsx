"use client";

// The dispatch console. Until this page existed the engine was unreachable from a
// browser: offers landed in the database and nothing rendered them, which is the
// same unreachable-surface defect this project has now hit three times.
//
// Everything on screen is live. The fuse countdown reads `wave_timeout_at`, an
// absolute timestamp, so it agrees with the cron sweep that will actually fire —
// EOS recomputes theirs from now() - notifiedAt and their own docs measure the
// resulting 45-105s spread on a 45s fuse.

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  useAcutePulse,
  useIncidents,
  useIncidentDetail,
  boardDispatch,
  createIncident,
  acceptOffer,
  declineOffer,
  acceptFleetOffer,
  rejectFleetOffer,
  isFactor,
  type DispatchOffer,
  type FactorMap,
  type FleetAssignment,
  type Incident,
  type IncidentDispatch,
  type IncidentEvent,
  type NewIncident,
  type OfferStateName,
  type OutboxRow,
  type RankedCandidate,
  type ScoreFactor,
} from "@/hooks/use-acute";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500 bg-red-50 text-red-700",
  high: "border-amber-500 bg-amber-50 text-amber-700",
  standard: "border-slate-400 bg-slate-50 text-slate-700",
};

// Enum names are for the database. These are for the person reading the screen.
const OFFER_WORDS: Record<OfferStateName, string> = {
  pending: "waiting",
  accepted: "accepted",
  declined: "said no",
  superseded: "went elsewhere",
  timed_out: "no answer",
};

const STATUS_WORDS: Record<string, string> = {
  pending: "waiting for a hospital",
  dispatched: "hospital accepted",
  en_route: "ambulance on the way",
  arrived: "at hospital",
  resolved: "closed",
  expired: "timed out",
  cancelled: "cancelled",
};

const DISPATCH_WORDS: Record<string, string> = {
  offering: "asking hospitals",
  accepted: "hospital accepted",
  exhausted: "nobody accepted",
  no_candidates: "no hospital in range",
  stood_down: "stood down",
};

const OFFER_STYLE: Record<OfferStateName, string> = {
  pending: "border-blue-500 text-blue-700",
  accepted: "border-emerald-600 bg-emerald-50 text-emerald-700",
  declined: "border-orange-500 text-orange-700",
  superseded: "border-slate-300 text-slate-500",
  timed_out: "border-red-400 text-red-600",
};

// Three presets rather than a form. The point of the demo is that severity is
// derived — the same page cannot be used to hand-set it, because
// classify_incident_severity() is the only thing that decides and an intake clerk
// must not be able to downgrade a red-triage case.
const PRESETS: { label: string; expect: string; incident: NewIncident }[] = [
  {
    label: "Road accident, Dispur",
    expect: "critical → 3 facilities, 45s fuse",
    incident: {
      victim_name: "Unknown male",
      victim_age: 34,
      lat: 26.1445,
      lon: 91.7362,
      address: "GS Road, Dispur",
      district: "Kamrup Metropolitan",
      incident_type: "Road traffic accident",
      description: "Head injury, bleeding, unresponsive",
      triage_colour: "red",
      required_services: ["trauma", "neurosurgery"],
      vitals: { spo2: 88, sbp: 85, hr: 138, gcs: 7 },
    },
  },
  {
    label: "Cardiac arrest, Bharalumukh",
    expect: "critical → speciality routing to a heart hospital",
    incident: {
      victim_name: "Unknown female",
      victim_age: 61,
      lat: 26.1758,
      lon: 91.7386,
      address: "Bharalumukh, Guwahati",
      district: "Kamrup Metropolitan",
      incident_type: "Cardiac arrest",
      description: "Chest pain then collapse, no pulse felt by bystander",
      triage_colour: "red",
      required_services: ["cardiology"],
      vitals: { spo2: 91, sbp: 90, hr: 42 },
    },
  },
  {
    label: "Fall at home, Patna",
    // Labelled from what the classifier actually returns, not from what the tier
    // table looked like it should be: "fall" is a high-severity keyword, so a
    // yellow triage colour does not make this standard. Keywords and physiology
    // only ever escalate.
    expect: "high → 2 facilities, 75s fuse",
    incident: {
      victim_name: "Ramdev Prasad",
      victim_age: 72,
      lat: 25.5941,
      lon: 85.1376,
      address: "Kankarbagh, Patna",
      district: "Patna",
      incident_type: "Fall",
      description: "Slipped in bathroom, wrist pain, fully alert",
      triage_colour: "yellow",
      required_services: ["orthopaedics"],
      vitals: { spo2: 98, sbp: 128, hr: 84, gcs: 15 },
    },
  },
];

// One shared clock. Every countdown on the page reads the same `now`, so two fuses
// can never be shown a second apart — and reading Date.now() during render instead
// would make the numbers depend on whatever else triggered a re-render.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function secondsUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - now) / 1000);
}

function mmss(total: number) {
  const s = Math.max(0, total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Fuse({ dispatch, now }: { dispatch: IncidentDispatch; now: number }) {
  if (dispatch.state !== "offering") return null;
  const left = secondsUntil(dispatch.wave_timeout_at, now);
  if (left === null) return null;

  // Past zero the sweep has not run yet — it fires 4x/minute, so up to 15s of
  // "overdue" is expected and saying so is more honest than freezing at 0:00.
  const overdue = left < 0;
  return (
    <span
      className={
        overdue
          ? "font-mono text-sm font-semibold text-amber-600"
          : "font-mono text-sm font-semibold text-red-600"
      }
    >
      {overdue ? `${mmss(-left)} over — moving on` : mmss(left)}
    </span>
  );
}

function GoldenHour({ start, now }: { start: string; now: number }) {
  const elapsed = Math.max(0, Math.round((now - new Date(start).getTime()) / 1000));
  const past = elapsed > 3600;
  return (
    <span className={past ? "text-red-600" : "text-muted-foreground"}>
      {mmss(elapsed)} {past ? "past golden hour" : "into golden hour"}
    </span>
  );
}

// Why this hospital, in words a dispatcher can act on. The arithmetic is still
// available one tap down, because someone will eventually want to check it — but it
// is not what you read while a timer is running.
const SOURCE_WORDS: Record<string, string> = {
  OSM_COORDINATES: "map data",
  OSM_TAGS: "map data",
  NAME_DERIVED: "from its name",
  OUR_DISPATCH_TABLE: "our records",
  OUR_FACILITIES_TABLE: "our records",
  OUR_OFFER_HISTORY: "past answers",
  SIMULATED: "made up for the demo",
  NOT_AVAILABLE: "nobody publishes this",
};

const FACTOR_WORDS: Record<string, string> = {
  proximity: "Distance",
  specialty: "Right speciality",
  load: "How busy",
  emergency: "Emergency unit",
  freshness: "Record freshness",
  reliability: "Usually accepts",
  capacity: "Free beds",
  staffing: "Doctors on duty",
  blood: "Blood stock",
};

// The database emits sourced factors lower-case and unobtainable ones upper-case,
// so matching on the literal string silently missed six of the nine.
function sourceWords(source: string | undefined): string {
  return SOURCE_WORDS[(source ?? "").toUpperCase()] ?? source ?? "unknown";
}

function factorOf(factors: FactorMap, key: string): ScoreFactor | null {
  const v = factors?.[key];
  return isFactor(v) ? v : null;
}

function reasonWords(factors: FactorMap): string[] {
  const out: string[] = [];
  const prox = factorOf(factors, "proximity");
  if (prox && (prox.value ?? 0) >= 0.85) out.push("very close");

  const spec = factorOf(factors, "specialty");
  if (spec?.matched) {
    const needed = (spec.needed ?? []).join(" and ");
    out.push(needed ? `handles ${needed}` : "right speciality");
  }

  const load = factorOf(factors, "load");
  if (load && (load.value ?? 0) >= 0.9) out.push("not busy");

  const em = factorOf(factors, "emergency");
  if (em && (em.value ?? 0) >= 0.9) out.push("has an emergency unit");

  const rel = factorOf(factors, "reliability");
  if (rel && (rel.value ?? 0) >= 0.8) out.push("usually accepts");

  return out.slice(0, 3);
}

// Kept behind a <details>: native, no state to get wrong, closed by default.
function Factors({ factors }: { factors: FactorMap }) {
  const rows = Object.entries(factors ?? {}).filter(
    (e): e is [string, ScoreFactor] => isFactor(e[1]),
  );
  if (rows.length === 0) return null;

  rows.sort(
    (a, b) =>
      Number(b[1].included !== false) - Number(a[1].included !== false) ||
      (b[1].weight ?? 0) - (a[1].weight ?? 0),
  );

  return (
    <details className="mt-2">
      <summary className="text-muted-foreground cursor-pointer text-xs">
        How this was worked out
      </summary>
      <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
        {rows.map(([name, f]) => {
          const off = f.included === false;
          return (
            <div
              key={name}
              className={`flex items-baseline justify-between gap-2 rounded border px-2 py-1 text-xs ${
                off ? "border-dashed opacity-60" : ""
              }`}
            >
              <span className="font-medium">
                {FACTOR_WORDS[name] ?? name.replace(/_/g, " ")}
              </span>
              <span className="text-muted-foreground">
                {off
                  ? sourceWords(f.source)
                  : `${Math.round((f.value ?? 0) * 100)}% · ${sourceWords(f.source)}`}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function OfferCard({
  offer,
  dispatch,
  incidentId,
  onDone,
}: {
  offer: DispatchOffer;
  dispatch: IncidentDispatch;
  incidentId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const live =
    dispatch.state === "offering" &&
    offer.wave_index === dispatch.wave_index &&
    offer.state === "pending";

  async function act(kind: "accept" | "decline") {
    setBusy(true);
    const res =
      kind === "accept"
        ? await acceptOffer(incidentId, offer.facility_id, offer.eta_seconds)
        : await declineOffer(incidentId, offer.facility_id, "no bed in critical care");
    setBusy(false);

    if (res.ok) {
      toast.success(
        kind === "accept"
          ? `Accepted by ${String(res.facility_name ?? offer.facility?.name)}`
          : `Said no — ${String(res.still_pending_in_wave ?? 0)} still to answer`,
      );
    } else if (res.error === "already_accepted") {
      // Not a failure to hide: this is the race the engine exists to resolve, and
      // the losing console should say who won rather than sit on "pending".
      toast.error(`Already accepted by ${String(res.accepted_facility_name)}`);
    } else {
      toast.error(String(res.error ?? "rpc failed"));
    }
    onDone();
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {offer.facility?.name ?? offer.facility_id}
          </p>
          <p className="text-muted-foreground text-xs">
            {Number(offer.distance_km).toFixed(1)} km
            {offer.eta_seconds
              ? ` · about ${Math.round(offer.eta_seconds / 60)} min away`
              : ""}
            {offer.decline_reason ? ` · said no: ${offer.decline_reason}` : ""}
            {offer.state === "superseded" && offer.winner
              ? ` · lost to ${offer.winner.name}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={OFFER_STYLE[offer.state]}>
            {OFFER_WORDS[offer.state]}
          </Badge>
          {live ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => act("accept")}>
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("decline")}
              >
                Decline
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {live || offer.state === "accepted" ? (
        <>
          {reasonWords(offer.factors).length > 0 ? (
            <p className="mt-1 text-sm">
              {reasonWords(offer.factors).join(" · ")}
            </p>
          ) : null}
          <Factors factors={offer.factors} />
        </>
      ) : null}
    </div>
  );
}

const ACTION_WORDS: Record<string, string> = {
  incident_created: "case opened",
  dispatch_opened: "hospitals contacted",
  wave_offered: "next hospitals asked",
  offer_declined: "hospital said no",
  offer_accepted: "hospital accepted",
  status_changed: "status changed",
  dispatch_exhausted: "no hospital accepted",
  dispatch_no_candidates: "no hospital in range",
  ambulance_offered: "ambulances asked",
  ambulance_accepted: "ambulance accepted",
  ambulance_rejected: "crew said no",
  ambulance_exhausted: "no ambulance available",
  ambulance_no_units: "no ambulance nearby",
};

// Append-only. Status transitions are written by trigger, so an actor cannot omit
// one — which is the difference between an audit trail and a log.
function Trail({ events }: { events: IncidentEvent[] }) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">No events yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
            {new Date(e.at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className="min-w-0">
            <span className="font-medium">
              {ACTION_WORDS[e.action] ?? e.action.replace(/_/g, " ")}
            </span>
            {e.to_status ? (
              <span className="text-muted-foreground">
                {" "}
                → {STATUS_WORDS[e.to_status] ?? e.to_status}
              </span>
            ) : null}
            {e.detail?.facility_name ? (
              <span className="text-muted-foreground">
                {" "}
                · {String(e.detail.facility_name)}
              </span>
            ) : null}
            {e.detail?.reason ? (
              <span className="text-muted-foreground">
                {" "}
                · {String(e.detail.reason).replace(/_/g, " ")}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Candidates({ ranked }: { ranked: RankedCandidate[] }) {  if (!ranked || ranked.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hospital within 60 km could take this.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {ranked.map((c) => (
        <li
          key={c.facility_id}
          className="flex items-baseline justify-between gap-2 text-sm"
        >
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground font-mono text-xs">
              {String(c.rank).padStart(2, "0")}
            </span>{" "}
            {c.name}
            {c.tier ? (
              <span className="text-muted-foreground text-xs"> · {c.tier}</span>
            ) : null}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {Number(c.distance_km).toFixed(1)} km
          </span>
        </li>
      ))}
    </ol>
  );
}

const AMBULANCE_LABEL: Record<string, string> = {
  pending_operator: "waiting for a crew to answer",
  en_route: "on the way to the scene",
  on_scene: "at the scene",
  transporting: "carrying the patient",
  no_operator: "no vehicle available",
};

// The vehicle leg. Opens by itself the moment a hospital accepts — 8 crews offered
// at once on a 3-minute deadline, then 4 at a time, 4 attempts. EOS's numbers.
function Ambulance({
  dispatch,
  fleet,
  now,
  onDone,
}: {
  dispatch: IncidentDispatch;
  fleet: FleetAssignment[];
  now: number;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!dispatch.ambulance_state) return null;

  const open = fleet.filter((f) => f.state === "awaiting_response");
  const answered = fleet.filter((f) => f.state !== "awaiting_response");
  const accepted = fleet.find((f) => f.state === "accepted");

  async function act(id: string, kind: "accept" | "reject") {
    setBusy(id);
    const res =
      kind === "accept"
        ? await acceptFleetOffer(id)
        : await rejectFleetOffer(id, "crew on another call");
    setBusy(null);
    if (res.ok) {
      toast.success(
        kind === "accept"
          ? `${String(res.call_sign)} is on the way`
          : `Declined — ${String(res.still_open ?? 0)} crews still to answer`,
      );
    } else {
      toast.error(String(res.error ?? "Could not send that"));
    }
    onDone();
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base tracking-tight">
            Ambulance · {AMBULANCE_LABEL[dispatch.ambulance_state] ?? dispatch.ambulance_state}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              simulated vehicles
            </Badge>
            {dispatch.ambulance_state === "pending_operator" && open.length > 0 ? (
              <span className="font-mono text-sm font-semibold text-red-600">
                {mmss(secondsUntil(open[0].response_deadline_at, now) ?? 0)}
              </span>
            ) : null}
          </div>
        </div>
        <CardDescription>
          Try {dispatch.ambulance_attempts + 1} of 4
          {dispatch.ambulance_relay_facility_id
            ? " · borrowed from another hospital, the receiving one had none free"
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {accepted ? (
          <p className="rounded-lg border border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">
            {accepted.unit?.call_sign} responding
            {accepted.unit?.driver_name ? ` · ${accepted.unit.driver_name}` : ""}
            {dispatch.ambulance_eta_seconds
              ? ` · about ${Math.round(dispatch.ambulance_eta_seconds / 60)} min to the scene`
              : ""}
          </p>
        ) : null}

        {dispatch.ambulance_state === "no_operator" ? (
          <p className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-800">
            No ambulance free. Needs a phone call — the case stays open.
          </p>
        ) : null}

        {[...open, ...answered].map((f) => (
          <div
            key={f.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm ${
              f.state === "awaiting_response" ? "" : "opacity-70"
            }`}
          >
            <span className="min-w-0">
              <span className="font-semibold">{f.unit?.call_sign ?? "unit"}</span>
              <span className="text-muted-foreground">
                {" "}
                · {f.distance_km ? `${Number(f.distance_km).toFixed(1)} km` : "distance unknown"}
                {f.unit?.driver_name ? ` · ${f.unit.driver_name}` : ""}
                {f.station?.name ? ` · from ${f.station.name}` : ""}
                {f.reason ? ` · ${f.reason.replace(/_/g, " ")}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline">
                {({
                  awaiting_response: "waiting",
                  accepted: "accepted",
                  rejected: "said no",
                  no_response: "no answer",
                } as Record<string, string>)[f.state] ?? f.state}
              </Badge>
              {f.state === "awaiting_response" ? (
                <>
                  <Button size="sm" disabled={busy === f.id} onClick={() => void act(f.id, "accept")}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === f.id}
                    onClick={() => void act(f.id, "reject")}
                  >
                    Decline
                  </Button>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const OUTBOX_WORDS: Record<string, string> = {
  sent: "sent",
  queued: "waiting to send",
  sending: "sending",
  failed: "failed",
  abandoned: "gave up",
  skipped_unconfigured: "not sent",
};

const OUTBOX_STYLE: Record<string, string> = {
  sent: "border-emerald-600 text-emerald-700",
  queued: "border-blue-500 text-blue-700",
  sending: "border-blue-500 text-blue-700",
  failed: "border-red-500 text-red-600",
  abandoned: "border-red-500 text-red-600",
  skipped_unconfigured: "border-amber-500 text-amber-700",
};

// Grouped by channel and outcome rather than listed row by row: fifteen recipients
// across five waves is a wall, and what a dispatcher needs is "did the message get
// out, and if not why not".
function Outbox({ rows }: { rows: OutboxRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing queued yet.</p>;
  }

  const grouped = new Map<string, { n: number; why: string | null }>();
  for (const r of rows) {
    const key = `${r.channel}|${r.status}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      n: (prev?.n ?? 0) + 1,
      why: prev?.why ?? r.last_error,
    });
  }

  return (
    <div className="space-y-1.5">
      {[...grouped.entries()].map(([key, v]) => {
        const [channel, status] = key.split("|");
        return (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {channel === "in_app" ? "In the app" : channel.toUpperCase()} · {v.n}
              </span>
              <Badge variant="outline" className={OUTBOX_STYLE[status] ?? ""}>
                {OUTBOX_WORDS[status] ?? status.replace(/_/g, " ")}
              </Badge>
            </div>
            {v.why ? (
              <p className="text-muted-foreground text-xs">
                {status === "skipped_unconfigured"
                  ? "not set up on this system yet"
                  : v.why}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// The end of the thread. A case that reached hospital could be seen, and could not be
// CLOSED — the continuity layer invented its own incident id, so closing a real case
// meant retyping the patient into a second form and the two halves of the system could
// never refer to the same episode. This closes it under the incident's own reference.
function CloseCase({
  incident,
  dispatch,
  offers,
  onDone,
}: {
  incident: Incident;
  dispatch: IncidentDispatch | null;
  offers: DispatchOffer[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ calls: number; patient: string } | null>(null);

  // Only once a hospital has the patient. Closing a case nobody accepted would create
  // a discharge record for a hospital visit that never happened.
  const reached = incident.status === "arrived" || incident.status === "en_route";
  const hospital =
    offers.find((o) => o.state === "accepted")?.facility?.name ?? null;
  if (!reached || !dispatch || dispatch.state !== "accepted") return null;

  async function close() {
    setBusy(true);
    try {
      const res = await fetch("/api/seam-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_ref: incident.ref,
          name: incident.victim_name ?? `Unidentified (${incident.ref})`,
          phone: incident.reporter_phone ?? undefined,
          // No phone and no ABHA means the seam cannot resolve a person. Rather than
          // fail, fall back to an unroutable number in the project's own convention.
          abha_id: incident.reporter_phone ? undefined : `INC-${incident.ref}`,
          incident_type: incident.incident_type,
          severity: incident.severity.toUpperCase(),
          hospital_name: hospital ?? undefined,
          outcome_summary: `Treated after ${incident.incident_type.toLowerCase()}; discharged to home follow-up.`,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        patient?: { name: string };
        scheduled_calls?: unknown[];
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? `Could not close the case (${res.status})`);
      } else {
        setDone({
          calls: data.scheduled_calls?.length ?? 0,
          patient: data.patient?.name ?? "patient",
        });
        toast.success(
          `Closed — ${data.patient?.name ?? "patient"} enrolled, ${
            data.scheduled_calls?.length ?? 0
          } follow-up calls scheduled`,
        );
        onDone();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close the case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base tracking-tight">Close the case</CardTitle>
        <CardDescription>
          Creates the patient record, the standards-format documents, and the Day 1, 3,
          7, 14 and 30 follow-up calls — under this incident&apos;s own reference.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <p className="rounded-lg border border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">
            {done.patient} is enrolled with {done.calls} follow-up calls scheduled.
            Their record carries {incident.ref}.
          </p>
        ) : (
          <Button
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void close()}
          >
            {busy ? "Closing…" : "Care complete — enrol for follow-up"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function BoardRow({
  incident,
  selected,
  now,
  onSelect,
}: {
  incident: Incident;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const d = boardDispatch(incident);
  const left = d ? secondsUntil(d.wave_timeout_at, now) : null;

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-primary bg-accent/40" : "hover:bg-accent/20"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{incident.ref}</span>
        <Badge variant="outline" className={SEVERITY_STYLE[incident.severity] ?? ""}>
          {incident.severity}
        </Badge>
      </div>
      <p className="mt-1 truncate text-sm font-medium">{incident.incident_type}</p>
      <p className="text-muted-foreground truncate text-xs">
        {incident.address ?? incident.district ?? "—"}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {STATUS_WORDS[incident.status] ?? incident.status}
        </span>
        {d ? (
          <span className="font-mono">
            {d.state === "offering"
              ? `round ${d.wave_index + 1}/${d.max_waves} · ${
                  left !== null && left >= 0 ? mmss(left) : "checking"
                }`
              : (DISPATCH_WORDS[d.state] ?? d.state)}
          </span>
        ) : (
          <span className="text-amber-600">not dispatched</span>
        )}
      </div>
    </button>
  );
}

export default function DispatchPage() {
  const now = useNow();
  const pulse = useAcutePulse();
  // Realtime is the primary signal; this counter is the fallback for the moment
  // right after a mutation, so the screen never depends on a socket to be correct.
  const [nudge, setNudge] = useState(0);
  const refresh = () => setNudge((n) => n + 1);

  const { data: incidents, loading, error } = useIncidents(pulse + nudge);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    incidents.find((i) => i.id === selectedId) ?? incidents[0] ?? null;
  const { dispatch, offers, events, fleet, outbox } = useIncidentDetail(
    selected?.id ?? null,
    pulse + nudge,
  );
  const [busyPreset, setBusyPreset] = useState<string | null>(null);

  async function spawn(preset: (typeof PRESETS)[number]) {
    setBusyPreset(preset.label);
    const { incident, dispatch: d, error: err } = await createIncident(preset.incident);
    setBusyPreset(null);

    if (err || !incident) {
      toast.error(err ?? "could not create incident");
      return;
    }
    setSelectedId(incident.id);
    refresh();
    toast.success(
      `${incident.ref} — ${incident.severity}, offered to ${String(
        d?.offered_to ?? 0,
      )} of ${String(d?.candidates ?? 0)} candidates`,
    );
  }

  const currentWaveOffers = dispatch
    ? offers.filter((o) => o.wave_index === dispatch.wave_index)
    : [];
  const earlierOffers = dispatch
    ? offers.filter((o) => o.wave_index !== dispatch.wave_index)
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      <div className="space-y-1.5 px-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Dispatch Console
        </h1>
        <p className="text-muted-foreground text-sm font-medium">
          Hospitals are asked a few at a time. The first to accept gets the patient.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base tracking-tight">Start a test case</CardTitle>
          <CardDescription>How urgent it is gets worked out automatically.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              disabled={busyPreset !== null}
              onClick={() => void spawn(p)}
              className="h-auto flex-col items-start gap-0.5 py-2 text-left"
            >
              <span className="text-sm font-semibold">
                {busyPreset === p.label ? "Dispatching…" : p.label}
              </span>
              <span className="text-muted-foreground text-xs font-normal">
                {p.expect}
              </span>
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base tracking-tight">Incidents</CardTitle>
            <CardDescription>
              {loading ? "Loading…" : `${incidents.length} most recent`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            {!loading && incidents.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None open. Use a preset above.
              </p>
            ) : null}
            {incidents.map((i) => (
              <BoardRow
                key={i.id}
                incident={i}
                selected={selected?.id === i.id}
                now={now}
                onSelect={() => setSelectedId(i.id)}
              />
            ))}
          </CardContent>
        </Card>

        {selected ? (
          <div className="space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base tracking-tight">
                    {selected.ref} · {selected.incident_type}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {selected.triage_colour ? (
                      <Badge variant="outline">triage {selected.triage_colour}</Badge>
                    ) : null}
                    <Badge
                      variant="outline"
                      className={SEVERITY_STYLE[selected.severity] ?? ""}
                    >
                      {selected.severity}
                    </Badge>
                    {selected.is_simulated ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500 text-amber-700"
                      >
                        simulated
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <CardDescription>
                  {selected.victim_name ?? "Unidentified"}
                  {selected.victim_age ? `, ${selected.victim_age}` : ""} ·{" "}
                  {selected.address ?? selected.district} ·{" "}
                  <GoldenHour start={selected.golden_hour_start} now={now} />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {selected.description ? <p>{selected.description}</p> : null}
                {Object.keys(selected.vitals ?? {}).length > 0 ? (
                  <p className="font-mono text-xs">
                    {Object.entries(selected.vitals)
                      .map(([k, v]) => `${k} ${String(v)}`)
                      .join("  ·  ")}
                  </p>
                ) : null}
                {selected.required_services.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    required: {selected.required_services.join(", ")}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {dispatch ? (
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base tracking-tight">
                      Round {dispatch.wave_index + 1} of {dispatch.max_waves} ·{" "}
                      {DISPATCH_WORDS[dispatch.state] ?? dispatch.state}
                    </CardTitle>
                    <Fuse dispatch={dispatch} now={now} />
                  </div>
                  <CardDescription>
                    Asking {dispatch.parallel_per_wave} at a time ·{" "}
                    {Math.round(dispatch.wave_timeout_ms / 1000)}s to answer ·{" "}
                    {dispatch.ordered_facility_ids.length} hospitals in range
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dispatch.state === "accepted" ? (
                    <p className="rounded-lg border border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Accepted by{" "}
                      {offers.find((o) => o.state === "accepted")?.facility?.name ??
                        dispatch.accepted_facility_id}
                      {dispatch.eta_seconds
                        ? ` · ETA ~${Math.round(dispatch.eta_seconds / 60)} min`
                        : ""}
                    </p>
                  ) : null}

                  {dispatch.state === "exhausted" ? (
                    <p className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-800">
                      No hospital accepted. Someone needs to phone around — the case is
                      still open.
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    {currentWaveOffers.map((o) => (
                      <OfferCard
                        key={o.id}
                        offer={o}
                        dispatch={dispatch}
                        incidentId={selected.id}
                        onDone={refresh}
                      />
                    ))}
                  </div>

                  {earlierOffers.length > 0 ? (
                    <>
                      <Separator />
                      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                        Earlier rounds
                      </p>
                      <div className="space-y-2 opacity-70">
                        {earlierOffers.map((o) => (
                          <OfferCard
                            key={o.id}
                            offer={o}
                            dispatch={dispatch}
                            incidentId={selected.id}
                            onDone={refresh}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm">
                <CardContent className="py-6 text-sm">
                  No dispatch row for this incident.
                </CardContent>
              </Card>
            )}

            {dispatch ? (
              <Ambulance
                dispatch={dispatch}
                fleet={fleet}
                now={now}
                onDone={refresh}
              />
            ) : null}

            <CloseCase
              incident={selected}
              dispatch={dispatch}
              offers={offers}
              onDone={refresh}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tracking-tight">
                    Hospitals in order
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Candidates ranked={dispatch?.ranked_candidates ?? []} />
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tracking-tight">
                    Notifications sent
                  </CardTitle>
                  <CardDescription>Who was told, and how.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Outbox rows={outbox} />
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tracking-tight">Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <Trail events={events} />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Select an incident.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
