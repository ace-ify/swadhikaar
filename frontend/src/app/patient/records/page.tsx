"use client";

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
import { usePatients, useVitals, useRiskAssessments, useFHIRResources } from "@/hooks/use-supabase";
import { toast } from "sonner";

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function RiskBar({ score }: { score: number }) {
  const color =
    score >= 50 ? "bg-slate-800" : score >= 35 ? "bg-slate-500" : "bg-slate-300";
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
      <div className={`${color} h-2 rounded-full`} style={{ width: `${score}%` }} />
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fhirTypeBadgeClass(type: string) {
  if (type === "Bundle") return "text-slate-700 border-slate-300";
  if (type === "Condition") return "text-slate-900 border-slate-400";
  if (type === "MedicationStatement") return "text-slate-700 border-slate-300";
  return "text-slate-600 border-slate-200";
}

function LoadingSkeleton({ rows = 3, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-slate-100 rounded animate-pulse flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function PatientRecordsPage() {
  const { data: allPatients } = usePatients();
  const primaryPatient = allPatients[0];
  const primaryPatientId =
    primaryPatient?.id || "00000000-0000-0000-0000-000000000001";

  const { data: vitalsData, loading: vitalsLoading } = useVitals(primaryPatientId);
  const { data: riskData, loading: riskLoading } = useRiskAssessments(primaryPatientId);
  const { data: fhirData, loading: fhirLoading } = useFHIRResources(primaryPatientId);

  // Use real Supabase data — no fallbacks
  const lastUpdated = vitalsData.length > 0 ? formatDate(vitalsData[0].recorded_at) : "—";

  // Build risk cards from Supabase data
  const riskCards = riskData.length > 0
    ? [
        {
          type: "Cardiovascular Risk",
          score: Math.round(riskData[0].heart_risk_score),
          level: riskData[0].heart_risk_level,
          color:
            riskData[0].heart_risk_score >= 50
              ? "text-slate-900"
              : riskData[0].heart_risk_score >= 35
              ? "text-slate-600"
              : "text-slate-400",
          bg:
            riskData[0].heart_risk_score >= 50
              ? "bg-slate-100 border-slate-300"
              : riskData[0].heart_risk_score >= 35
              ? "bg-slate-50 border-slate-200"
              : "bg-white border-slate-200",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}. Overall score: ${riskData[0].overall_risk_score.toFixed(1)}.`,
        },
        {
          type: "Diabetic Risk",
          score: Math.round(riskData[0].diabetic_risk_score),
          level: riskData[0].diabetic_risk_level,
          color:
            riskData[0].diabetic_risk_score >= 50
              ? "text-slate-900"
              : riskData[0].diabetic_risk_score >= 35
              ? "text-slate-600"
              : "text-slate-400",
          bg:
            riskData[0].diabetic_risk_score >= 50
              ? "bg-slate-100 border-slate-300"
              : riskData[0].diabetic_risk_score >= 35
              ? "bg-slate-50 border-slate-200"
              : "bg-white border-slate-200",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}.`,
        },
        {
          type: "Hypertension Risk",
          score: Math.round(riskData[0].hypertension_risk_score),
          level: riskData[0].hypertension_risk_level,
          color:
            riskData[0].hypertension_risk_score >= 50
              ? "text-slate-900"
              : riskData[0].hypertension_risk_score >= 35
              ? "text-slate-600"
              : "text-slate-400",
          bg:
            riskData[0].hypertension_risk_score >= 50
              ? "bg-slate-100 border-slate-300"
              : riskData[0].hypertension_risk_score >= 35
              ? "bg-slate-50 border-slate-200"
              : "bg-white border-slate-200",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}.`,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Health Records</h1>
        <p className="text-sm text-slate-500">
          ABHA ID: {primaryPatient?.abha_id ?? "91-1234-5678-9012"} · Last updated: {lastUpdated}
        </p>
      </div>

      {/* Risk Assessment Cards */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
          Risk Assessment
        </h2>
        {riskLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="h-3 w-28 bg-slate-200 rounded animate-pulse" />
                  <div className="h-8 w-16 bg-slate-200 rounded animate-pulse mt-1" />
                  <div className="h-2 w-full bg-slate-100 rounded-full animate-pulse mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-3 w-full bg-slate-100 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {riskCards.map((risk) => (
              <Card key={risk.type} className={`border ${risk.bg}`}>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">{risk.type}</CardDescription>
                  <div className="flex items-end justify-between">
                    <CardTitle className={`text-2xl ${risk.color}`}>{risk.score}</CardTitle>
                    <Badge
                      variant="outline"
                      className={`${risk.color} border-current text-xs`}
                    >
                      {risk.level}
                    </Badge>
                  </div>
                  <RiskBar score={risk.score} />
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-600">{risk.details}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Vitals History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vitals History</CardTitle>
          <CardDescription>Readings collected at health camps and follow-up calls</CardDescription>
        </CardHeader>
        <CardContent>
          {vitalsLoading ? (
            <LoadingSkeleton rows={5} cols={7} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Blood Pressure</TableHead>
                  <TableHead>Glucose (mg/dL)</TableHead>
                  <TableHead>BMI</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>SpO2</TableHead>
                  <TableHead>BP Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vitalsData.length > 0
                  ? vitalsData.map((row, i) => {
                      const sys = row.systolic_bp;
                      const bpStatus =
                        sys >= 160 ? "Stage 2" : sys >= 140 ? "Stage 1" : "Pre-HT";
                      const bpVariant =
                        sys >= 160 ? "destructive" : sys >= 140 ? "secondary" : "outline";
                      return (
                        <TableRow key={row.id} className={i === 0 ? "bg-slate-50" : ""}>
                          <TableCell className="font-medium text-sm">
                            {formatDate(row.recorded_at)}
                            {i === 0 && (
                              <Badge className="ml-2 text-[10px] bg-slate-900">Latest</Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.systolic_bp}/{row.diastolic_bp}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.blood_glucose}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.bmi.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-sm">{row.weight} kg</TableCell>
                          <TableCell className="text-sm">
                            {row.oxygen_saturation}%
                          </TableCell>
                          <TableCell>
                            <Badge variant={bpVariant}>{bpStatus}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-400 py-8">
                        No vitals recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* FHIR Documents */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">FHIR Documents</CardTitle>
              <CardDescription>
                Your health records in ABDM-compliant FHIR R4 format
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                downloadJsonFile(
                  `fhir-documents-${primaryPatientId}.json`,
                  fhirData.map((doc) => ({
                    id: doc.id,
                    resource_type: doc.resource_type,
                    profile: doc.profile,
                    created_at: doc.created_at,
                    fhir_json: doc.fhir_json,
                  }))
                );
                toast.success("FHIR export downloaded");
              }}
            >
              Export All (ZIP)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {fhirLoading ? (
            <LoadingSkeleton rows={5} cols={6} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fhirData.length > 0
                  ? fhirData.map((doc) => {
                      const codes = [
                        ...doc.loinc_codes.map((c) => `LOINC: ${c}`),
                        ...doc.snomed_codes.map((c) => `SNOMED: ${c}`),
                      ].join(", ") || doc.profile;
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {doc.id.slice(0, 8).toUpperCase()}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={fhirTypeBadgeClass(doc.resource_type)}
                            >
                              {doc.resource_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {doc.resource_type} — {formatDate(doc.created_at)}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-slate-400">
                            {codes.slice(0, 30)}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {JSON.stringify(doc.fhir_json).length} B
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-slate-600 text-xs px-2"
                              onClick={() =>
                                downloadJsonFile(
                                  `fhir-${doc.id}.json`,
                                  doc.fhir_json
                                )
                              }
                            >
                              Download
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                        No FHIR documents available yet.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
