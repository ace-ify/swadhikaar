"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase";
import { toast } from "sonner";

// Layer 4 — the health/agriculture bridge.
//
// Reads district_occupational_health, a view over data already collected. The view
// is security_invoker, so an ASHA opening this page sees only their village while
// an admin sees the district.

type Cluster = {
  district: string;
  village: string | null;
  occupation: string | null;
  crop_type: string | null;
  patients: number;
  pesticide_exposed_30d: number;
  high_risk: number;
  breathlessness: number;
  chest_discomfort: number;
  dizziness: number;
  fatigue: number;
};

type AdvisoryResult = {
  ok?: boolean;
  error?: string;
  district?: string;
  triggered?: boolean;
  dry_run?: boolean;
  weather?: { source: string; max_temp_c: number; note?: string };
  threshold_celsius?: number;
  cohort_size?: number;
  calls_queued?: number;
  scheduled_for?: string;
  sample?: { name: string; occupation: string; language: string }[];
  message?: string;
};

const OUTDOOR = new Set(["farmer", "field_labour", "construction", "daily_wage"]);

export default function CrossDomainPage() {
  const supabase = useMemo(() => createClient(), []);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [district, setDistrict] = useState("Muzaffarpur");
  const [busy, setBusy] = useState<"dry" | "live" | null>(null);
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("district_occupational_health")
      .select("*")
      .order("patients", { ascending: false });
    if (error) {
      toast.error(`Could not load clusters: ${error.message}`);
      setClusters([]);
    } else {
      setClusters((data ?? []) as Cluster[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const outdoor = clusters.filter((c) => c.occupation && OUTDOOR.has(c.occupation));
    return {
      patients: clusters.reduce((n, c) => n + c.patients, 0),
      outdoorWorkers: outdoor.reduce((n, c) => n + c.patients, 0),
      exposed: clusters.reduce((n, c) => n + c.pesticide_exposed_30d, 0),
      respiratory: clusters.reduce((n, c) => n + c.breathlessness, 0),
      heatSigns: clusters.reduce((n, c) => n + c.dizziness + c.fatigue, 0),
    };
  }, [clusters]);

  async function runAdvisory(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "live");
    setAdvisory(null);
    try {
      const { data, error } = await supabase.functions.invoke("heat-advisory", {
        body: { district: district.trim(), dry_run: dryRun, force: true },
      });
      if (error) throw new Error(error.message);
      const res = data as AdvisoryResult;
      setAdvisory(res);
      if (res.triggered && !dryRun) {
        toast.success(`${res.calls_queued ?? 0} advisory calls queued`);
        void load();
      } else if (res.triggered) {
        toast.success(`Dry run — ${res.cohort_size ?? 0} patients would be called`);
      } else {
        toast.info(res.message ?? "Below threshold");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Advisory failed";
      toast.error(message);
      setAdvisory({ error: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Occupational Health — Health × Agriculture
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The health system does not usually know that its chronic respiratory
          patients are the same people spraying pesticides without masks.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Patients in scope", value: totals.patients },
          { label: "Outdoor workers", value: totals.outdoorWorkers },
          { label: "Pesticide exposure (30d)", value: totals.exposed },
          { label: "Respiratory symptoms", value: totals.respiratory },
          { label: "Heat-stress signs", value: totals.heatSigns },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-semibold">{s.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Heat advisory</CardTitle>
          <CardDescription>
            Weather threshold → outdoor-worker cohort → advisory call in each
            patient&apos;s own language. Calls are queued into the existing
            recovery-call executor; no separate dispatcher.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="district" className="text-sm font-medium">
                District
              </label>
              <Input
                id="district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-56"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => runAdvisory(true)}
              disabled={busy !== null || !district.trim()}
            >
              {busy === "dry" ? "Checking…" : "Dry run"}
            </Button>
            <Button
              onClick={() => runAdvisory(false)}
              disabled={busy !== null || !district.trim()}
            >
              {busy === "live" ? "Queuing…" : "Issue advisory"}
            </Button>
          </div>

          {advisory ? (
            advisory.error ? (
              <div className="space-y-1">
                <Badge variant="destructive">Failed</Badge>
                <p className="text-sm">{advisory.error}</p>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={advisory.triggered ? "default" : "secondary"}>
                    {advisory.triggered ? "Triggered" : "Below threshold"}
                  </Badge>
                  {advisory.dry_run ? <Badge variant="outline">Dry run</Badge> : null}
                  {advisory.weather ? (
                    <Badge
                      variant={
                        advisory.weather.source === "openweather"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {advisory.weather.max_temp_c}°C ·{" "}
                      {advisory.weather.source === "openweather"
                        ? "OpenWeather"
                        : "simulated reading"}
                    </Badge>
                  ) : null}
                </div>

                {advisory.weather?.note ? (
                  <p className="text-muted-foreground">{advisory.weather.note}</p>
                ) : null}

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Cohort</dt>
                  <dd>{advisory.cohort_size ?? 0} patients</dd>
                  {advisory.calls_queued !== undefined ? (
                    <>
                      <dt className="text-muted-foreground">Calls queued</dt>
                      <dd>{advisory.calls_queued}</dd>
                    </>
                  ) : null}
                  {advisory.scheduled_for ? (
                    <>
                      <dt className="text-muted-foreground">Scheduled for</dt>
                      <dd>{new Date(advisory.scheduled_for).toLocaleString()}</dd>
                    </>
                  ) : null}
                </dl>

                {advisory.sample?.length ? (
                  <div>
                    <p className="font-medium">Sample of who would be called</p>
                    <ul className="text-muted-foreground mt-1 space-y-0.5">
                      {advisory.sample.map((p) => (
                        <li key={`${p.name}-${p.occupation}`}>
                          {p.name} · {p.occupation.replace(/_/g, " ")} · {p.language}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Exposure-linked symptom clusters by geography
          </CardTitle>
          <CardDescription>
            A view over data already collected. Shared with the District Health
            Officer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : clusters.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No clusters visible. Patients need a district and an occupation
              recorded — and row-level security limits this view to your own scope.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>District</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead>Occupation</TableHead>
                  <TableHead>Crop</TableHead>
                  <TableHead className="text-right">Patients</TableHead>
                  <TableHead className="text-right">Pesticide 30d</TableHead>
                  <TableHead className="text-right">High risk</TableHead>
                  <TableHead className="text-right">Breathless</TableHead>
                  <TableHead className="text-right">Chest</TableHead>
                  <TableHead className="text-right">Dizziness</TableHead>
                  <TableHead className="text-right">Fatigue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.map((c, i) => (
                  <TableRow
                    key={`${c.district}-${c.village}-${c.occupation}-${c.crop_type}-${i}`}
                  >
                    <TableCell>{c.district}</TableCell>
                    <TableCell>{c.village ?? "—"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {c.occupation?.replace(/_/g, " ") ?? "—"}
                        {c.occupation && OUTDOOR.has(c.occupation) ? (
                          <Badge variant="outline" className="text-[10px]">
                            outdoor
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>{c.crop_type ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {c.patients}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.pesticide_exposed_30d}
                    </TableCell>
                    <TableCell className="text-right">{c.high_risk}</TableCell>
                    <TableCell className="text-right">{c.breathlessness}</TableCell>
                    <TableCell className="text-right">{c.chest_discomfort}</TableCell>
                    <TableCell className="text-right">{c.dizziness}</TableCell>
                    <TableCell className="text-right">{c.fatigue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
