"use client";

// The live status of the patient's own emergency — the screen EOS calls "SOS Active" and
// the biggest thing this side was missing. Before it existed, pressing SOS gave a
// reference number and then nothing: the person with the most at stake had the least
// information in the system.
//
// Every line here is read from the same rows the hospital and the control room are
// reading. Nothing is mocked, and where a number is an estimate it says so.

import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { firstAidFor } from "@/components/patient/first-aid";
import { MedicalSnapshot } from "@/components/patient/medical-snapshot";
import { myDispatch, cancelMyIncident, type MyIncident } from "@/hooks/use-acute";

// Leaflet reads window at module scope, so this cannot be server-rendered.
const PatientMap = dynamic(() => import("@/components/patient/patient-map"), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/30 flex h-[260px] items-center justify-center rounded-xl border">
      <span className="text-muted-foreground text-sm">नक्शा आ रहा है… / Loading map…</span>
    </div>
  ),
});

function mmss(total: number) {
  const s = Math.max(0, total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Four states, in the order they happen. Anything the engine can report maps onto one of
// them, because a patient does not need five words for "we are still asking".
type Step = { key: string; hi: string; en: string };
const STEPS: Step[] = [
  { key: "asking", hi: "अस्पताल ढूंढ रहे हैं", en: "Finding a hospital" },
  { key: "accepted", hi: "अस्पताल तैयार है", en: "Hospital is ready for you" },
  { key: "coming", hi: "एम्बुलेंस आ रही है", en: "Ambulance on the way" },
  { key: "arrived", hi: "अस्पताल पहुंच गए", en: "Arrived at hospital" },
];

function currentStep(incident: MyIncident): number {
  const d = myDispatch(incident);
  if (incident.status === "arrived" || incident.status === "resolved") return 3;
  if (d?.ambulance_state === "en_route" || d?.ambulance_state === "on_scene") return 2;
  if (d?.ambulance_state === "transporting") return 2;
  if (d?.state === "accepted") return 1;
  return 0;
}

export function SosStatus({
  incident,
  now,
}: {
  incident: MyIncident;
  now: number;
}) {
  const d = myDispatch(incident);
  const step = currentStep(incident);
  // Two taps, not a dialog: the first tap is small and quiet so nobody hits it while
  // panicking, and the second one says out loud what it will do.
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const elapsed = Math.max(
    0,
    Math.round((now - new Date(incident.created_at).getTime()) / 1000),
  );

  // Exhausted is the one state a patient must not be left guessing about: nobody
  // accepted, and the honest instruction is to call 112 rather than keep waiting.
  const stalled = d?.state === "exhausted" || d?.ambulance_state === "no_operator";

  return (
    <div className="space-y-4">
      <Card className={stalled ? "border-destructive" : "border-primary shadow-md"}>
        <CardContent className="space-y-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold tracking-tight" lang="hi">
                {stalled ? "अभी कोई अस्पताल नहीं मिला" : STEPS[step].hi}
              </p>
              <p className="text-muted-foreground text-sm">
                {stalled ? "No hospital available yet" : STEPS[step].en}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 font-mono">
              {incident.ref}
            </Badge>
          </div>

          {/* Four dots rather than a percentage. A progress bar implies a rate of
              progress that nobody can promise. */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={`h-1.5 flex-1 rounded-full ${
                  stalled
                    ? "bg-destructive/30"
                    : i <= step
                      ? "bg-primary"
                      : "bg-muted"
                }`}
              />
            ))}
          </div>

          <p className="text-muted-foreground text-xs">
            <span lang="hi">{mmss(elapsed)} पहले भेजा</span> · sent {mmss(elapsed)} ago
          </p>

          {stalled ? (
            <a href="tel:112" className="block">
              <Button variant="destructive" size="lg" className="h-14 w-full text-base">
                <Phone className="mr-2 size-5" />
                <span lang="hi">112 पर कॉल करें</span>
              </Button>
            </a>
          ) : null}
        </CardContent>
      </Card>

      {/* Only once a vehicle is assigned. A map of one dot -- yourself -- while hospitals
          are still being asked adds nothing and implies something is moving. */}
      {d?.unit?.lat != null && d.unit.lon != null && step < 3 ? (
        <div className="space-y-1">
          <PatientMap
            scene={{ lat: incident.lat, lon: incident.lon, label: "आप यहां / You" }}
            unit={{
              lat: d.unit.lat,
              lon: d.unit.lon,
              label: d.unit.call_sign,
            }}
            hospital={
              d.hospital
                ? { lat: d.hospital.lat, lon: d.hospital.lon, label: d.hospital.name }
                : null
            }
            heading={d.ambulance_state === "transporting" ? "hospital" : "scene"}
          />
          <p className="text-muted-foreground px-1 text-xs">
            <span lang="hi">सीधी रेखा, सड़क का रास्ता नहीं। एम्बुलेंस की जगह नकली है।</span>
            <span className="block">
              Straight line, not the road route. Ambulance position is simulated.
            </span>
          </p>
        </div>
      ) : null}

      {d?.hospital ? (
        <Card>
          <CardContent className="space-y-1 py-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              <span lang="hi">अस्पताल</span> · Hospital
            </p>
            <p className="font-semibold">{d.hospital.name}</p>
            {d.eta_seconds ? (
              <p className="text-muted-foreground text-sm">
                <span lang="hi">लगभग {Math.round(d.eta_seconds / 60)} मिनट दूर</span> ·
                about {Math.round(d.eta_seconds / 60)} min away
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {d?.unit ? (
        <Card>
          <CardContent className="space-y-1 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs uppercase tracking-wider">
                <span lang="hi">एम्बुलेंस</span> · Ambulance
              </p>
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                simulated
              </Badge>
            </div>
            <p className="font-semibold">
              {d.unit.call_sign}
              {d.unit.driver_name ? ` · ${d.unit.driver_name}` : ""}
            </p>
            {d.ambulance_eta_seconds ? (
              <p className="text-muted-foreground text-sm">
                <span lang="hi">
                  लगभग {Math.round(d.ambulance_eta_seconds / 60)} मिनट में पहुंचेगी
                </span>{" "}
                · arriving in about {Math.round(d.ambulance_eta_seconds / 60)} min
              </p>
            ) : null}
            {d.ambulance_state === "on_scene" ? (
              <p className="text-sm font-medium text-emerald-700" lang="hi">
                एम्बुलेंस पहुंच गई है
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* What the crew and the receiving hospital are being told about the patient. Shown
          to the patient too, because "your card is already with them" is only reassuring
          if you can see it -- and if it is thin, this is the screen that makes that
          visible while there is still time to fix it. */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            <span lang="hi">उन्हें यह भेजा गया है</span> · Sent to them
          </p>
          <MedicalSnapshot snapshot={incident.medical_snapshot} />
        </CardContent>
      </Card>

      {/* While waiting. Shown from the moment the case opens, because the useful minutes
          are the ones before anybody arrives. */}
      {step < 3 ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              <span lang="hi">तब तक ये करें</span> · While you wait
            </p>
            <ol className="space-y-2">
              {firstAidFor(incident.incident_type).map((s) => (
                <li key={s.en} className="text-sm">
                  <span lang="hi" className="font-medium">
                    {s.hi}
                  </span>
                  <span className="text-muted-foreground block text-xs">{s.en}</span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground border-t pt-2 text-xs">
              <span lang="hi">
                ये डॉक्टर की सलाह नहीं है। सांस चलती रहे, यही सबसे ज़रूरी है।
              </span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Last, and deliberately plain. A person who pressed by mistake had no way to
          take it back, so fifteen hospitals kept being asked and the only exit was to
          find a dispatcher. Hidden once the patient is in the vehicle -- at that point
          the crew is standing next to them and it is not a decision for a phone. */}
      {d?.ambulance_state !== "transporting" && step < 3 ? (
        <div className="pt-2 text-center">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-sm font-medium" lang="hi">
                मदद रोक दें? अस्पतालों को बता दिया जाएगा।
              </p>
              <p className="text-muted-foreground text-xs">
                Stop the request? The hospitals being asked will be told.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={cancelling}
                  onClick={() => setConfirming(false)}
                >
                  <span lang="hi">नहीं, मदद चाहिए</span>
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={cancelling}
                  onClick={async () => {
                    setCancelling(true);
                    const res = await cancelMyIncident(incident.id, "Pressed by mistake");
                    setCancelling(false);
                    if (res.ok) {
                      toast.success("रोक दिया / Stopped");
                    } else if (res.error === "patient_already_on_board") {
                      toast.error("एम्बुलेंस में हैं — क्रू से बात करें / Speak to the crew");
                    } else {
                      toast.error(String(res.error ?? "Could not stop it"));
                    }
                  }}
                >
                  {cancelling ? "…" : <span lang="hi">हां, रोक दें</span>}
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="text-muted-foreground hover:text-destructive text-xs underline"
              onClick={() => setConfirming(true)}
            >
              <span lang="hi">गलती से दब गया?</span>
              <span className="ml-1">Pressed by mistake?</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
