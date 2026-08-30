"use client";

// Declared capacity. The numbers a facility gives here are read directly by the dispatch
// scoring engine — beds feed the capacity factor, doctors feed staffing, and blood feeds
// a factor that until migration 014 held a reserved weight and a hardcoded zero.
//
// It says so on the screen. A form whose effect is invisible gets filled in once and
// never again; a form that tells you it changes whether you are offered the next
// haemorrhage gets kept current. Saving also bumps `updated_at`, so the freshness factor
// rewards the facility that does keep it current.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { declareCapacity, type MyFacility } from "@/hooks/use-acute";

// "" is a real state and is not the same as 0: it means "leave this alone", which is what
// the RPC's coalesce does with null. Zero free beds is a declaration; blank is silence.
type Field = number | "";

function toField(v: number | null | undefined): Field {
  return v === null || v === undefined ? "" : v;
}

export function FacilityCapacity({
  facility,
  onSaved,
}: {
  facility: MyFacility;
  onSaved?: () => void;
}) {
  const f = facility.facility;
  const [beds, setBeds] = useState<Field>(toField(f?.beds_available));
  const [docs, setDocs] = useState<Field>(toField(f?.doctors_on_duty));
  const [units, setUnits] = useState<Field>(toField(f?.blood_units_available));
  const [bank, setBank] = useState<boolean | null>(f?.has_blood_bank ?? null);
  const [busy, setBusy] = useState(false);

  // Re-sync when the row changes underneath us — another member of the same facility may
  // have declared from their own screen, and a stale form would silently undo them.
  useEffect(() => {
    setBeds(toField(f?.beds_available));
    setDocs(toField(f?.doctors_on_duty));
    setUnits(toField(f?.blood_units_available));
    setBank(f?.has_blood_bank ?? null);
  }, [
    f?.beds_available,
    f?.doctors_on_duty,
    f?.blood_units_available,
    f?.has_blood_bank,
  ]);

  const declaredAt = f?.capacity_declared_at ? new Date(f.capacity_declared_at) : null;

  async function save() {
    setBusy(true);
    const res = await declareCapacity(facility.facility_id, {
      bedsAvailable: beds === "" ? null : beds,
      doctorsOnDuty: docs === "" ? null : docs,
      hasBloodBank: bank,
      bloodUnits: units === "" ? null : units,
    });
    setBusy(false);
    // The RPC returns its refusals rather than throwing, so they are rendered, not
    // swallowed: "more free beds than total beds" is a typo the person can fix.
    if (res.ok === false) toast.error(res.error ?? "Could not save.");
    else {
      toast.success("Capacity declared. Dispatch is using these numbers.");
      onSaved?.();
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Our capacity right now</CardTitle>
          {declaredAt ? (
            <Badge variant="secondary">
              declared {declaredAt.toLocaleString()}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              never declared — dispatch is using seed numbers
            </Badge>
          )}
        </div>
        <CardDescription>
          Dispatch reads these to rank us. Free beds and doctors on duty are weighed on
          every case; blood units only on cases that may transfuse.
          {f?.beds_total ? ` We are listed with ${f.beds_total} beds in total.` : ""}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Free beds</span>
            <Input
              type="number"
              min={0}
              max={f?.beds_total ?? undefined}
              inputMode="numeric"
              value={beds}
              placeholder="leave blank to keep"
              onChange={(e) => setBeds(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Doctors on duty</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={docs}
              placeholder="leave blank to keep"
              onChange={(e) => setDocs(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Blood units</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={units}
              placeholder="leave blank to keep"
              disabled={bank === false}
              onChange={(e) => setUnits(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
        </div>

        {/* Three states, not a checkbox. "Not stated" scores between yes and no, so a
            facility nobody has surveyed is not ranked as though it had said no. */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Blood bank</p>
          <div className="flex flex-wrap gap-2">
            {[
              { v: true as boolean | null, label: "Yes, we hold blood" },
              { v: false as boolean | null, label: "No blood bank" },
              { v: null as boolean | null, label: "Not stated" },
            ].map((o) => (
              <Button
                key={String(o.v)}
                type="button"
                size="sm"
                variant={bank === o.v ? "secondary" : "outline"}
                onClick={() => {
                  setBank(o.v);
                  if (o.v === false) setUnits("");
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            &quot;Not stated&quot; scores between yes and no — an unsurveyed facility is not
            treated as one that said no.
          </p>
        </div>

        <Button onClick={() => void save()} disabled={busy} className="w-full sm:w-auto">
          {busy ? "Saving…" : "Declare capacity"}
        </Button>
      </CardContent>
    </Card>
  );
}
