"use client";

// The crew's screen. One page, because the person reading it is driving.
//
// WHAT IS REAL HERE. Everything except the 48 demo vehicles. The offer, the 180-second
// deadline, the accept race, the phase transitions and the position all go through the
// same tables and functions 005_fleet_and_intake.sql already built for the ambulance
// leg — this screen replaced a cron that was pressing those buttons on a crew's behalf.
//
// Navigation is deliberately NOT in-app. A Leaflet line on a phone is not turn-by-turn;
// the Maps app already installed on the device is, it knows the one-ways and it speaks.
// So the button hands off a destination and gets out of the way.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigation,
  Siren,
  Ambulance,
  MapPin,
  Phone,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase";
import {
  useAcutePulse,
  useMyFleetRun,
  setAmbulancePhase,
  acceptFleetOffer,
  rejectFleetOffer,
  pushMyPosition,
  goOnShift,
  type FleetRun,
} from "@/hooks/use-acute";
import {
  LADDER,
  PHASE_LABEL,
  metresBetween,
  ON_SCENE_RADIUS_M,
} from "@/lib/fleet-phases";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CareLog } from "@/components/fleet/care-log";
import { SceneBrief } from "@/components/fleet/scene-brief";
import { VoiceChannel } from "@/components/fleet/voice-channel";
import { ScenePhoto } from "@/components/scene-photo";

