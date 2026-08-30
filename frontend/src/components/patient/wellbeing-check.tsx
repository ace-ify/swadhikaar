"use client";

// "Are you still there?" — asked out loud, every 60 seconds, while help is on its way.
//
// This is the one thing EOS's victim app does that we had no answer to: a person who is
// bleeding or having a cardiac event can stop being able to hold a phone, and nobody finds
// out until the crew arrives. Their version checks in every 60 seconds and alerts
// responders after three misses. So does this one.
//
// The voice is the browser's own speechSynthesis, not a hosted TTS. That is deliberate
// twice over: there is no key to leak and no per-call cost, and more importantly there is
// no network round trip, so it speaks the instant the prompt appears. A voice that arrives
// two seconds late is worse than no voice in an emergency.
//
// Every answer and every miss is written to incident_events — the same audit trail the
// hospital and the control room already read, so an unanswered check-in shows up on their
// screens without anything new being built. Writes use return=minimal because a patient
// can insert into that table but cannot read it back, which is the correct split.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2 } from "lucide-react";

const ASK_EVERY_MS = 60_000;
// A person who is fine answers in a few seconds. Thirty is generous enough that putting
// the phone down to hold a dressing does not get them counted as unresponsive.
const ANSWER_WINDOW_MS = 30_000;
const MISSES_BEFORE_ALERT = 3;

const PROMPT_HI = "क्या आप ठीक हैं? हां दबाएं।";
const PROMPT_EN = "Are you still there? Tap yes.";

// Speaks if the device can. Silence is an acceptable outcome -- the prompt is on screen
// either way, and a missing voice must never stop the check-in from being recorded.
function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hi-IN";
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    // No voice on this device. The written prompt stands on its own.
  }
}

export function WellbeingCheck({ incidentId }: { incidentId: string }) {
  const [asking, setAsking] = useState(false);
  const [misses, setMisses] = useState(0);
  const [lastOk, setLastOk] = useState(false);
  const [alerted, setAlerted] = useState(false);
  // Read inside the interval callback, so the timer never restarts when a count changes.
  const missesRef = useRef(0);
  const askingRef = useRef(false);
  const alertedRef = useRef(false);

  const log = useCallback(
    async (action: string, detail: Record<string, unknown>) => {
      // No .select() chained on purpose. supabase-js sends Prefer: return=minimal unless
      // you ask for the row back, and asking would fail the whole write: a patient can
      // insert into the trail but cannot read it, which is the correct split.
      const { error } = await createClient()
        .from("incident_events")
        .insert({ incident_id: incidentId, action, actor_role: "patient", detail });
      if (error) console.warn("wellbeing check-in not recorded:", error.message);
    },
    [incidentId],
  );

  const answer = useCallback(() => {
    askingRef.current = false;
    setAsking(false);
    setLastOk(true);
    missesRef.current = 0;
    setMisses(0);
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* nothing to cancel */
    }
    void log("wellbeing_ok", { misses_before: 0 });
  }, [log]);

  useEffect(() => {
    let answerTimer: ReturnType<typeof setTimeout> | undefined;

    const ask = () => {
      askingRef.current = true;
      setAsking(true);
      speak(PROMPT_HI);

      answerTimer = setTimeout(() => {
        if (!askingRef.current) return; // answered in time
        askingRef.current = false;
        setAsking(false);
        const n = missesRef.current + 1;
        missesRef.current = n;
        setMisses(n);
        void log("wellbeing_missed", { consecutive_misses: n });

        if (n >= MISSES_BEFORE_ALERT && !alertedRef.current) {
          alertedRef.current = true;
          setAlerted(true);
          // The one line that matters to the crew: they are driving to someone who has
          // stopped answering, and they should expect an unresponsive patient.
          void log("wellbeing_unresponsive", {
            consecutive_misses: n,
            window_seconds: ANSWER_WINDOW_MS / 1000,
          });
        }
      }, ANSWER_WINDOW_MS);
    };

    const cycle = setInterval(ask, ASK_EVERY_MS);
    // First prompt after one interval, not immediately: the seconds right after pressing
    // SOS belong to the person, not to us.
    return () => {
      clearInterval(cycle);
      if (answerTimer) clearTimeout(answerTimer);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing to cancel */
      }
    };
  }, [log]);

  if (alerted) {
    return (
      <Card className="border-destructive">
        <CardContent className="space-y-1 py-4">
          <p className="font-semibold" lang="hi">
            आपने {MISSES_BEFORE_ALERT} बार जवाब नहीं दिया — क्रू को बता दिया है।
          </p>
          <p className="text-muted-foreground text-xs">
            No answer to {MISSES_BEFORE_ALERT} check-ins. The crew has been told to expect
            an unresponsive patient.
          </p>
          <Button className="mt-2 h-12 w-full" onClick={answer}>
            <span lang="hi">मैं ठीक हूँ</span>
            <span className="ml-2 text-xs opacity-80">I&apos;m here</span>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={asking ? "border-primary shadow-md" : ""}>
      <CardContent className="space-y-2 py-4">
        {asking ? (
          <>
            <div className="flex items-center gap-2">
              <Volume2 className="text-primary size-4 animate-pulse" />
              <p className="font-semibold" lang="hi">
                {PROMPT_HI}
              </p>
            </div>
            <p className="text-muted-foreground text-xs">{PROMPT_EN}</p>
            <Button size="lg" className="h-14 w-full text-base" onClick={answer}>
              <span lang="hi">हां, मैं ठीक हूँ</span>
              <span className="ml-2 text-xs opacity-80">Yes, I&apos;m here</span>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            <span lang="hi">हम हर मिनट पूछेंगे कि आप ठीक हैं।</span>
            <span className="block">
              We ask every minute that you are still there
              {lastOk ? " · you answered the last one" : ""}
              {misses > 0 ? ` · ${misses} missed` : ""}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
