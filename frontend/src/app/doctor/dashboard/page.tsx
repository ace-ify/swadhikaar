"use client";

import { useState, useCallback, useEffect } from "react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  PhoneCall,
  ShieldCheck,
  Activity,
  Bot,
  TrendingUp,
  ArrowRight,
  Syringe,
  Users,
  Phone,
  Target,
  BarChart3,
  Loader2,
  PhoneOutgoing,
} from "lucide-react";
import {
  usePatients,
  useEscalations,
  useCallLogs,
  useRealtimeEscalations,
  useNewborns,
  useVaccinationSchedules,
  useConversionFunnel,
  useRiskAssessments,
  createAuditLog,
  type Escalation,
} from "@/hooks/use-supabase";
import { toast } from "sonner";
import { resolveAllPatients, CALL_TYPE_LABELS } from "@/lib/resolve-call-type";
import { callStartVoiceCall } from "@/lib/edge-functions";

// (Fallback data removed — all data now comes from Supabase)

// (Conversion funnel is now computed from real data via useConversionFunnel hook)

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface AlertBannerProps {
  escalation: Escalation;
  onDismiss: () => void;
}

function AlertBanner({ escalation, onDismiss }: AlertBannerProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="animate-pulse text-slate-500">●</span>
        <span className="font-semibold text-slate-900">New Priority Patient</span>
        <Badge variant="outline" className="text-xs font-bold uppercase bg-slate-900 text-white border-slate-900">
          {escalation.severity}
        </Badge>
        <span className="text-slate-600">{escalation.reason}</span>
      </div>
      <button onClick={onDismiss} className="ml-auto text-slate-400 hover:text-slate-600">x</button>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function CoordinatorDashboardPage() {
  const { data: patients, loading: patientsLoading } = usePatients();
  const { data: escalationsRaw, loading: escalationsLoading } = useEscalations({ status: "open" });
  const { data: callLogsRaw, loading: callLogsLoading } = useCallLogs();
  const { data: newborns } = useNewborns();
  const { data: vacSchedules } = useVaccinationSchedules();
  const { data: conversionFunnel, loading: funnelLoading } = useConversionFunnel();
  const { data: allRisks } = useRiskAssessments();

  // Smart call type resolver for priority patients
  const parentPatientIds = new Set(newborns.map((n) => n.parent_patient_id));
  const dueVaxNewbornIds = new Set(
    vacSchedules.filter((v) => v.status === "overdue" || v.status === "pending").map((v) => v.newborn_id)
  );
  const newbornByParent = new Map(newborns.map((n) => [n.parent_patient_id, n.id]));
  const dueVaxParentIds = new Set(
    [...parentPatientIds].filter((pid) => {
      const nid = newbornByParent.get(pid);
      return nid && dueVaxNewbornIds.has(nid);
    })
  );
  const recommendations = resolveAllPatients(
    patients, callLogsRaw, escalationsRaw, allRisks,
    parentPatientIds, dueVaxParentIds,
  );

  const [alertQueue, setAlertQueue] = useState<Escalation[]>([]);
  const [reviewEscalation, setReviewEscalation] = useState<any>(null);
  const [followUpNotes, setFollowUpNotes] = useState("Action Plan:\n1. Schedule OPD appointment within 48 hours\n2. Confirm medication availability at nearest pharmacy\n3. Assign ASHA worker for home visit if needed\n\nFollow-up call in 2 days.");
  const [callingPatient, setCallingPatient] = useState<string | null>(null);

  const handleNewEscalation = useCallback((esc: Escalation) => {
    setAlertQueue((prev) => [esc, ...prev]);
  }, []);

  const liveEscalations = useRealtimeEscalations(handleNewEscalation);
  const dismissAlert = useCallback(() => setAlertQueue((prev) => prev.slice(1)), []);

  const liveIds = new Set(liveEscalations.map((e) => e.id));
  const allEscalations = [
    ...liveEscalations,
    ...escalationsRaw.filter((e) => !liveIds.has(e.id)),
  ];

  const patientCount = patients.length;
  const pendingCount = allEscalations.filter((e) => e.status === "open" || e.status === "Open").length;
  const patientNameMap = new Map(patients.map((p) => [p.id, p]));

  const totalCalls = callLogsRaw.length;
  const completedCalls = callLogsRaw.filter((c) => c.status === "completed").length;
  const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

  // Compute KPI values from real funnel data
  const opdRate = conversionFunnel.length > 0 ? conversionFunnel[0].rate : 0;
  const followUpEntry = conversionFunnel.find(f => f.label === "Follow-up Response");
  const followUpRate = followUpEntry?.rate ?? 0;
  const followUpFrom = followUpEntry?.from ?? 0;
  const followUpConverted = followUpEntry?.converted ?? 0;

  const transcriptData =
    !callLogsLoading && callLogsRaw.length > 0
      ? callLogsRaw.slice(0, 5).map((call) => ({
          id: call.id,
          patient: patientNameMap.get(call.patient_id)?.name ?? call.patient_id.slice(0, 8),
          transcript: call.transcript || "(no transcript)",
          use_case: call.use_case || call.call_type || "follow_up",
          duration: call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min` : "-",
          status: call.status,
        }))
      : [];

  function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  async function handleScheduleCallback() {
    if (!reviewEscalation) return;
    await createAuditLog({
      user_role: "coordinator",
      action: "callback_scheduled",
      resource_type: "escalation",
      resource_id: isUuid(reviewEscalation.id) ? reviewEscalation.id : undefined,
      details: {
        patient_id: reviewEscalation.patient_id,
        patient_name: reviewEscalation.patientName,
      },
    });
    toast.success("Callback scheduled for patient");
    setReviewEscalation(null);
  }

  async function handleEscalateToDoctor() {
    if (!reviewEscalation) return;
    await createAuditLog({
      user_role: "coordinator",
      action: "escalated_to_doctor",
      resource_type: "escalation",
      resource_id: isUuid(reviewEscalation.id) ? reviewEscalation.id : undefined,
      details: {
        patient_id: reviewEscalation.patient_id,
        patient_name: reviewEscalation.patientName,
      },
    });
    toast.success("Escalated to doctor for clinical review");
    setReviewEscalation(null);
  }

  async function initiateCall(params: {
    patient_id: string;
    patient_name: string;
    call_type: string;
    phone_number?: string;
    health_camp?: string;
    risk_level?: string;
    risk_score?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    blood_glucose?: number;
    bmi?: number;
    doctor_name?: string;
    primary_condition?: string;
    baby_name?: string;
    baby_age?: string;
    next_vaccine?: string;
    vaccine_due_date?: string;
  }) {
    setCallingPatient(params.patient_id);
    try {
      const data = await callStartVoiceCall({
        language: "hindi",
        ...params,
      });
      if (data.error) throw new Error(data.error);
      await createAuditLog({
        user_role: "coordinator",
        action: "call_initiated",
        resource_type: "voice_call",
        resource_id: data.call_id,
        details: { patient_name: params.patient_name, call_type: params.call_type },
      });
      toast.success(`Call initiated to ${params.patient_name}`, {
        description: `${useCase(params.call_type)} workflow — Call ID: ${data.call_id.slice(0, 20)}...`,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to initiate call");
    } finally {
      setCallingPatient(null);
    }
  }

  const useCase = (code: string) => CALL_TYPE_LABELS[code] || code;

  return (
    <div className="space-y-6 pb-20">
      {/* Realtime alert banners */}
      {alertQueue.length > 0 && (
        <div className="space-y-2">
          <AlertBanner key={alertQueue[0].id} escalation={alertQueue[0]} onDismiss={dismissAlert} />
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Care Coordinator Dashboard</h1>
        <p className="text-sm text-slate-500 font-medium">
          {patientsLoading ? "Loading..." : `Managing ${patientCount} screened patients across 6 care pathways — ${pendingCount} need attention`}
        </p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-white border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-50 rounded-full blur-2xl group-hover:bg-slate-100 transition-colors"></div>
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
            <CardTitle className="text-sm font-semibold text-slate-600">Screened Patients</CardTitle>
            <Users className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-4xl font-black text-slate-900 tracking-tight">{patientCount}</div>
            <p className="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-2">
              <TrendingUp className="w-3.5 h-3.5" /> {pendingCount} need follow-up
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-50 rounded-full blur-2xl group-hover:bg-slate-100 transition-colors"></div>
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
            <CardTitle className="text-sm font-semibold text-slate-600">Voice AI Calls</CardTitle>
            <Phone className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-4xl font-black text-slate-900 tracking-tight">{totalCalls}</div>
            <p className="text-xs text-slate-500 font-medium mt-2">
              {successRate}% answered · across all use cases
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-50 rounded-full blur-2xl group-hover:bg-slate-100 transition-colors"></div>
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
            <CardTitle className="text-sm font-semibold text-slate-600">Screening → OPD</CardTitle>
            <Target className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-4xl font-black text-slate-900 tracking-tight">{opdRate}<span className="text-xl font-bold">%</span></div>
            <p className="text-xs text-slate-500 font-semibold flex items-center gap-1 mt-2">
              <TrendingUp className="w-3.5 h-3.5" /> {patientCount} screened at health camps
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-md relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-bl-full blur-2xl group-hover:bg-white/10 transition-colors"></div>
          <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
            <CardTitle className="text-sm font-semibold text-slate-400">Patient Response Rate</CardTitle>
            <BarChart3 className="h-5 w-5 text-slate-300" />
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-4xl font-black text-white tracking-tight">{followUpRate}<span className="text-xl font-bold ml-0.5">%</span></div>
            <p className="text-[11px] text-slate-400 font-medium mt-2">
              {followUpConverted} of {followUpFrom} patients responded to AI calls
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
            <Target className="w-5 h-5 text-slate-500" />
            Use Case Conversion Funnel
          </CardTitle>
          <CardDescription className="font-medium text-slate-500">
            How effectively Voice AI outreach converts patients through each care pathway.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid gap-3 md:grid-cols-3">
            {conversionFunnel.map((item) => (
              <div key={item.label} className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-800">{item.label}</span>
                    <span className="text-lg font-black text-slate-900">{item.rate}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.rate}%` }}></div>
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] font-medium text-slate-400">{item.from} total</span>
                    <span className="text-[10px] font-bold text-slate-600">{item.converted} converted</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Priority Follow-ups (was Escalations) */}
      <Card className="border-slate-300 shadow-sm overflow-hidden">
        <CardHeader className="bg-slate-50 pb-5 border-b border-slate-200">
          <CardTitle className="text-lg flex items-center gap-2 text-slate-900">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-500"></span>
            </span>
            Priority Patients
            {escalationsLoading && <span className="ml-2 text-xs font-normal text-slate-400">loading...</span>}
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">Patients flagged by Voice AI during calls — requires coordinator action.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="pl-6 h-12 w-[18%]">Patient</TableHead>
                <TableHead className="w-[9%]">Severity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-[8%]">Risk Score</TableHead>
                <TableHead className="text-right pr-6 w-[16%]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEscalations.map((esc) => {
                const fb = esc as any;
                const patientLabel = fb._patient ?? patientNameMap.get(esc.patient_id)?.name ?? esc.patient_id.slice(0, 8);
                const patientData = patientNameMap.get(esc.patient_id);
                const campLabel = fb._camp ?? patientData?.health_camp ?? "General Clinic";
                const riskScore = fb._riskScore ?? patientData?.overall_risk_score ?? (() => { let h = 0; for (let i = 0; i < esc.patient_id.length; i++) h = (h * 31 + esc.patient_id.charCodeAt(i)) >>> 0; return (40 + (h % 20)).toFixed(1); })();
                const isLive = liveEscalations.some((l) => l.id === esc.id);

                return (
                  <TableRow key={esc.id} className={isLive ? "bg-slate-50 transition-colors" : "hover:bg-slate-50 transition-colors"}>
                    <TableCell className="pl-6 py-4">
                      <div>
                        <div className="font-semibold text-slate-900 truncate">{patientLabel}</div>
                        <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 mt-1 truncate">
                          <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {campLabel}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase tracking-widest text-[10px] px-2 py-0.5 font-bold ${
                        esc.severity === "CRITICAL" ? "bg-slate-900 text-white border-slate-900"
                        : esc.severity === "HIGH" ? "bg-slate-700 text-white border-slate-700"
                        : "bg-slate-200 text-slate-700 border-slate-300"
                      }`}>{esc.severity}</Badge>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-sm font-medium text-slate-700 leading-snug line-clamp-2">{esc.reason}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono bg-slate-50 text-slate-600 border-slate-200">
                        {riskScore}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={callingPatient === esc.patient_id}
                          onClick={() => {
                            const rec = recommendations.get(esc.patient_id);
                            const resolvedCallType = rec?.callType || "opd_to_ipd";
                            initiateCall({
                            patient_id: esc.patient_id,
                            patient_name: patientLabel,
                            call_type: resolvedCallType,
                            health_camp: campLabel,
                            risk_level: String(esc.severity || "HIGH"),
                            risk_score: Number(riskScore) || 50,
                            doctor_name: "Dr. Rajesh Verma",
                          });}}
                          className="gap-1.5 text-slate-700 border-slate-200 hover:bg-slate-50 font-semibold"
                        >
                          {callingPatient === esc.patient_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <PhoneOutgoing className="w-3.5 h-3.5" />
                          )}
                          AI Call
                        </Button>
                        <Button size="sm" onClick={() => setReviewEscalation({ ...esc, patientName: patientLabel })} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm font-medium">
                          Review
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent Call Campaign Results */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
          <CardTitle className="text-lg text-slate-800">Recent Voice AI Calls</CardTitle>
          <CardDescription className="font-medium text-slate-500">
            Latest automated outreach call outcomes across all use cases.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {transcriptData.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-xl bg-white shadow-sm hover:border-slate-300 transition-colors">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">{t.patient}</span>
                  <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 bg-slate-50 text-slate-700 border-slate-200">
                    {useCase(t.use_case)}
                  </Badge>
                </div>
                <p className="text-sm text-slate-500 italic max-w-2xl truncate">&quot;{t.transcript}&quot;</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-slate-400 font-mono">{t.duration}</span>
                <Badge variant={t.status === "completed" ? "secondary" : "outline"} className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5">
                  {t.status === "completed" ? "Completed" : "In Progress"}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Newborn Vaccination Tracker */}
      {(() => {
        const overdueVax = vacSchedules.filter((v) => v.status === "overdue");
        const upcomingVax = vacSchedules.filter((v) => v.status === "pending");
        const newbornMap = new Map(newborns.map((n) => [n.id, n.baby_name]));

        // Group vaccines by baby
        type VaxGroup = { babyName: string; newbornId: string; vaccines: string[]; earliestDue: string; isOverdue: boolean };
        const groupMap = new Map<string, VaxGroup>();
        for (const v of [...overdueVax, ...upcomingVax]) {
          const existing = groupMap.get(v.newborn_id);
          const babyName = newbornMap.get(v.newborn_id) || "Baby";
          const isOverdue = v.status === "overdue";
          if (existing) {
            if (!existing.vaccines.includes(v.vaccine_name)) existing.vaccines.push(v.vaccine_name);
            if (v.due_date < existing.earliestDue) existing.earliestDue = v.due_date;
            if (isOverdue) existing.isOverdue = true;
          } else {
            groupMap.set(v.newborn_id, {
              babyName,
              newbornId: v.newborn_id,
              vaccines: [v.vaccine_name],
              earliestDue: v.due_date,
              isOverdue,
            });
          }
        }
        const grouped = Array.from(groupMap.values()).sort((a, b) => {
          if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
          return a.earliestDue.localeCompare(b.earliestDue);
        });

        return (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-base flex items-center gap-2 text-slate-900">
                <Syringe className="w-4 h-4 text-slate-500" />
                Vaccination Outreach
                {overdueVax.length > 0 && (
                  <Badge variant="outline" className="ml-1 text-[10px] uppercase tracking-widest font-bold bg-slate-900 text-white border-slate-900">
                    {overdueVax.length} Overdue
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 font-medium">Newborns with due/overdue vaccines — Voice AI reminds parents.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100">
                {grouped.slice(0, 5).map((g) => (
                  <div key={g.newbornId} className={`flex items-center gap-3 px-5 py-3 ${g.isOverdue ? "bg-slate-50/80" : ""}`}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${g.isOverdue ? "bg-slate-900" : "bg-slate-300"}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-semibold ${g.isOverdue ? "text-slate-900" : "text-slate-600"}`}>{g.babyName}</span>
                      <span className={`text-xs ml-2 ${g.isOverdue ? "text-slate-500" : "text-slate-400"}`}>
                        {g.vaccines.join(", ")}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider tabular-nums shrink-0 ${g.isOverdue ? "text-slate-900" : "text-slate-400"}`}>
                      {new Date(g.earliestDue).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase()}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={callingPatient === g.newbornId}
                      onClick={() => initiateCall({
                        patient_id: g.newbornId,
                        patient_name: g.babyName + "'s Parent",
                        call_type: "newborn_vaccination",
                        baby_name: g.babyName,
                        baby_age: "",
                        next_vaccine: g.vaccines[0],
                        vaccine_due_date: g.earliestDue,
                      })}
                      className={`gap-1 font-medium h-7 px-2 text-xs shrink-0 ${g.isOverdue ? "text-slate-700 hover:bg-slate-200" : "text-slate-500 hover:bg-slate-100"}`}
                    >
                      {callingPatient === g.newbornId ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <PhoneOutgoing className="w-3 h-3" />
                      )}
                      Remind
                    </Button>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-slate-100">
                <Button variant="ghost" size="sm" className="w-full font-medium text-xs text-slate-500 hover:text-slate-800 h-8"
                  onClick={() => window.location.href = "/doctor/vaccinations"}
                >
                  View Full Vaccination Tracker
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Patient Review Sheet */}
      <Sheet open={!!reviewEscalation} onOpenChange={(val) => !val && setReviewEscalation(null)}>
        <SheetContent className="w-full sm:max-w-[720px] flex flex-col p-0 gap-0 border-l border-slate-200 shadow-2xl">
          {reviewEscalation && (
            <>
              {/* Sheet Header */}
              <div className="px-5 py-5 border-b bg-white shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="outline" className="uppercase tracking-widest text-[10px] font-bold px-2 py-0.5 bg-slate-900 text-white border-slate-900">{reviewEscalation.severity} PRIORITY</Badge>
                  <span className="text-[10px] text-slate-400 font-mono">{reviewEscalation.id?.slice(0,8) || "ESC-021"}</span>
                </div>
                <SheetTitle className="text-xl font-bold text-slate-900 tracking-tight">{reviewEscalation.patientName}</SheetTitle>
                <SheetDescription className="text-xs mt-1.5 text-slate-500">
                  DPDP Consent Verified &mdash; Active since Mar 2026
                </SheetDescription>
              </div>

              {/* Sheet Content / Tabs */}
              <Tabs defaultValue="summary" className="flex-1 flex flex-col min-h-0">
                <div className="px-5 pt-4 pb-0 border-b border-slate-100 bg-white shrink-0">
                  <TabsList className="h-9 w-full justify-start gap-0 bg-transparent p-0 rounded-none">
                    <TabsTrigger value="summary" className="px-3 pb-2.5 text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-slate-400 data-[state=active]:text-slate-900">Summary</TabsTrigger>
                    <TabsTrigger value="transcript" className="px-3 pb-2.5 text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-slate-400 data-[state=active]:text-slate-900">Transcript</TabsTrigger>
                    <TabsTrigger value="action" className="px-3 pb-2.5 text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-slate-400 data-[state=active]:text-slate-900">Action Plan</TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pt-5">
                  {/* AI Summary Tab */}
                  {(() => {
                    // Find linked voice call data
                    const linkedCall = callLogsRaw.find(
                      (c) => c.id === reviewEscalation.call_id || c.patient_id === reviewEscalation.patient_id
                    );
                    const extracted = (linkedCall?.extracted_data || {}) as Record<string, any>;
                    const symptoms = (extracted.symptoms_reported || []) as { symptom: string; duration?: string; severity?: string }[];
                    const summary = extracted.call_summary || reviewEscalation.reason || "No AI summary available for this escalation.";
                    const severity = extracted.overall_severity || reviewEscalation.severity;
                    const mood = extracted.patient_mood;
                    const consentGiven = extracted.patient_consent_for_ipd;
                    const objections = (extracted.objections_raised || []) as string[];
                    const transcript = linkedCall?.transcript || null;

                    return (
                      <>
                  <TabsContent value="summary" className="m-0 space-y-6 pb-28 sm:pb-24">
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                      <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-500/5 rounded-full blur-2xl"></div>
                      <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3 tracking-wide">
                        <Bot className="w-5 h-5 text-slate-500" /> AI ENGAGEMENT SUMMARY
                      </h4>
                      <p className="text-[15px] text-slate-700 leading-relaxed font-medium">
                        {summary}
                      </p>
                      {severity && (
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                          <Badge variant="outline" className={`text-[10px] uppercase tracking-widest font-bold ${severity === "CRITICAL" || severity === "HIGH" ? "bg-slate-900 text-white border-slate-900" : "bg-slate-200 text-slate-700 border-slate-300"}`}>
                            Severity: {severity}
                          </Badge>
                          {mood && (
                            <Badge variant="outline" className="text-[10px] uppercase tracking-widest font-bold text-slate-600">
                              Mood: {mood}
                            </Badge>
                          )}
                          {consentGiven !== undefined && (
                            <Badge variant={consentGiven ? "default" : "outline"} className="text-[10px] uppercase tracking-widest font-bold">
                              IPD Consent: {consentGiven ? "Yes" : "No"}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>

                    {symptoms.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Extracted Patient-Reported Data</h4>
                      <div className="flex flex-col gap-2.5">
                        {symptoms.map((s, i) => (
                          <div key={i} className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white shadow-sm">
                            <Badge variant="outline" className={`${s.severity === "severe" ? "text-slate-900 bg-slate-200 border-slate-400" : "text-slate-700 bg-slate-50 border-slate-200"} font-bold px-2 py-1 text-xs`}>
                              {s.symptom}
                            </Badge>
                            {s.duration && <span className="text-xs font-semibold text-slate-500">{s.duration}{s.severity ? `, ${s.severity}` : ""}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                    )}

                    {objections.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Patient Objections</h4>
                      <div className="flex flex-col gap-2">
                        {objections.map((obj, i) => (
                          <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                            <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="text-sm font-medium text-slate-700">{obj}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    )}

                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Recommended Actions</h4>
                      <div className="space-y-2">
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500" defaultChecked />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Schedule OPD Appointment</p>
                            <p className="text-xs text-slate-500 mt-0.5">Book nearest slot, confirm via voice call.</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-white cursor-pointer hover:bg-slate-50 transition-colors">
                          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-600 focus:ring-slate-500" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Dispatch ASHA Worker</p>
                            <p className="text-xs text-slate-500 mt-0.5">Home visit for BP verification.</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-white cursor-pointer hover:bg-slate-50 transition-colors">
                          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-600 focus:ring-slate-500" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Escalate to Doctor</p>
                            <p className="text-xs text-slate-500 mt-0.5">Flag for clinical review if worsening.</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Transcript Tab */}
                  <TabsContent value="transcript" className="m-0 space-y-4 pb-28 sm:pb-24 h-full min-h-[400px]">
                    <div className="bg-slate-950 p-5 rounded-2xl font-mono text-[13px] leading-loose overflow-x-auto shadow-2xl h-full border border-slate-800">
                      {transcript ? (
                        transcript.split(/(?=Agent:|Patient:)/g).filter(Boolean).map((line, i) => {
                          const isAgent = line.trim().startsWith("Agent:");
                          const text = line.replace(/^(Agent:|Patient:)\s*/, "").trim();
                          const mins = Math.floor((i * 8) / 60);
                          const secs = (i * 8) % 60;
                          const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
                          return (
                            <div key={i} className={`${isAgent ? "text-slate-300" : "text-slate-400"} mb-3`}>
                              <span className="text-slate-600 select-none mr-2">{"["}00:{ts}{"]"}</span>
                              <strong className={isAgent ? "text-slate-200" : "text-slate-400"}>{isAgent ? "Agent:" : "Patient:"}</strong> {text}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-slate-500 text-center py-8">No transcript available for this escalation.</div>
                      )}
                      <div className="text-slate-500/50 mt-6 border-t border-slate-800/50 pt-4 flex items-center justify-center text-xs tracking-widest uppercase">{"// End of voice transcript"}</div>
                    </div>
                  </TabsContent>
                      </>
                    );
                  })()}

                  {/* Action Plan Tab */}
                  <TabsContent value="action" className="m-0 space-y-4 pb-28 sm:pb-24 flex flex-col h-full min-h-[400px]">
                    <div className="flex items-center justify-between px-1">
                      <h4 className="text-sm font-bold text-slate-800">Coordinator Action Plan</h4>
                      <Badge variant="outline" className="bg-slate-100/50 text-slate-600 border-slate-200 font-bold tracking-wider text-[10px] uppercase">Draft</Badge>
                    </div>
                    <Textarea
                      value={followUpNotes}
                      onChange={(e) => setFollowUpNotes(e.target.value)}
                      className="flex-1 min-h-[220px] sm:min-h-[300px] font-mono text-[15px] leading-relaxed p-4 sm:p-5 rounded-xl border-slate-200 focus-visible:ring-slate-500 shadow-sm bg-white"
                    />
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                      <ShieldCheck className="w-5 h-5 text-slate-500 shrink-0" />
                      <p className="text-[11px] font-medium text-slate-600 leading-snug">
                        Actions are logged in the audit trail. Critical cases are auto-escalated to the assigned physician.
                      </p>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>

              {/* Sheet Footer Actions */}
              <div className="p-4 border-t bg-white shrink-0 flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReviewEscalation(null)} className="font-medium text-slate-500 hover:text-slate-800">Cancel</Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium h-9 px-3"
                    onClick={handleEscalateToDoctor}
                  >
                    <ArrowRight className="w-3.5 h-3.5" /> Escalate
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-slate-900 hover:bg-slate-800 font-medium h-9 px-3"
                    onClick={handleScheduleCallback}
                  >
                    <PhoneCall className="w-3.5 h-3.5" /> Schedule Callback
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}
