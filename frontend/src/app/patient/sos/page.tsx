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

// Hindi first, English under it. This is the one screen a person in a village holds
// in an emergency; the admin screens are read by staff who work in English.
const KINDS = [
  { hi: "दुर्घटना", en: "Accident", type: "Road traffic accident", triage: "red" },
  { hi: "सीने में दर्द", en: "Chest pain", type: "Cardiac emergency", triage: "red" },
  { hi: "सांस लेने में तकलीफ", en: "Breathing trouble", type: "Breathlessness", triage: "orange" },
  { hi: "बहुत खून बह रहा है", en: "Heavy bleeding", type: "Severe bleeding", triage: "red" },
  { hi: "गिर गए / चोट", en: "Fall or injury", type: "Fall", triage: "yellow" },
  { hi: "कुछ और", en: "Something else", type: "Emergency", triage: null },
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
      setStage("जगह पता कर रहे हैं… / Finding your location…");
      const pos = await position();

      setStage("भेज रहे हैं… / Sending…");
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
          ? "लोकेशन बंद है, इसलिए हम किसी को आपकी जगह नहीं बता सकते। इसे चालू करें, या अभी 112 पर कॉल करें। / Location is off — turn it on, or call 112 now."
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
        <h1 className="text-2xl font-bold tracking-tight" lang="hi">
          मदद चाहिए?
        </h1>
        <p className="text-muted-foreground text-sm" lang="hi">
          जो हो रहा है उस पर दबाएं। नज़दीकी अस्पतालों को तुरंत बताया जाएगा।
        </p>
        <p className="text-muted-foreground text-xs">
          Tap what is happening. The nearest hospitals are told straight away.
        </p>
      </div>

      <a href="tel:112" className="block">
        <Button variant="outline" size="lg" className="h-14 w-full text-base">
          <Phone className="mr-2 size-5" />
          <span lang="hi">112 पर कॉल करें</span>
          <span className="text-muted-foreground ml-2 text-xs">Call 112</span>
        </Button>
      </a>

      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((k) => (
          <Button
            key={k.en}
            size="lg"
            variant={k.triage === "red" ? "destructive" : "default"}
            className="h-16 text-base"
            disabled={busy}
            onClick={() => void send(k)}
          >
            <span className="flex flex-col items-center leading-tight">
              <span lang="hi" className="text-base font-semibold">
                {k.hi}
              </span>
              <span className="text-xs font-normal opacity-80">{k.en}</span>
            </span>
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
            <CardTitle className="text-base">
              <span lang="hi">मदद भेजी जा रही है</span>
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                Help is being arranged
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p lang="hi">
              नंबर <span className="font-mono font-semibold">{result.ref}</span> — यह
              याद रखें।
            </p>
            {result.dispatch?.offered_to ? (
              <p lang="hi">
                {result.dispatch.offered_to} अस्पतालों को बताया गया है। थोड़ी देर में
                जवाब आएगा।
              </p>
            ) : (
              <p lang="hi">
                पास कोई अस्पताल नहीं मिला — कृपया 112 पर कॉल करें।
              </p>
            )}
            {result.rate_limit_flagged ? (
              <p className="text-muted-foreground text-xs" lang="hi">
                आपने कई बार भेजा है। यह फिर भी आगे भेज दिया गया है।
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
