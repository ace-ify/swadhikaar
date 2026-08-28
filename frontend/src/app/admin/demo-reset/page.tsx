"use client";

// Booth housekeeping, on its own route on purpose.
//
// Every visitor who presses a preset creates a real incident, so after four of them the
// board is cluttered and the story is harder to tell. This gets used perhaps twenty
// times in a day — between groups, under time pressure, mid-conversation. The
// alternative was pasting statements into a SQL editor in that state, which is how
// someone eventually pastes the wrong thing.
//
// NOT a button on the dispatch console: a visitor should never see the scaffolding, and
// a destructive control one tap from "Accept patient" is a bad idea regardless of who
// is watching.

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { demoState, resetDemoState, type DemoState } from "@/hooks/use-acute";

type Row = {
  label: string;
  value: number;
  // Green when this is the value you want before a visitor arrives.
  good: (n: number) => boolean;
  note?: string;
};

export default function DemoResetPage() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  // A counter rather than calling setState from inside the effect: the effect
  // subscribes to a clock, and the fetch belongs to the state it produces.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void demoState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = () => setTick((n) => n + 1);

  async function reset() {
    setBusy(true);
    const res = await resetDemoState();
    setBusy(false);
    if (res.ok) {
      toast.success(`Cleared ${String(res.incidents_cleared)} test cases`);
      refresh();
    } else {
      toast.error(String(res.error ?? "Could not reset"));
    }
  }

  const rows: Row[] = state
    ? [
        {
          label: "Test cases on the board",
          value: state.simulated_incidents,
          good: (n) => n === 0,
          note: "Cleared by the button below",
        },
        {
          label: "Real cases",
          value: state.real_incidents,
          good: () => true,
          note: "Never touched by the reset",
        },
        { label: "Hospitals still waiting to answer", value: state.open_offers, good: (n) => n === 0 },
        {
          label: "Ambulances free",
          value: state.units_free,
          good: (n) => n === state.units_total,
          note: `of ${state.units_total}`,
        },
        {
          label: "Calls due to dial right now",
          value: state.calls_due_now,
          good: (n) => n === 0,
          note: "Must be zero — a job dials these every five minutes",
        },
        {
          label: "Phone numbers that could actually ring",
          value: state.routable_phones,
          good: (n) => n === 0,
          note: "Must be zero",
        },
        {
          label: "Hospital logins linked",
          value: state.hospital_logins,
          good: (n) => n > 0,
          note: "Needs at least one, or the hospital screen is empty",
        },
      ]
    : [];

  const allGood = rows.length > 0 && rows.every((r) => r.good(r.value));

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Demo housekeeping</h1>
        <p className="text-muted-foreground text-sm font-medium">
          Keep this open in a spare tab. Reset between groups, not mid-explanation.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base tracking-tight">Right now</CardTitle>
            {state ? (
              <Badge
                variant="outline"
                className={
                  allGood
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-amber-500 bg-amber-50 text-amber-700"
                }
              >
                {allGood ? "ready" : "needs a reset"}
              </Badge>
            ) : null}
          </div>
          <CardDescription>Refreshes every five seconds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {!state ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.label}
                className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-0"
              >
                <span>
                  {r.label}
                  {r.note ? (
                    <span className="text-muted-foreground text-xs"> · {r.note}</span>
                  ) : null}
                </span>
                <span
                  className={`font-mono font-semibold ${
                    r.good(r.value) ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {r.value}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base tracking-tight">Clear the test cases</CardTitle>
          <CardDescription>
            Removes only cases the demo created, resets the hospitals&apos; accept history,
            and parks every ambulance back at its station. Patients, screenings, calls and
            the audit log are never touched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void reset()}
          >
            {busy ? "Clearing…" : "Reset the board"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
