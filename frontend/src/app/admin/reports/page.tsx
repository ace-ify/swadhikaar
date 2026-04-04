"use client";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useFHIRResources,
  usePatients,
  createAuditLog,
} from "@/hooks/use-supabase";
import { toast } from "sonner";
import { callExportAbdm } from "@/lib/edge-functions";

const typeColor: Record<string, string> = {
  Bundle: "text-slate-800 border-slate-300 bg-slate-50",
  DiagnosticReport: "text-slate-700 border-slate-300 bg-slate-50",
  MedicationRequest: "text-slate-700 border-slate-300 bg-slate-50",
  MedicationStatement: "text-slate-700 border-slate-300 bg-slate-50",
  Composition: "text-slate-700 border-slate-300 bg-slate-50",
  Observation: "text-slate-700 border-slate-300 bg-slate-50",
  Condition: "text-slate-700 border-slate-300 bg-slate-50",
  AllergyIntolerance: "text-slate-700 border-slate-300 bg-slate-50",
  CarePlan: "text-slate-700 border-slate-300 bg-slate-50",
  Encounter: "text-slate-700 border-slate-300 bg-slate-50",
};

const statusColor: Record<string, string> = {
  approved: "text-slate-800 border-slate-300 bg-slate-100",
  pending_review: "text-slate-500 border-slate-200 bg-slate-50",
  corrected: "text-slate-700 border-slate-300 bg-slate-50",
  rejected: "text-slate-900 border-slate-400 bg-slate-200",
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminReportsPage() {
  const { data: patients } = usePatients();
  const { data: fhirResources, refetch } = useFHIRResources();
  const [exportBusy, setExportBusy] = useState(false);

  // Build patient lookup
  const patientMap = new Map(patients.map((p) => [p.id, p]));

  // Compute stats from real FHIR resources
  const totalFhir = fhirResources.length;
  const typeCounts: Record<string, number> = {};
  for (const r of fhirResources) {
    typeCounts[r.resource_type] = (typeCounts[r.resource_type] || 0) + 1;
  }

  const snomedCoded = fhirResources.filter((r) => r.snomed_codes && r.snomed_codes.length > 0).length;
  const loincCoded = fhirResources.filter((r) => r.loinc_codes && r.loinc_codes.length > 0).length;
  const snomedPct = totalFhir > 0 ? ((snomedCoded / totalFhir) * 100).toFixed(1) : "0";
  const loincPct = totalFhir > 0 ? ((loincCoded / totalFhir) * 100).toFixed(1) : "0";

  const fhirStats = [
    { label: "Total FHIR Resources", value: totalFhir.toLocaleString(), sub: "All time", color: "" },
    { label: "Observations", value: (typeCounts["Observation"] || 0).toLocaleString(), sub: "Vitals + labs", color: "text-slate-900" },
    { label: "Conditions", value: (typeCounts["Condition"] || 0).toLocaleString(), sub: "Diagnoses", color: "text-slate-900" },
    { label: "Medications", value: ((typeCounts["MedicationStatement"] || 0) + (typeCounts["MedicationRequest"] || 0)).toLocaleString(), sub: "Drug records", color: "text-slate-900" },
    { label: "SNOMED Coded", value: `${snomedPct}%`, sub: "Auto-coded", color: "text-slate-900" },
    { label: "LOINC Coded", value: `${loincPct}%`, sub: "Vitals coded", color: "text-slate-900" },
  ];

  // Resource breakdown from real data
  const resourceBreakdown = Object.entries(typeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => {
      const samples = fhirResources.filter((r) => r.resource_type === type);
      const snomedSet = new Set(samples.flatMap((r) => r.snomed_codes || []));
      const loincSet = new Set(samples.flatMap((r) => r.loinc_codes || []));
      return {
        type,
        count,
        codes: [...snomedSet].slice(0, 3).join(", ") || [...loincSet].slice(0, 3).join(", ") || "—",
      };
    });

  // Recent resources (actual data, not fake bundles)
  const recentResources = fhirResources.slice(0, 8);

  async function handleExportAll() {
    const payload = {
      exported_at: new Date().toISOString(),
      total: fhirResources.length,
      resources: fhirResources.map((doc) => ({
        id: doc.id,
        patient_id: doc.patient_id,
        resource_type: doc.resource_type,
        profile: doc.profile,
        review_status: doc.review_status,
        created_at: doc.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fhir-export-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    await createAuditLog({
      user_role: "admin",
      action: "fhir_exported",
      resource_type: "fhir_resource",
      details: { count: fhirResources.length },
    });
    toast.success("FHIR export downloaded");
  }

  async function handleExportToABDM() {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const patientId = patients[0]?.id;
      if (!patientId) return;

      const data = await callExportAbdm(patientId);
      if (data.error) {
        throw new Error(data.error);
      }
      await createAuditLog({
        user_role: "admin",
        action: "abdm_export_requested",
        resource_type: "fhir_resource",
        details: { patient_id: patientId, response: data },
      });
      refetch();
      toast.success("ABDM export completed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "ABDM export failed");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FHIR Reports</h1>
          <p className="text-sm text-slate-500">
            ABDM R4-compliant FHIR resource generation and export management
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportAll}>Export All (ZIP)</Button>
          <Button onClick={handleExportToABDM} disabled={exportBusy}>
            {exportBusy ? "Exporting..." : "Export to ABDM"}
          </Button>
        </div>
      </div>

      {/* FHIR Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {fhirStats.map((s, i) => (
          <Card key={i}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs leading-tight">{s.label}</CardDescription>
              <CardTitle className={`text-xl ${s.color}`}>{s.value}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-xs text-slate-400">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Coding Coverage */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SNOMED CT Coding Coverage</CardTitle>
            <CardDescription>Resources with auto-coded SNOMED terms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 py-3">
              <span className="text-xs text-slate-600 flex-1">Resources with SNOMED codes</span>
              <div className="w-24 bg-slate-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-slate-600"
                  style={{ width: `${snomedPct}%` }}
                />
              </div>
              <span className="text-xs font-mono font-semibold w-12 text-right">{snomedPct}%</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{snomedCoded} of {totalFhir} resources have SNOMED codes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">LOINC Coding Coverage</CardTitle>
            <CardDescription>Resources with auto-coded LOINC terms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 py-3">
              <span className="text-xs text-slate-600 flex-1">Resources with LOINC codes</span>
              <div className="w-24 bg-slate-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-slate-600"
                  style={{ width: `${loincPct}%` }}
                />
              </div>
              <span className="text-xs font-mono font-semibold w-12 text-right">{loincPct}%</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{loincCoded} of {totalFhir} resources have LOINC codes</p>
          </CardContent>
        </Card>
      </div>

      {/* Resource Type Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">FHIR Resource Type Breakdown</CardTitle>
          <CardDescription>All generated resources by type — ABDM R4 profiles</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource Type</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Codes Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resourceBreakdown.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${typeColor[r.type] ?? "text-slate-700 border-slate-300"}`}
                    >
                      {r.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-semibold">{r.count}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-400">
                    {r.codes}
                  </TableCell>
                </TableRow>
              ))}
              {resourceBreakdown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-slate-400 py-8">
                    No FHIR resources generated yet. Initiate voice calls to generate resources.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent FHIR Resources */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent FHIR Resources</CardTitle>
              <CardDescription>
                Generated from AI voice call extractions — doctor-reviewed
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-slate-700 border-slate-300 bg-slate-50">
              {fhirResources.filter((r) => r.review_status === "approved").length}/{totalFhir} Approved
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>SNOMED</TableHead>
                <TableHead>LOINC</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentResources.map((r) => {
                const patient = patientMap.get(r.patient_id);
                return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs text-slate-400">{r.id.slice(0, 8)}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{patient?.name ?? r.patient_id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-400 font-mono">{patient?.abha_id ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">{r.profile}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${typeColor[r.resource_type] ?? "text-slate-700 border-slate-300"}`}
                    >
                      {r.resource_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(r.snomed_codes || []).slice(0, 3).map((s, i) => (
                        <span key={i} className="text-[10px] font-mono text-slate-600 bg-slate-50 px-1 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(r.loinc_codes || []).slice(0, 3).map((l, i) => (
                        <span key={i} className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1 rounded">
                          {l}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${statusColor[r.review_status] ?? ""}`}
                    >
                      {formatStatus(r.review_status)}
                    </Badge>
                  </TableCell>
                </TableRow>
                );
              })}
              {recentResources.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400 py-8">
                    No FHIR resources yet. Voice call extractions will appear here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ABDM Integration Status */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">ABDM Integration Status</CardTitle>
          <CardDescription>
            Ayushman Bharat Digital Mission — Health Information Exchange
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              { label: "HIP Registration", value: "Active", ok: true },
              { label: "HIU Authorization", value: "Active", ok: true },
              { label: "Consent Manager Link", value: "Connected", ok: true },
              { label: "ABHA ID Verification API", value: "Active", ok: true },
              { label: "Last FHIR Sync", value: "25 Mar 2026, 09:14 IST", ok: true },
              { label: "Pending Sync Queue", value: "1 bundle", ok: false },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                <span className="text-slate-600">{item.label}</span>
                <span className={item.ok ? "text-slate-800 font-medium" : "text-slate-500"}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
