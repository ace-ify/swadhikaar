"use client";

// The SOS button. Sends the incident through the intake edge function, never
// straight into the table: RLS lets ops insert incidents and nobody else, so a
// patient's phone cannot write one directly. EOS allows exactly that direct write,
// which is why their rate limiter runs as a parallel trigger and can never gate the
// fan-out it exists to gate.
//
// Calling 112 is on this screen too, and always enabled. Whatever this app does or
// fails to do, the phone network is the fallback that does not depend on us.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Camera, Phone, X } from "lucide-react";
import { SosStatus } from "@/components/patient/sos-status";
import { AirQuality } from "@/components/patient/air-quality";
import {
  useAcutePulse,
  useMyLiveIncident,
  myDispatch,
  uploadScenePhoto,
} from "@/hooks/use-acute";
import { clinicalEventBus } from "@/lib/event-bus";
import { generateSbarHandoff } from "@/lib/clinical/sbar";
import CprMetronome from "@/components/emergency/cpr-metronome";

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

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function SosPage() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [avpuState, setAvpuState] = useState<"A" | "V" | "P" | "U">("A");
  const now = useNow();

  // The victim is very often not the person holding the phone. Somebody stops at a
  // roadside accident for a stranger; a daughter presses it for her father. When the
  // report is not about the reporter, the reporter's blood group and allergies must not
  // travel with it -- so this flag goes to intake, and intake tells the trigger not to
  // infer identity from the account.
  const [forSelf, setForSelf] = useState(true);
  const [victimName, setVictimName] = useState("");

  // A photo is chosen before the emergency button but uploaded after intake answers.
  // Both halves of that matter: somebody who can see the scene has to be asked while
  // they are still looking at it, and an ambulance must never wait on a camera or on a
  // village upload. So the incident goes out first and the photo follows it.
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Revoking matters here: a phone photo held as an un-revoked blob URL is megabytes
  // pinned for the life of the tab, on the device least able to spare them.
  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Realtime, then a nudge for the moment right after sending, so the screen never
  // depends on a socket to be correct.
  const pulse = useAcutePulse();
  const [nudge, setNudge] = useState(0);
  const { data: incident, error: loadError } = useMyLiveIncident(pulse + nudge);

  // "Live" means the case has not finished. A delivered or closed case drops back to the
  // buttons, because the next emergency is a new one. `returning` counts as finished too:
  // the crew driving back to station is not this person's emergency any more, and without
  // it the screen flipped back to "help is coming" after the handover.
  const d = myDispatch(incident);
  const live =
    incident !== null &&
    !["resolved", "cancelled", "expired"].includes(incident.status) &&
    !(
      incident.status === "arrived" &&
      (d?.ambulance_state === "delivered" || d?.ambulance_state === "returning")
    );

  async function send(kind: (typeof KINDS)[number]) {
    setBusy(true);
    setError(null);
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
            reported_for_self: forSelf,
            victim_name: forSelf ? null : victimName.trim() || null,
            description: `Reported from the SOS button${
              forSelf ? "" : " by someone else at the scene"
            }. Location accurate to about ${Math.round(pos.coords.accuracy)} m.`,
          }),
        },
      );
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        incident_id?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.detail ?? body.error ?? "Could not send.");
      } else {
        setNudge((n) => n + 1);

        // Publish to Cross-Door Reactive Event Bus (instantly syncs with /dispatch and /doctor)
        clinicalEventBus.publish({
          type: "EMERGENCY_SOS_TRIGGERED",
          payload: {
            incidentId: body.incident_id || `sos-${Date.now()}`,
            type: kind.type,
            victimName: forSelf ? undefined : victimName.trim() || undefined,
            coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            triage: (kind.triage as any) || "red",
            sbar: generateSbarHandoff({
              type: kind.type,
              triage: (kind.triage as any) || "red",
              victimName: forSelf ? undefined : victimName.trim() || undefined,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
            timestamp: Date.now(),
          },
        });

        // Dispatch is already open at this point. The photo is a best-effort follow-up:
        // if it fails, say so plainly and leave the case alone. Losing a photograph is
        // not a reason to imply the ambulance did not go.
        if (photo && body.incident_id) {
          setStage("फोटो भेज रहे हैं… / Sending the photo…");
          const up = await uploadScenePhoto(body.incident_id, photo);
          if (up.ok) {
            setPhoto(null);
            setPhotoNote("फोटो भेज दी गई। / Photo sent to the hospital.");
          } else {
            setPhotoNote(
              "मदद भेज दी गई है, लेकिन फोटो नहीं गई। / Help is on the way, but the photo did not send.",
            );
          }
          setNudge((n) => n + 1);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not send.";
      // A geolocation refusal is the common case and needs its own words, not a
      // browser error string.
      setError(
        /denied|permission/i.test(message)
          ? "लोकेशन बंद है, इसलिए हम किसी को आपकी जगह नहीं बता सकते। इसे चालू करें, या अभी 112 पर कॉल करें। / Location is off — turn it on, or call 112 now."
          : message,
      );
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight" lang="hi">
          {live
            ? incident?.reported_for_self === false
              ? "मदद भेज दी है"
              : "मदद आ रही है"
            : "मदद चाहिए?"}
        </h1>
        <p className="text-muted-foreground text-sm" lang="hi">
          {live
            ? incident?.reported_for_self === false
              ? `${incident?.victim_name ?? "जिनके लिए भेजा"} — उनके पास रुकें।`
              : "बंद न करें।"
            : "जो हो रहा है उस पर दबाएं।"}
        </p>

      </div>

      {/* Always available, live case or not. Whatever this app does or fails to do, the
          phone network is the fallback that does not depend on us. */}
      <a href="tel:112" className="block">
        <Button variant="outline" size="lg" className="h-14 w-full text-base">
          <Phone className="mr-2 size-5" />
          <span lang="hi">112 पर कॉल करें</span>
          <span className="text-muted-foreground ml-2 text-xs">Call 112</span>
        </Button>
      </a>

      {live && incident ? (
        <div className="space-y-4">
          <SosStatus incident={incident} now={now} />

          {/* Sahara Emergency Participant Mesh */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-muted/40 p-3 rounded-xl border border-border text-center text-xs">
            <div className="p-2 rounded-lg bg-background/80 border border-border">
              <span className="block text-[10px] text-muted-foreground uppercase font-bold">You (Victim)</span>
              <span className="font-semibold text-emerald-400">GPS Live</span>
            </div>
            <div className="p-2 rounded-lg bg-background/80 border border-border">
              <span className="block text-[10px] text-muted-foreground uppercase font-bold">Sahara AI</span>
              <span className="font-semibold text-teal-400">Triage Copilot</span>
            </div>
            <div className="p-2 rounded-lg bg-background/80 border border-border">
              <span className="block text-[10px] text-muted-foreground uppercase font-bold">Caregiver</span>
              <span className="font-semibold text-cyan-400">WhatsApp Active</span>
            </div>
            <div className="p-2 rounded-lg bg-background/80 border border-border">
              <span className="block text-[10px] text-muted-foreground uppercase font-bold">108 EMS</span>
              <span className="font-semibold text-red-400">CAD Dispatched</span>
            </div>
          </div>

          {/* AVPU Consciousness Latch */}
          <div className="p-3 bg-red-950/20 border border-red-500/30 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-red-400">चेतना स्तर (AVPU Consciousness):</span>
              <span className="font-mono text-zinc-300 font-bold">
                {avpuState === "A" ? "A · Alert" : avpuState === "V" ? "V · Verbal" : avpuState === "P" ? "P · Pain" : "U · UNRESPONSIVE"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { key: "A", label: "A (सचेत)" },
                { key: "V", label: "V (बोल पा रहे)" },
                { key: "P", label: "P (दर्द महसूस)" },
                { key: "U", label: "U (बेहोश)" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setAvpuState(opt.key as any)}
                  className={`py-1.5 px-1 rounded text-[11px] font-bold border transition-all ${
                    avpuState === opt.key
                      ? "bg-red-600 text-white border-red-500 shadow"
                      : "bg-background/60 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* T5: Real-time CPR metronome & resuscitation rhythm while waiting for 108 */}
          <CprMetronome lang="hi" />

          {/* Quick Link to Offline First Aid */}
          <div className="pt-1 flex justify-center">
            <Link
              href="/patient/first-aid"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "text-xs border-border")}
            >
              📖 प्राथमिक उपचार गाइड (Offline First Aid)
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Ambient, and only when there is no live case: during an emergency nobody
              cares about PM2.5. Renders nothing at all without a location, so it can
              never put a permission prompt in front of the emergency buttons. */}
          <AirQuality />

          {/* Who is this for. Asked before the emergency buttons, not after: it changes
              what gets sent, and a person who has already pressed a red button is not
              going to read a follow-up question. */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { self: true, hi: "मेरे लिए", en: "For me" },
              { self: false, hi: "किसी और के लिए", en: "For someone else" },
            ].map((o) => (
              <Button
                key={o.en}
                type="button"
                variant={forSelf === o.self ? "secondary" : "outline"}
                className="h-auto py-2.5"
                onClick={() => setForSelf(o.self)}
              >
                <span className="flex flex-col leading-tight">
                  <span lang="hi" className="text-sm font-semibold">
                    {o.hi}
                  </span>
                  <span className="text-xs font-normal opacity-70">{o.en}</span>
                </span>
              </Button>
            ))}
          </div>

          {!forSelf ? (
            <div className="space-y-1.5">
              <Input
                value={victimName}
                onChange={(e) => setVictimName(e.target.value)}
                placeholder="Who is it? Leave blank if you don't know"
                aria-label="Who the emergency is for"
              />
              <p className="text-muted-foreground text-xs">
                <span lang="hi">
                  आपका मेडिकल रिकॉर्ड इसमें नहीं जाएगा — यह आपके बारे में नहीं है।
                </span>
                <span className="block">
                  Your own medical record is not attached — this is not about you.
                </span>
              </p>
            </div>
          ) : null}

          {/* Optional, and said so, in the smaller type: a person alone with chest pain
              must not read this as a step they have to complete first. `capture` opens
              the rear camera directly on a phone -- native, no picker library. */}
          <div className="space-y-1.5">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPhotoNote(null);
                // The bucket caps at 8 MB. Catching it here gives a sentence instead of
                // a storage error string after the emergency has already gone out.
                if (f && f.size > 8 * 1024 * 1024) {
                  setPhotoNote("फोटो बहुत बड़ी है। / That photo is too large (8 MB max).");
                  setPhoto(null);
                } else {
                  setPhoto(f);
                }
                e.target.value = "";
              }}
            />

            {preview ? (
              <div className="flex items-center gap-3 rounded-md border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="The photo you are about to send"
                  className="size-16 rounded object-cover"
                />
                <p className="flex-1 text-xs">
                  <span lang="hi" className="block font-medium">
                    यह फोटो अस्पताल को भेजी जाएगी।
                  </span>
                  <span className="text-muted-foreground">
                    Goes to the hospital with the call.
                  </span>
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove the photo"
                  onClick={() => {
                    setPhoto(null);
                    setPhotoNote(null);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full py-2.5"
                onClick={() => fileInput.current?.click()}
              >
                <Camera className="mr-2 size-4" />
                <span className="flex flex-col items-start leading-tight">
                  <span lang="hi" className="text-sm font-semibold">
                    फोटो लें (ज़रूरी नहीं)
                  </span>
                  <span className="text-xs font-normal opacity-70">
                    Photo of the scene — optional
                  </span>
                </span>
              </Button>
            )}
          </div>

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

          <div className="pt-2 flex justify-center">
            <Link
              href="/patient/first-aid"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "text-xs border-border")}
            >
              📖 प्राथमिक उपचार गाइड (Offline First Aid Protocols)
            </Link>
          </div>
        </>
      )}

      {busy ? <p className="text-center text-sm font-medium">{stage}</p> : null}

      {photoNote && !busy ? (
        <p className="text-muted-foreground text-center text-sm">{photoNote}</p>
      ) : null}

      {/* Stated, not silent. The last known state stays on screen above; this says it
          may be stale rather than letting the screen quietly contradict itself. */}
      {loadError ? (
        <Card className="border-amber-500">
          <CardContent className="py-4 text-sm">
            <p className="font-semibold" lang="hi">
              इंटरनेट नहीं मिल रहा — यह जानकारी पुरानी हो सकती है।
            </p>
            <p className="text-muted-foreground text-xs">
              Cannot reach the server, so this may be out of date. If anything changes,
              call 112.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-destructive">
          <CardContent className="py-5">
            <p className="font-semibold">{error}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
