"use client";

// The receiving facility's screen. One question, asked as directly as possible:
// can you take this patient, yes or no, before the timer runs out.
//
// RLS decides what appears here — a facility sees only offers made to it. The
// query carries no facility filter at all, so it cannot be widened from the client.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useAcutePulse,
  useFacilityOffers,
  useMyFacilities,
  acceptOffer,
  declineOffer,
  type FacilityOffer,
} from "@/hooks/use-acute";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500 bg-red-50 text-red-700",
  high: "border-amber-500 bg-amber-50 text-amber-700",
  standard: "border-slate-400 bg-slate-50 text-slate-700",
};

const DECLINE_REASONS = [
  "No bed available",
  "No specialist on duty",
  "Diverting — at capacity",
] as const;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Countdown({ expiresAt, now }: { expiresAt: string; now: number }) {
  const left = Math.round((new Date(expiresAt).getTime() - now) / 1000);
  if (left < 0) {
    return <span className="text-sm font-semibold text-amber-600">time up</span>;
  }
  return (
    <span
      className={`font-mono text-2xl font-bold tabular-nums ${
        left <= 15 ? "text-red-600" : "text-foreground"
      }`}
    >
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

function OfferCard({
  offer,
  now,
  canAccept,
  onDone,
}: {
  offer: FacilityOffer;
  now: number;
  canAccept: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const inc = offer.incident;
  const live = offer.state === "pending";

  async function respond(kind: "accept" | "decline", reason?: string) {
    setBusy(true);
    const res =
      kind === "accept"
        ? await acceptOffer(offer.incident_id, offer.facility_id, offer.eta_seconds)
        : await declineOffer(offer.incident_id, offer.facility_id, reason ?? "declined");
    setBusy(false);
    setShowReasons(false);

    if (res.ok) {
      toast.success(kind === "accept" ? "Accepted — patient is coming to you" : "Declined");
    } else if (res.error === "already_accepted") {
      toast.error(`Another hospital took this case: ${String(res.accepted_facility_name)}`);
    } else if (res.error === "not_in_current_wave") {
      toast.error("This case has moved on to other hospitals");
    } else if (res.error === "not_authorised_for_facility") {
      toast.error("Your account cannot answer for this facility");
    } else {
      toast.error(String(res.error ?? "Could not send your answer"));
    }
    onDone();
  }

  const vitals = Object.entries(inc?.vitals ?? {});

  return (
    <Card className={live ? "border-primary shadow-md" : "opacity-70 shadow-sm"}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg tracking-tight">
              {inc?.incident_type ?? "Incident"}
            </CardTitle>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {inc?.victim_name ?? "Unidentified"}
              {inc?.victim_age ? `, ${inc.victim_age}` : ""} ·{" "}
              {Number(offer.distance_km).toFixed(1)} km away
              {offer.eta_seconds
                ? ` · arriving in about ${Math.round(offer.eta_seconds / 60)} min`
                : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {live ? <Countdown expiresAt={offer.expires_at} now={now} /> : null}
            <div className="flex items-center gap-1.5">
              {inc ? (
                <Badge variant="outline" className={SEVERITY_STYLE[inc.severity] ?? ""}>
                  {inc.severity}
                </Badge>
              ) : null}
              {!live ? <Badge variant="outline">{offer.state}</Badge> : null}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {inc?.description ? <p className="text-sm">{inc.description}</p> : null}

        {vitals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {vitals.map(([k, v]) => (
              <span
                key={k}
                className="rounded border px-2 py-0.5 font-mono text-xs uppercase"
              >
                {k} {String(v)}
              </span>
            ))}
          </div>
        ) : null}

        {inc?.required_services?.length ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Needs: </span>
            {inc.required_services.join(", ")}
          </p>
        ) : null}

        <p className="text-muted-foreground text-xs">
          {inc?.address ?? inc?.district ?? "Location unknown"} · {inc?.ref}
          {offer.state === "superseded" && offer.winner
            ? ` · went to ${offer.winner.name}`
            : ""}
          {offer.decline_reason ? ` · you said: ${offer.decline_reason}` : ""}
        </p>

        {live && canAccept ? (
          showReasons ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Why can&apos;t you take it?</p>
              <div className="flex flex-wrap gap-2">
                {DECLINE_REASONS.map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void respond("decline", r)}
                  >
                    {r}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setShowReasons(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={() => void respond("accept")}
              >
                Accept patient
              </Button>
              <Button
                size="lg"
                variant="outline"
                disabled={busy}
                onClick={() => setShowReasons(true)}
              >
                Can&apos;t take
              </Button>
            </div>
          )
        ) : null}

        {live && !canAccept ? (
          <p className="text-muted-foreground text-sm">
            Your account can view this case but not answer for this facility.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function FacilityInboxPage() {
  const now = useNow();
  const pulse = useAcutePulse();
  const [nudge, setNudge] = useState(0);
  const { data: offers, loading, error } = useFacilityOffers(pulse + nudge);
  const { data: mine } = useMyFacilities(pulse);

  const acceptable = new Set(
    mine.filter((m) => m.can_accept).map((m) => m.facility_id),
  );
  const live = offers.filter((o) => o.state === "pending");
  const past = offers.filter((o) => o.state !== "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Incoming Cases</h1>
        <p className="text-muted-foreground text-sm font-medium">
          {mine.length > 0
            ? mine.map((m) => m.facility?.name).filter(Boolean).join(", ")
            : "No facility is linked to this account yet."}
        </p>
      </div>

      {error ? (
        <Card>
          <CardContent className="text-destructive py-6 text-sm">{error}</CardContent>
        </Card>
      ) : null}

      {!loading && live.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Nothing waiting. New cases appear here on their own.
          </CardContent>
        </Card>
      ) : null}

      {live.map((o) => (
        <OfferCard
          key={o.id}
          offer={o}
          now={now}
          canAccept={acceptable.has(o.facility_id)}
          onDone={() => setNudge((n) => n + 1)}
        />
      ))}

      {past.length > 0 ? (
        <div className="space-y-3 pt-2">
          <h2 className="text-muted-foreground px-1 text-xs font-semibold uppercase tracking-widest">
            Earlier
          </h2>
          {past.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              now={now}
              canAccept={false}
              onDone={() => setNudge((n) => n + 1)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
