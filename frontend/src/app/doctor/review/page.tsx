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
  useFHIRResources,
  updateFHIRReviewStatus,
  createAuditLog,
  type FHIRResource,
} from "@/hooks/use-supabase";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth-context";
import { toast } from "sonner";

type ReviewStatus = "pending" | "approved" | "corrected" | "rejected";

const statusStyle: Record<ReviewStatus, string> = {
  pending: "bg-slate-50 text-slate-500 border-slate-200",
  approved: "bg-slate-100 text-slate-800 border-slate-300",
  corrected: "bg-slate-50 text-slate-700 border-slate-300",
  rejected: "bg-slate-200 text-slate-900 border-slate-400",
};

const statusLabel: Record<ReviewStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  corrected: "Corrected",
  rejected: "Rejected",
};

function toReviewStatus(status: string): ReviewStatus {
  if (status === "approved") return "approved";
  if (status === "corrected") return "corrected";
  if (status === "rejected") return "rejected";
  return "pending";
}

function parseExtracted(resource: FHIRResource) {
  const entries: { label: string; code: string; conf: number }[] = [];
  for (const c of resource.snomed_codes || []) {
    entries.push({ label: "SNOMED Entity", code: `SNOMED: ${c}`, conf: 0.9 });
  }
  for (const c of resource.loinc_codes || []) {
    entries.push({ label: "LOINC Entity", code: `LOINC: ${c}`, conf: 0.92 });
  }
  return entries;
}

export default function DoctorReviewPage() {
  const { role, userName } = useAuth();
  const { data: fhirResources, loading, refetch } = useFHIRResources();
  const [expandedCorrection, setExpandedCorrection] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, ReviewStatus>>({});
  const [correctionText, setCorrectionText] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const reviewItems = fhirResources.map((resource) => {
    const extracted = parseExtracted(resource);
    return {
      id: resource.id,
      patient: resource.patient_id.slice(0, 8).toUpperCase(),
      abha: "Linked via patient record",
      date: new Date(resource.created_at).toLocaleDateString("en-IN"),
      callId: resource.call_id ? resource.call_id.slice(0, 8).toUpperCase() : "NO-CALL",
      transcript: JSON.stringify(resource.fhir_json).slice(0, 260),
      extracted,
      severity: resource.resource_type === "Condition" ? "HIGH" : "MODERATE",
      status: toReviewStatus(resource.review_status),
      resource,
    };
  });

  function getStatus(id: string, initial: ReviewStatus): ReviewStatus {
    return localStatuses[id] ?? initial;
  }

  async function setStatus(id: string, status: ReviewStatus, details?: Record<string, unknown>) {
    const current = reviewItems.find((x) => x.id === id);
    if (!current || savingId) return;

    setSavingId(id);
    setLocalStatuses((p) => ({ ...p, [id]: status }));
    setExpandedCorrection(null);

    await updateFHIRReviewStatus(id, status, userName || "doctor");
    await createAuditLog({
      user_role: role || "doctor",
      action: `fhir_${status}`,
      resource_type: "fhir_resource",
      resource_id: current.resource.id,
      details: {
        reviewed_by: userName,
        ...details,
      },
    });

    await refetch();
    toast.success(`Resource ${status}`);
    setSavingId(null);
  }

  const pending = reviewItems.filter((t) => getStatus(t.id, t.status) === "pending").length;
  const approved = reviewItems.filter((t) => getStatus(t.id, t.status) === "approved").length;
  const corrected = reviewItems.filter((t) => getStatus(t.id, t.status) === "corrected").length;
  const rejected = reviewItems.filter((t) => getStatus(t.id, t.status) === "rejected").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Voice AI Data Verification</h1>
        <p className="text-sm text-slate-500">
          After Voice AI calls patients, it extracts health data from the conversation. Review and verify before it becomes part of the patient&apos;s health record.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-1"><CardDescription className="text-xs">Pending Review</CardDescription><CardTitle className="text-3xl text-slate-500">{pending}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-1"><CardDescription className="text-xs">Approved</CardDescription><CardTitle className="text-3xl text-slate-900">{approved}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-1"><CardDescription className="text-xs">Corrected</CardDescription><CardTitle className="text-3xl text-slate-600">{corrected}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-1"><CardDescription className="text-xs">Rejected</CardDescription><CardTitle className="text-3xl text-slate-900">{rejected}</CardTitle></CardHeader></Card>
      </div>

      {loading && <Card><CardContent className="py-6 text-sm text-slate-500">Loading review queue...</CardContent></Card>}
      {!loading && reviewItems.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-slate-500">
            No FHIR resources available yet.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {reviewItems.map((t) => {
          const currentStatus = getStatus(t.id, t.status);
          return (
            <Card key={t.id} className={currentStatus === "pending" ? "border-slate-300" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Patient {t.patient}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">{t.callId} · {t.date} · ABHA: {t.abha}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline" className={t.severity === "CRITICAL" ? "text-slate-900 border-slate-400 bg-slate-200" : t.severity === "HIGH" ? "text-slate-800 border-slate-300 bg-slate-100" : "text-slate-600 border-slate-200 bg-slate-50"}>{t.severity}</Badge>
                    <Badge variant="outline" className={`text-xs ${statusStyle[currentStatus]}`}>{statusLabel[currentStatus]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">AI-Extracted Health Data</p>
                  <p className="text-sm text-slate-600 italic bg-slate-50 p-3 rounded-lg border">&quot;{t.transcript}&quot;</p>
                </div>

                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Mapped Medical Codes (SNOMED/LOINC)</p>
                  <div className="flex flex-wrap gap-2">
                    {t.extracted.length === 0 && <span className="text-xs text-slate-400">No mapped codes</span>}
                    {t.extracted.map((e, i) => (
                      <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${e.conf >= 0.9 ? "bg-slate-100 border-slate-300 text-slate-800" : e.conf >= 0.75 ? "bg-slate-50 border-slate-200 text-slate-700" : "bg-slate-50 border-slate-200 text-slate-600"}`}>
                        <span className="font-medium">{e.label}</span>
                        <span className="opacity-60">({e.code})</span>
                      </div>
                    ))}
                  </div>
                </div>

                {currentStatus === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={savingId === t.id} onClick={() => setStatus(t.id, "approved")}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={savingId === t.id} onClick={() => setExpandedCorrection(expandedCorrection === t.id ? null : t.id)}>Correct</Button>
                    <Button size="sm" variant="ghost" className="text-slate-500" disabled={savingId === t.id} onClick={() => setStatus(t.id, "rejected")}>Reject</Button>
                  </div>
                )}

                {expandedCorrection === t.id && currentStatus === "pending" && (
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                    <p className="text-xs font-medium text-slate-800">Add correction notes (saved to audit log):</p>
                    <Textarea className="border-slate-200 bg-white focus:ring-1 focus:ring-slate-400" rows={3} value={correctionText[t.id] ?? ""} onChange={(e) => setCorrectionText((p) => ({ ...p, [t.id]: e.target.value }))} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={savingId === t.id} onClick={() => setStatus(t.id, "corrected", { correction: correctionText[t.id] || "" })}>Submit Correction</Button>
                      <Button size="sm" variant="ghost" onClick={() => setExpandedCorrection(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
