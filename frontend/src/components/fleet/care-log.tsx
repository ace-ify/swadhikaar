"use client";

// En-route care record. Every entry is appended to incident_events, which is
// append-only and already rendered by the dispatch console and the facility inbox, so
// the hospital sees the crew's observations before the vehicle arrives.
//
// Free text plus four numbers, and nothing else. A structured form with thirty fields
// is not filled in by someone kneeling in a footwell — EOS's own pilot notes the same
// thing about their intake form. The numbers are the four a receiving ED asks for
// first; anything else goes in the note.

import { useState } from "react";
import { toast } from "sonner";
import { recordFleetCare } from "@/hooks/use-acute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Keys match what emergency_snapshot() and MedicalSnapshot already use, so a crew
// reading merges into the same fields the hospital was already looking at rather than
// creating a parallel set nobody renders.
const VITALS = [
  { key: "systolic_bp", label: "Systolic BP", unit: "mmHg", min: 40, max: 300 },
  { key: "diastolic_bp", label: "Diastolic BP", unit: "mmHg", min: 20, max: 200 },
  { key: "heart_rate", label: "Pulse", unit: "bpm", min: 20, max: 250 },
  { key: "oxygen_saturation", label: "SpO₂", unit: "%", min: 40, max: 100 },
] as const;

const INTERVENTIONS = [
  "Oxygen given",
  "Bleeding controlled",
  "Spinal immobilisation",
  "IV line placed",
  "Airway cleared",
  "CPR in progress",
  "Splinted",
  "Patient conscious",
] as const;

export function CareLog({ incidentId }: { incidentId: string }) {
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [drugs, setDrugs] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);

  function toggle(name: string) {
    setChosen((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));
  }

  async function submit() {
    // Range-checked here, not just server-side, because a fat-fingered "220" in the
    // SpO2 box would otherwise land on the hospital's snapshot as a real reading.
    const numbers: Record<string, number> = {};
    for (const v of VITALS) {
      const raw = vitals[v.key]?.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < v.min || n > v.max) {
        toast.error(`${v.label} must be between ${v.min} and ${v.max} ${v.unit}.`);
        return;
      }
      numbers[v.key] = n;
    }

    if (
      Object.keys(numbers).length === 0 &&
      chosen.length === 0 &&
      !note.trim() &&
      !drugs.trim()
    ) {
      toast.error("Nothing to record yet.");
      return;
    }

    setBusy(true);
    const res = await recordFleetCare(incidentId, {
      vitals: numbers,
      interventions: chosen,
      drugs: drugs.trim() || null,
      note: note.trim() || null,
      recorded_at: new Date().toISOString(),
    });
    setBusy(false);

    if (res.ok === false) {
      toast.error(res.error ?? "Could not save this entry.");
      return;
    }
    toast.success("Sent to the hospital.");
    setVitals({});
    setChosen([]);
    setNote("");
    setDrugs("");
    setSaved((n) => n + 1);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>En-route care</span>
          {saved > 0 ? (
            <Badge variant="secondary">
              {saved} {saved === 1 ? "entry" : "entries"} sent
            </Badge>
          ) : null}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Each entry is timestamped and appended — it cannot be edited afterwards, and
          the receiving hospital sees it immediately.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {VITALS.map((v) => (
            <label key={v.key} className="space-y-1">
              <span className="text-muted-foreground text-xs font-medium">
                {v.label} <span className="font-normal">({v.unit})</span>
              </span>
              <Input
                type="number"
                inputMode="numeric"
                value={vitals[v.key] ?? ""}
                onChange={(e) =>
                  setVitals((s) => ({ ...s, [v.key]: e.target.value }))
                }
                className="h-11 text-base"
              />
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            What has been done
          </span>
          <div className="flex flex-wrap gap-1.5">
            {INTERVENTIONS.map((i) => (
              <Button
                key={i}
                type="button"
                size="sm"
                variant={chosen.includes(i) ? "secondary" : "outline"}
                className="h-9"
                onClick={() => toggle(i)}
              >
                {i}
              </Button>
            ))}
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs font-medium">
            Drugs given — name, dose, time
          </span>
          <Input
            value={drugs}
            onChange={(e) => setDrugs(e.target.value)}
            placeholder="e.g. Oxygen 6 L/min from 14:22"
            className="h-11"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs font-medium">
            Anything the hospital should know
          </span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Mechanism of injury, allergies the family mentioned, deterioration…"
          />
        </label>

        <Button onClick={() => void submit()} disabled={busy} className="h-12 w-full">
          {busy ? "Sending…" : "Send to hospital"}
        </Button>
      </CardContent>
    </Card>
  );
}
