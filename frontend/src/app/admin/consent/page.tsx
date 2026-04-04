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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConsents, usePatients, createAuditLog } from "@/hooks/use-supabase";
import { toast } from "sonner";

const dpdpChecklist = [
  { item: "Consent collected before data processing", status: true },
  { item: "Purpose of data collection disclosed to patient", status: true },
  { item: "Data stored in India (Supabase Mumbai ap-south-1)", status: true },
  { item: "Audit log maintained for all consent events", status: true },
  { item: "Revocation mechanism available to patients", status: true },
  { item: "Data deletion request mechanism implemented", status: true },
  { item: "Data fiduciary registration (DPDP Board)", status: false },
  { item: "Grievance officer appointed", status: false },
];

function ConsentBadge({ status }: { status: string }) {
  if (status === "Granted") {
    return <Badge variant="outline" className="text-slate-800 border-slate-300 bg-slate-100 text-xs">Granted</Badge>;
  }
  if (status === "Pending") {
    return <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50 text-xs">Pending</Badge>;
  }
  return <Badge variant="outline" className="text-slate-900 border-slate-400 bg-slate-200 text-xs">{status}</Badge>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function deriveStatus(consent: { is_active: boolean; revoked_at: string | null }): string {
  if (consent.is_active) return "Granted";
  if (consent.revoked_at) return "Revoked";
  return "Pending";
}

export default function AdminConsentPage() {
  const { data: consents } = useConsents();
  const { data: patients } = usePatients();

  const consentSummary = {
    total: patients.length,
    granted: consents.filter((c) => c.is_active === true).length,
    pending: patients.filter((p) => (p as { consent_status?: string }).consent_status === "pending").length,
    revoked: consents.filter((c) => c.is_active === false && c.revoked_at !== null).length,
  };

  // Build joined consent records from real data
  const consentRecords = (() => {
    const patientMap = new Map(patients.map((p) => [p.id, p]));

    const fromConsents = consents.map((c) => {
      const patient = patientMap.get(c.patient_id);
      const status = deriveStatus(c);
      return {
        patient: patient?.name ?? "Unknown",
        abha: patient?.abha_id ?? "—",
        camp: patient?.health_camp ?? "—",
        purpose: c.purpose ?? "Health follow-up calls",
        status,
        grantedOn: status !== "Pending" ? formatDate(c.granted_at) : "—",
        expiresOn: "—",
        method: c.consent_mode ?? "—",
      };
    });

    const consentedPatientIds = new Set(consents.map((c) => c.patient_id));
    const unconsented = patients
      .filter((p) => !consentedPatientIds.has(p.id))
      .map((p) => ({
        patient: p.name ?? "Unknown",
        abha: p.abha_id ?? "—",
        camp: p.health_camp ?? "—",
        purpose: "Health follow-up calls",
        status: "Pending",
        grantedOn: "—",
        expiresOn: "—",
        method: "Pending",
      }));

    return [...fromConsents, ...unconsented];
  })();

  const grantedPct = consentSummary.total > 0 ? Math.round((consentSummary.granted / consentSummary.total) * 100) : 0;
  const pendingPct = consentSummary.total > 0 ? Math.round((consentSummary.pending / consentSummary.total) * 100) : 0;
  const revokedPct = consentSummary.total > 0 ? Math.round((consentSummary.revoked / consentSummary.total) * 100) : 0;
  const dpdpScore = Math.round((dpdpChecklist.filter((d) => d.status).length / dpdpChecklist.length) * 100);

  async function handleExportConsentReport() {
    const payload = {
      exported_at: new Date().toISOString(),
      summary: consentSummary,
      records: consentRecords,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `consent-report-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    await createAuditLog({
      user_role: "admin",
      action: "consent_report_exported",
      resource_type: "consent",
      details: { count: consentRecords.length },
    });
    toast.success("Consent report exported");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Consent Management</h1>
          <p className="text-sm text-slate-500">
            System-wide consent compliance dashboard — DPDP Act 2023
          </p>
        </div>
        <Button variant="outline" onClick={handleExportConsentReport}>Export Consent Report</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consent Granted</CardDescription>
            <CardTitle className="text-3xl text-slate-900">{grantedPct}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">{consentSummary.granted} of {consentSummary.total} patients</p>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div className="bg-slate-700 h-1.5 rounded-full" style={{ width: `${grantedPct}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consent Pending</CardDescription>
            <CardTitle className="text-3xl text-slate-600">{pendingPct}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">{consentSummary.pending} patients awaiting</p>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div className="bg-slate-400 h-1.5 rounded-full" style={{ width: `${pendingPct}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consent Revoked</CardDescription>
            <CardTitle className="text-3xl text-slate-500">{revokedPct}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">{consentSummary.revoked} patients revoked</p>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div className="bg-slate-900 h-1.5 rounded-full" style={{ width: `${revokedPct}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">DPDP Compliance</CardDescription>
            <CardTitle className="text-3xl text-slate-900">{dpdpScore}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              {dpdpChecklist.filter((d) => d.status).length} of {dpdpChecklist.length} items met
            </p>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
              <div className="bg-slate-600 h-1.5 rounded-full" style={{ width: `${dpdpScore}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DPDP Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">DPDP Act 2023 Compliance Checklist</CardTitle>
          <CardDescription>Digital Personal Data Protection Act compliance status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {dpdpChecklist.map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                  item.status ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-400"
                }`}
              >
                {item.status ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <span className={`text-sm flex-1 ${item.status ? "text-slate-700" : "text-slate-400"}`}>
                {item.item}
              </span>
              {!item.status && (
                <Badge variant="outline" className="text-xs text-slate-600 border-slate-300">
                  Action Required
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* All Consent Records Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">All Patient Consents</CardTitle>
              <CardDescription>Immutable consent records — all camps</CardDescription>
            </div>
            <Input placeholder="Search patient..." className="max-w-xs" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>ABHA ID</TableHead>
                <TableHead>Camp</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Granted On</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consentRecords.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{c.patient}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{c.abha}</TableCell>
                  <TableCell className="text-xs text-slate-600">{c.camp}</TableCell>
                  <TableCell className="text-xs text-slate-600">{c.purpose}</TableCell>
                  <TableCell>
                    <ConsentBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{c.grantedOn}</TableCell>
                  <TableCell className="text-xs text-slate-500">{c.expiresOn}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{c.method}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