function mapsLink(lat: number, lon: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Where the crew is actually going right now. Before the patient is loaded that is the
// scene; after, it is the receiving hospital. Getting this wrong sends a crew with a
// patient on board back to the roadside they just left.
function destination(run: FleetRun): { label: string; lat: number; lon: number } | null {
  const afterPickup = run.phase === "transporting" || run.phase === "delivered";
  if (afterPickup) {
    if (run.destination_lat == null || run.destination_lon == null) return null;
    return {
      label: run.destination_name ?? "Receiving hospital",
      lat: run.destination_lat,
      lon: run.destination_lon,
    };
  }
  return { label: run.address ?? "Scene", lat: run.lat, lon: run.lon };
}

export default function FleetPage() {
  const pulse = useAcutePulse();
  const [nudge, setNudge] = useState(0);
  const { data, loading, error } = useMyFleetRun(pulse + nudge);
  const now = useNow();
  const refresh = useCallback(() => setNudge((n) => n + 1), []);

  const unit = data?.unit ?? null;
  const run = data?.run ?? null;
  const offer = data?.offer ?? null;
  const onShift = unit ? !unit.is_simulated : false;

  const [gps, setGps] = useState<{ lat: number; lon: number; accuracy: number } | null>(
    null,
  );
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The watch is started once per shift, not once per phase change, so everything it
  // needs about the current run lives in a ref rather than in the effect's dependencies
  // — otherwise every phase transition would tear down and re-acquire GPS. The scene
  // coordinates are in here too: reading them from the `run` closure would read the
  // value as it was when the shift started, which is null.
  const runRef = useRef<{
    incidentId: string;
    phase: string | null;
    lat: number;
    lon: number;
  } | null>(null);
  useEffect(() => {
    runRef.current = run
      ? { incidentId: run.incident_id, phase: run.phase, lat: run.lat, lon: run.lon }
      : null;
  }, [run]);

  const lastSent = useRef(0);
  const autoScened = useRef<string | null>(null);

  // The id, not the object: useMyFleetRun hands back a fresh object on every pulse, and
  // depending on that would tear the GPS watch down and re-acquire it every few seconds.
  const unitId = unit?.id;

  useEffect(() => {
    if (!unitId || !onShift) return;
    if (!("geolocation" in navigator)) {
      setGpsError("This device cannot share its location.");
      return;
    }
    setGpsError(null);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, accuracy } = pos.coords;
        setGps({ lat: latitude, lon: longitude, accuracy });

        // Throttled to the 5-second heartbeat EOS's operator app used. watchPosition
        // can fire several times a second on a moving vehicle, and every one of those
        // would otherwise be a write.
        if (Date.now() - lastSent.current > 5000) {
          lastSent.current = Date.now();
          void pushMyPosition(unitId, latitude, longitude, heading);
        }

        // 200 m auto-arrival. Fires at most once per incident: the ref is the guard,
        // and set_ambulance_phase refuses a second transition anyway, so a double fire
        // is harmless rather than a duplicate audit event.
        const r = runRef.current;
        if (r && r.phase === "en_route" && autoScened.current !== r.incidentId) {
          const away = metresBetween(latitude, longitude, r.lat, r.lon);
          if (away <= ON_SCENE_RADIUS_M) {
            autoScened.current = r.incidentId;
            void setAmbulancePhase(r.incidentId, "on_scene").then((res) => {
              if (res.ok !== false) {
                toast.success("Marked on scene automatically.");
                refresh();
              }
            });
          }
        }
      },
      (err) => {
        setGpsError(
          /denied|permission/i.test(err.message)
            ? "Location is off. Dispatch cannot see this vehicle — turn it on."
            : err.message,
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [unitId, onShift, refresh]);

  // --------------------------------------------------------------- actions
  const act = useCallback(
    async (fn: () => Promise<{ ok?: boolean; error?: string }>, good: string) => {
      setBusy(true);
      const res = await fn();
      setBusy(false);
      if (res.ok === false) {
        // Server-side refusals are shown verbatim rather than as "failed": a crew
        // pressing a button that no longer applies needs to know it was already
        // answered, not that the app is broken.
        toast.error(res.error ?? "That did not go through.");
      } else {
        toast.success(good);
      }
      refresh();
    },
    [refresh],
  );

  async function toggleShift() {
    if (!unit) return;
    if (onShift && run) {
      toast.error("Finish or hand over this run before signing off.");
      return;
    }
    setBusy(true);
    const res = await goOnShift(unit.id, !onShift, Boolean(run));
    setBusy(false);
    if (res.error) toast.error(res.error);
    else toast.success(!onShift ? "On shift — dispatch can see you." : "Signed off.");
    refresh();
  }

  // The crew's own emergency. Goes through incident-intake exactly as a patient's SOS
  // button does — same function, same channel, same rate-limit log — because a crew in
  // a rolled-over ambulance is an incident like any other and deserves the same
  // dispatch fan-out. reported_for_self is false: the medical record attached must not
  // be the driver's own.
  const [armed, setArmed] = useState(false);
  async function crewSos() {
    if (!unit) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const pos = gps ?? (unit.lat != null && unit.lon != null
        ? { lat: unit.lat, lon: unit.lon, accuracy: 0 }
        : null);
      if (!pos) throw new Error("No position yet — go on shift first, or call 112.");

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/incident-intake`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channel: "sos_button",
            lat: pos.lat,
            lon: pos.lon,
            incident_type: "Ambulance crew emergency",
            triage_colour: "red",
            reported_for_self: false,
            victim_name: `Crew of ${unit.call_sign}`,
            reporter_name: unit.driver_name,
            reporter_phone: unit.phone,
            description:
              `Raised from inside ambulance ${unit.call_sign}. The crew itself needs ` +
              `help.${run ? ` They were on run ${run.ref}.` : ""}`,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(body.detail ?? body.error ?? "Could not send.");
      } else {
        toast.success(`Sent. Ref ${body.ref}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const step = useMemo(
    () => LADDER.find((l) => l.from === run?.phase) ?? null,
    [run?.phase],
  );
  const dest = run ? destination(run) : null;
  const secondsLeft = offer
    ? Math.max(0, Math.round((new Date(offer.response_deadline_at).getTime() - now) / 1000))
    : 0;

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="border-amber-500">
          <CardContent className="space-y-2 py-6">
            <p className="font-semibold">No vehicle is linked to this account.</p>
            <p className="text-muted-foreground text-sm">
              A crew screen needs a row in <code>fleet_units</code> with{" "}
              <code>operator_uid</code> set to this user. Ops assigns that; there is no
              self-service path on purpose, because a vehicle is a physical asset.
            </p>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 pb-24">
      {/* ------------------------------------------------------------- shift */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2">
            <Ambulance className="size-5 shrink-0" />
            <span className="font-mono text-lg font-bold">{unit.call_sign}</span>
            <Badge variant={onShift ? "default" : "outline"} className="ml-auto">
              {onShift ? "On shift" : "Off shift"}
            </Badge>
          </div>

          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {onShift && gps ? (
              <>
                <Wifi className="size-3.5 text-emerald-600" />
                Broadcasting · accurate to about {Math.round(gps.accuracy)} m
              </>
            ) : (
              <>
                <WifiOff className="size-3.5" />
                {onShift ? "Waiting for a GPS fix…" : "Dispatch cannot see this vehicle"}
              </>
            )}
          </div>

          {gpsError ? (
            <p className="text-destructive flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {gpsError}
            </p>
          ) : null}

          <Button
            variant={onShift ? "outline" : "default"}
            className="h-12 w-full"
            disabled={busy}
            onClick={() => void toggleShift()}
          >
            {onShift ? "Sign off" : "Go on shift"}
          </Button>

          {!onShift ? (
            <p className="text-muted-foreground text-[11px] leading-snug">
              Off shift, this vehicle is one of the simulated units the demo map animates.
              Going on shift takes it off the simulation and its position comes from this
              phone only.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- offer */}
      {offer && !run ? (
        <Card className="border-destructive border-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-baseline justify-between text-base">
              <span>{offer.incident_type}</span>
              <span
                className={
                  secondsLeft <= 30
                    ? "text-destructive font-mono text-xl font-bold"
                    : "font-mono text-xl font-bold"
                }
              >
                {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </span>
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {offer.ref} · {offer.severity}
              {offer.triage_colour ? ` · ${offer.triage_colour} triage` : ""}
              {offer.distance_km != null ? ` · ${offer.distance_km} km away` : ""}
              {offer.attempt > 0 ? ` · attempt ${offer.attempt + 1}` : ""}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="flex items-start gap-1.5 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {[offer.address, offer.district].filter(Boolean).join(", ") ||
                `${offer.lat.toFixed(4)}, ${offer.lon.toFixed(4)}`}
            </p>
            {offer.dispatching_facility ? (
              <p className="text-muted-foreground text-xs">
                Requested by {offer.dispatching_facility}
              </p>
            ) : null}

            {secondsLeft === 0 ? (
              <p className="text-muted-foreground text-sm">
                This offer has expired and has gone to another crew.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button
                  className="col-span-2 h-14 text-base"
                  disabled={busy}
                  onClick={() =>
                    void act(() => acceptFleetOffer(offer.assignment_id), "Accepted.")
                  }
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  className="h-14"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => rejectFleetOffer(offer.assignment_id, "crew_declined"),
                      "Declined — it goes to the next crew now.",
                    )
                  }
                >
                  Can&apos;t
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* --------------------------------------------------------------- run */}
      {run ? (
        <>
          <Card
            className={
              run.triage_colour === "red" ? "border-destructive border-2" : undefined
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {run.victim_name ?? "Unidentified patient"}
                {run.victim_age != null ? `, ${run.victim_age}` : ""}
              </CardTitle>
              <p className="text-muted-foreground text-xs">
                {run.ref} · {run.incident_type} · {run.severity}
                {run.triage_colour ? ` · ${run.triage_colour} triage` : ""}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant="secondary" className="text-sm">
                {PHASE_LABEL[run.phase ?? ""] ?? run.phase ?? "unknown"}
              </Badge>

              {run.description ? (
                <p className="text-sm leading-relaxed">{run.description}</p>
              ) : null}

              {/* The photo the reporter took, if there is one. This is the audience it
                  was always for -- a crew that can see the roadside before arriving
                  packs differently -- and until 015 widened the storage policy they
                  were the one group who could not load it. */}
              <ScenePhoto path={run.scene_photo_path} />

              {run.required_services?.length ? (
                <p className="text-muted-foreground text-xs">
                  Needs: {run.required_services.join(", ")}
                </p>
              ) : null}

              {/* Turn-by-turn is the phone's Maps app, not a line drawn on a canvas in
                  here. It knows the one-ways, it re-routes, and it speaks. */}
              {dest ? (
                <>
                  <a
                    href={mapsLink(dest.lat, dest.lon)}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    <Button className="h-14 w-full text-base">
                      <Navigation className="mr-2 size-5" />
                      Navigate to {run.phase === "transporting" ? "hospital" : "scene"}
                    </Button>
                  </a>
                  <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    {dest.label}
                    {gps ? (
                      <span className="ml-auto shrink-0 font-mono">
                        {(
                          metresBetween(gps.lat, gps.lon, dest.lat, dest.lon) / 1000
                        ).toFixed(1)}{" "}
                        km
                      </span>
                    ) : null}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No receiving hospital coordinates on this dispatch, so there is nothing
                  to navigate to. Ask the dispatcher.
                </p>
              )}

              {step ? (
                <Button
                  variant="secondary"
                  className="h-14 w-full text-base"
                  disabled={busy}
                  onClick={() => {
                    if (step.confirm && !window.confirm(step.confirm)) return;
                    void act(
                      () => setAmbulancePhase(run.incident_id, step.next),
                      step.label,
                    );
                  }}
                >
                  <CheckCircle2 className="mr-2 size-5" />
                  {step.label}
                </Button>
              ) : null}

              {run.reporter_phone ? (
                <a href={`tel:${run.reporter_phone}`} className="block">
                  <Button variant="outline" className="h-12 w-full">
                    <Phone className="mr-2 size-4" />
                    Call {run.reporter_name ?? "the reporter"}
                  </Button>
                </a>
              ) : null}
            </CardContent>
          </Card>

          <SceneBrief incidentId={run.incident_id} />
          <VoiceChannel incidentId={run.incident_id} />
          <CareLog incidentId={run.incident_id} />
        </>
      ) : null}


      {!run && !offer ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            {onShift
              ? "No run. You will be offered the next call within 180 seconds of a hospital accepting one."
              : "Go on shift to be offered calls."}
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------ crew SOS */}
      {/* Two taps, not one. This raises a real incident with a real dispatch fan-out,
          and a red button at the bottom of a screen in a moving vehicle gets brushed. */}
      <Card className="border-destructive">
        <CardContent className="space-y-2 py-4">
          {armed ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="destructive"
                className="h-14 text-base"
                disabled={busy}
                onClick={() => void crewSos()}
              >
                Yes — send help to us
              </Button>
              <Button variant="outline" className="h-14" onClick={() => setArmed(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => setArmed(true)}
            >
              <Siren className="mr-2 size-4" />
              We need help — crew SOS
            </Button>
          )}
          <a href="tel:112" className="block">
            <Button variant="outline" className="h-12 w-full">
              <Phone className="mr-2 size-4" />
              Call 112
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Stated, not silent: the last known state stays on screen rather than the page
          quietly contradicting itself. Same rule as the patient SOS screen. */}
      {error ? (
        <Card className="border-amber-500">
          <CardContent className="py-4 text-sm">
            <p className="font-semibold">Cannot reach the server.</p>
            <p className="text-muted-foreground text-xs">
              What is on screen may be out of date. Use the radio or 112 if anything has
              changed.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
