"use client";

import { journeyWords } from "@/lib/labels";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// The seam demo. Closing an emergency here creates the longitudinal patient,
// writes the FHIR Encounter + Condition, and schedules Day 1/3/7/14/30 recovery
// calls — the one action that crosses the hospital door.

type ScheduledCall = {
  id: string;
  scheduled_for: string;
  extracted_data?: { protocol_day?: number };
};

type SeamResult = {
  ok?: boolean;
  error?: string;
  details?: string[];
  incident_id?: string;
  patient?: {
    id: string;
    name: string;
    abha_id: string | null;
    journey_status: string;
    intake_source: string;
    resolved_by: string;
  };
  fhir_resources?: { id: string; resource_type: string }[];
  enrolment?: string;
  scheduled_calls?: ScheduledCall[];
};

const FIELDS = [
  { key: "name", label: "Patient name", placeholder: "Asha Devi", required: true },
  { key: "phone", label: "Phone", placeholder: "+919756260291" },
  { key: "abha_id", label: "ABHA ID", placeholder: "91-2341-8762-0011" },
  { key: "language", label: "Language", placeholder: "hindi" },
  { key: "incident_type", label: "Incident type", placeholder: "Road traffic accident" },
  {
    key: "hospital_name",
    label: "Receiving facility",
    placeholder: "Goel SuperSpeciality Hospital",
  },
  { key: "diagnosis_code", label: "SNOMED code", placeholder: "22298006" },
  { key: "diagnosis_display", label: "Diagnosis", placeholder: "Myocardial infarction" },
] as const;

const SEVERITIES = ["CRITICAL", "HIGH", "MODERATE", "LOW"] as const;

export default function SeamTriggerPage() {
  const [form, setForm] = useState<Record<string, string>>({
    name: "Asha Devi",
    phone: "+919756260291",
    abha_id: "91-2341-8762-0011",
    language: "hindi",
    incident_type: "Road traffic accident",
    hospital_name: "Goel SuperSpeciality Hospital",
    diagnosis_code: "22298006",
    diagnosis_display: "Myocardial infarction",
    outcome_summary: "Stabilised in ED, discharged same day",
  });
  const [severity, setSeverity] = useState<string>("CRITICAL");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeamResult | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/seam-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, severity }),
      });
      const data = (await res.json()) as SeamResult;
      setResult(data);
      if (res.ok && data.ok) {
        toast.success(
          `${data.patient?.name} enrolled — ${data.scheduled_calls?.length ?? 0} calls scheduled`,
        );
      } else {
        toast.error(data.error ?? `Request failed (${res.status})`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Request failed";
      toast.error(message);
      setResult({ error: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Acute → Continuity Seam</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Close an emergency incident. The patient record, FHIR resources and the
          recovery call protocol are created in one step.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incident at care complete</CardTitle>
            <CardDescription>
              One of phone or ABHA ID is required — most emergency arrivals carry no
              ABHA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor={f.key} className="text-sm font-medium">
                    {f.label}
                    {"required" in f && f.required ? (
                      <span className="text-destructive"> *</span>
                    ) : null}
                  </label>
                  <Input
                    id={f.key}
                    value={form[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Severity</span>
              <div className="flex flex-wrap gap-2">
                {SEVERITIES.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={severity === s ? "default" : "outline"}
                    onClick={() => setSeverity(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="outcome_summary" className="text-sm font-medium">
                Outcome summary
              </label>
              <Input
                id="outcome_summary"
                value={form.outcome_summary ?? ""}
                onChange={(e) => set("outcome_summary", e.target.value)}
              />
            </div>

            <Button onClick={submit} disabled={busy} className="w-full">
              {busy ? "Closing incident…" : "Close incident & enrol patient"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>
              Sending the same incident twice will not create a second patient.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-muted-foreground text-sm">Nothing submitted yet.</p>
            ) : result.error ? (
              <div className="space-y-2">
                <Badge variant="destructive">Failed</Badge>
                <p className="text-sm">{result.error}</p>
                {result.details?.length ? (
                  <ul className="text-muted-foreground list-disc pl-5 text-sm">
                    {result.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Enrolled</Badge>
                  <span className="text-muted-foreground font-mono text-xs">
                    {result.incident_id}
                  </span>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Patient</dt>
                  <dd>{result.patient?.name}</dd>
                  <dt className="text-muted-foreground">Resolved by</dt>
                  <dd>{result.patient?.resolved_by}</dd>
                  <dt className="text-muted-foreground">Journey</dt>
                  <dd>{journeyWords(result.patient?.journey_status)}</dd>
                  <dt className="text-muted-foreground">Intake</dt>
                  <dd>{result.patient?.intake_source}</dd>
                </dl>

                <div>
                  <p className="font-medium">
                    FHIR resources ({result.fhir_resources?.length ?? 0})
                  </p>
                  {result.fhir_resources?.length ? (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {result.fhir_resources.map((r) => (
                        <Badge key={r.id} variant="secondary">
                          {r.resource_type}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      none written — already existed for this incident
                    </p>
                  )}
                </div>

                <div>
                  <p className="font-medium">
                    Recovery calls ({result.scheduled_calls?.length ?? 0})
                  </p>
                  {result.scheduled_calls?.length ? (
                    <ul className="mt-1 space-y-1">
                      {result.scheduled_calls.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <Badge variant="outline">
                            Day {c.extracted_data?.protocol_day ?? "?"}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(c.scheduled_for).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      none added — protocol already scheduled for this patient
                    </p>
                  )}
                </div>

                <p className="text-muted-foreground">{result.enrolment}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
