"use client";

// The SOS button. Sends the incident through the intake edge function, never
// straight into the table: RLS lets ops insert incidents and nobody else, so a
// patient's phone cannot write one directly. EOS allows exactly that direct write,
// which is why their rate limiter runs as a parallel trigger and can never gate the
// fan-out it exists to gate.
//
// Calling 112 is on this screen too, and always enabled. Whatever this app does or
// fails to do, the phone network is the fallback that does not depend on us.

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";

type Result = {
  ok?: boolean;
  ref?: string;
  severity?: string;
  error?: string;
  detail?: string;
  rate_limit_flagged?: boolean;
  dispatch?: { offered_to?: number; candidates?: number; state?: string };
};

const KINDS = [
  { label: "Accident", type: "Road traffic accident", triage: "red" },
  { label: "Chest pain", type: "Cardiac emergency", triage: "red" },
  { label: "Breathing trouble", type: "Breathlessness", triage: "orange" },
  { label: "Bleeding", type: "Severe bleeding", triage: "red" },
  { label: "Fall / injury", type: "Fall", triage: "yellow" },
  { label: "Something else", type: "Emergency", triage: null },
] as const;

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device cannot share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });
}

export default function SosPage() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function send(kind: (typeof KINDS)[number]) {
    setBusy(true);
    setResult(null);
    try {
      setStage("Finding your location…");
      const pos = await position();

      setStage("Sending…");
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

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
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            incident_type: kind.type,
            triage_colour: kind.triage,
            description: `Reported from the SOS button. Location accurate to about ${Math.round(
              pos.coords.accuracy,
            )} m.`,
          }),
        },
      );
      setResult((await res.json()) as Result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not send.";
      // A geolocation refusal is the common case and needs its own words, not a
      // browser error string.
      setResult({
        error: /denied|permission/i.test(message)
          ? "Location is switched off, so we cannot tell anyone where you are. Turn it on, or call 112 now."
          : message,
      });
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight">Get help now</h1>
        <p className="text-muted-foreground text-sm">
          Tap what is happening. The nearest hospitals are asked straight away.
        </p>
      </div>

      <a href="tel:112" className="block">
        <Button variant="outline" size="lg" className="h-14 w-full text-base">
          <Phone className="mr-2 size-5" />
          Call 112
        </Button>
      </a>

      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((k) => (
          <Button
            key={k.label}
            size="lg"
            variant={k.triage === "red" ? "destructive" : "default"}
            className="h-16 text-base"
            disabled={busy}
            onClick={() => void send(k)}
          >
            {k.label}
          </Button>
        ))}
      </div>

      {busy ? (
        <p className="text-center text-sm font-medium">{stage}</p>
      ) : null}

      {result?.error ? (
        <Card className="border-destructive">
          <CardContent className="space-y-1 py-5">
            <p className="font-semibold">{result.error}</p>
            {result.detail ? (
              <p className="text-muted-foreground text-sm">{result.detail}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {result?.ok ? (
        <Card className="border-emerald-600">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Help is being arranged</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Reference <span className="font-mono font-semibold">{result.ref}</span>. Keep
              this to hand.
            </p>
            <p>
              {result.dispatch?.offered_to
                ? `${result.dispatch.offered_to} hospital${
                    result.dispatch.offered_to === 1 ? "" : "s"
                  } asked. Someone will answer shortly.`
                : "No hospital nearby could be reached automatically — please call 112."}
            </p>
            {result.severity ? (
              <Badge variant="outline">assessed as {result.severity}</Badge>
            ) : null}
            {result.rate_limit_flagged ? (
              <p className="text-muted-foreground text-xs">
                You have sent several requests recently. This one was still passed on.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
