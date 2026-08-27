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
  isFactor,
  type DispatchOffer,
  type FactorMap,
  type Incident,
  type IncidentDispatch,
  type IncidentEvent,
  type NewIncident,
  type OfferStateName,
  type RankedCandidate,
  type ScoreFactor,
} from "@/hooks/use-acute";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500 bg-red-50 text-red-700",
  high: "border-amber-500 bg-amber-50 text-amber-700",
  standard: "border-slate-400 bg-slate-50 text-slate-700",
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
      {overdue ? `overdue ${mmss(-left)} — sweep pending` : mmss(left)}
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

// The reason a facility placed where it did, with where each number came from.
// A dispatcher overruling the engine deserves to see which factors were real.
//
// `factors` is not uniformly shaped — it also carries `eta_basis` (a string) and
// `sourced_weight_redistributed` (a boolean) — so the non-factor keys are pulled
// out rather than rendered as empty rows.
function Factors({ factors }: { factors: FactorMap }) {
  const rows = Object.entries(factors ?? {}).filter(
    (e): e is [string, ScoreFactor] => isFactor(e[1]),
  );
  if (rows.length === 0) return null;

  const etaBasis =
    typeof factors.eta_basis === "string" ? factors.eta_basis : null;
  const redistributed = factors.sourced_weight_redistributed === true;

  // Included first, then the ones no public source can fill.
  rows.sort(
    (a, b) =>
      Number(b[1].included !== false) - Number(a[1].included !== false) ||
      (b[1].weight ?? 0) - (a[1].weight ?? 0),
  );

  return (
    <div className="mt-2 space-y-1.5">
      <div className="grid gap-1 sm:grid-cols-2">
        {rows.map(([name, f]) => {
          const off = f.included === false;
          const contribution = (f.value ?? 0) * (f.weight ?? 0);
          return (
            <div
              key={name}
              className={`flex items-baseline justify-between gap-2 rounded border px-2 py-1 text-xs ${
                off ? "border-dashed opacity-60" : ""
              }`}
            >
              <span className="font-medium capitalize">
                {name.replace(/_/g, " ")}
              </span>
              <span className="flex items-center gap-1.5">
                {off ? (
                  <span className="text-muted-foreground">
                    off · weight {f.weight} redistributed
                  </span>
                ) : (
                  <span className="font-mono">
                    {(f.value ?? 0).toFixed(2)} × {f.weight} ={" "}
                    {contribution.toFixed(3)}
                  </span>
                )}
                <span
                  className={
                    off
                      ? "rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-800"
                      : "rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground"
                  }
                >
                  {f.source}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[11px]">
        {redistributed
          ? "Unobtainable factors excluded, their weight redistributed across the sourced ones. "
          : ""}
        {etaBasis ? `ETA: ${etaBasis}.` : ""}
      </p>
    </div>
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
          : `Declined — ${String(res.still_pending_in_wave ?? 0)} still pending in this wave`,
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
            #{offer.rank} {offer.facility?.name ?? offer.facility_id}
          </p>
          <p className="text-muted-foreground text-xs">
            wave {offer.wave_index} · {Number(offer.distance_km).toFixed(1)} km ·
            score {Number(offer.score).toFixed(3)}
            {offer.eta_seconds
              ? ` · ETA ~${Math.round(offer.eta_seconds / 60)} min`
              : ""}
            {offer.decline_reason ? ` · "${offer.decline_reason}"` : ""}
            {offer.state === "superseded" && offer.winner
              ? ` · lost to ${offer.winner.name}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={OFFER_STYLE[offer.state]}>
            {offer.state}
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
      {/* Only where the decision is still live, or where it was made. Fifteen
          collapsed factor grids for timed-out offers is noise over an ops board. */}
      {live || offer.state === "accepted" ? <Factors factors={offer.factors} /> : null}
    </div>
  );
}

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
            <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
            {e.from_status || e.to_status ? (
              <span className="text-muted-foreground">
                {" "}
                {e.from_status ?? "—"} → {e.to_status ?? "—"}
              </span>
            ) : null}
            {e.detail?.facility_name ? (
              <span className="text-muted-foreground">
                {" "}
                · {String(e.detail.facility_name)}
              </span>
            ) : null}
            {e.detail?.reason ? (
              <span className="text-muted-foreground"> · {String(e.detail.reason)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Candidates({ ranked }: { ranked: RankedCandidate[] }) {
  if (!ranked || ranked.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No candidate scored above zero within 60 km.
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
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {Number(c.score).toFixed(3)} · {Number(c.distance_km).toFixed(1)} km
          </span>
        </li>
      ))}
    </ol>
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
        <span className="text-muted-foreground">{incident.status}</span>
        {d ? (
          <span className="font-mono">
            {d.state === "offering"
              ? `wave ${d.wave_index + 1}/${d.max_waves} · ${
                  left !== null && left >= 0 ? mmss(left) : "sweep due"
                }`
              : d.state}
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
  const { dispatch, offers, events } = useIncidentDetail(
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
          Wave-based offer and accept. A facility is offered a case and may decline —
          it is never silently assigned.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base tracking-tight">Open an incident</CardTitle>
          <CardDescription>
            Severity is derived by the database from triage colour and vitals, not
            chosen here — so intake cannot downgrade a red case.
          </CardDescription>
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
                      Wave {dispatch.wave_index + 1} of {dispatch.max_waves} ·{" "}
                      {dispatch.state}
                    </CardTitle>
                    <Fuse dispatch={dispatch} now={now} />
                  </div>
                  <CardDescription>
                    {dispatch.parallel_per_wave} offered in parallel ·{" "}
                    {Math.round(dispatch.wave_timeout_ms / 1000)}s fuse ·{" "}
                    {dispatch.ordered_facility_ids.length} candidates ranked
                    {dispatch.last_escalation_reason
                      ? ` · last escalation: ${dispatch.last_escalation_reason}`
                      : ""}
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
                      Every wave exhausted without an acceptance. This needs a human —
                      the incident is still open and was never deleted.
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
                        Earlier waves
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

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tracking-tight">
                    Ranked candidates
                  </CardTitle>
                  <CardDescription>
                    Frozen at dispatch time, so retuning the policy tomorrow cannot
                    rewrite how this case was meant to behave.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Candidates ranked={dispatch?.ranked_candidates ?? []} />
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base tracking-tight">Audit trail</CardTitle>
                  <CardDescription>
                    Append-only. No update or delete policy exists on this table.
                  </CardDescription>
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
