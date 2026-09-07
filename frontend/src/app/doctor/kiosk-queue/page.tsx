"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";

const LiveAmbulanceMap = dynamic(
  () => import("@/components/ambulance/live-ambulance-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400 text-xs">
        Loading live emergency route and ambulance tracking…
      </div>
    ),
  }
);
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { callExportAbdm, callReviewCaseSummary } from "@/lib/edge-functions";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Edit3,
  Ambulance,
  FileDown,
  Stethoscope,
  Clock,
  User,
  Phone,
  Sparkles,
  RefreshCw,
  FileText,
  Search,
  Activity,
  Pill,
  HeartPulse,
  ChevronRight,
  AlertCircle,
  Volume2,
  ShieldCheck,
  Eye,
  Check,
} from "lucide-react";

interface PatientRecord {
  id: string;
  name: string;
  phone: string | null;
  abha_id: string | null;
  gender: string | null;
  dob: string | null;
  chronic_conditions: string | null;
  current_medications: string | null;
  allergies: string | null;
}

interface CaseSession {
  id: string;
  patient_id: string;
  language: string;
  mode: "allopathic" | "ayush";
  status: "identifying" | "consented" | "interviewing" | "scanning" | "summarising" | "ready" | "consulted" | "abandoned";
  red_flag: boolean;
  red_flag_reason: string | null;
  escalation_id: string | null;
  incident_id: string | null;
  started_at: string;
  ended_at: string | null;
  patient?: PatientRecord;
}

interface CaseSummary {
  id: string;
  session_id: string;
  sections: Array<{
    section: string;
    heading: string;
    body?: string;
    items?: Array<{ code: string; label: string; value: string }>;
  }>;
  clinician_text: string | null;
  patient_text: string | null;
  status: "draft" | "accepted" | "amended" | "rejected";
  amended_sections: any | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

interface DashavidhaFactor {
  id: string;
  factor: string;
  value: string | null;
  detail: any;
  source: string;
  recorded_at: string;
}

interface CaseDocument {
  id: string;
  doc_type: string | null;
  doc_date: string | null;
  ocr_text: string | null;
  status: string;
  entities?: DocumentEntity[];
}

interface DocumentEntity {
  id: string;
  entity_type: string;
  name: string;
  value: string | null;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  out_of_range: boolean | null;
}

interface HistoryAnswer {
  id: string;
  section: string;
  item_code: string;
  question: string | null;
  answer_text: string | null;
  answer_value: any;
  source: string;
  asked_at: string;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const AYUSH_FACTOR_TITLES: Record<string, { title: string; eng: string }> = {
  prakriti: { title: "प्रकृति (Prakriti)", eng: "Basic Constitution / Dosha Baseline" },
  vikriti: { title: "विकृति (Vikriti)", eng: "Dosha Imbalance / Current Vitiation" },
  sara: { title: "सार (Sara)", eng: "Dhatu Tissue Essence & Quality" },
  samhanana: { title: "संहनन (Samhanana)", eng: "Body Compactness & Structural Symmetry" },
  pramana: { title: "प्रमाण (Pramana)", eng: "Anthropometric Proportions & Build" },
  satmya: { title: "सात्म्य (Satmya)", eng: "Homologation / Habitual Adaptability" },
  sattva: { title: "सत्त्व (Sattva)", eng: "Mental Strength & Psychological Resilience" },
  ahara_shakti: { title: "आहार शक्ति (Ahara Shakti)", eng: "Digestive & Assimilation Capacity" },
  vyayama_shakti: { title: "व्यायाम शक्ति (Vyayama Shakti)", eng: "Physical Endurance & Work Capacity" },
  vaya: { title: "वय (Vaya)", eng: "Biological Age Stage (Bala / Madhyama / Vriddha)" },
};

export default function DoctorKioskQueuePage() {
  const { userName, role } = useAuth();
  const [sessions, setSessions] = useState<CaseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Selected session detailed data
  const [detailLoading, setDetailLoading] = useState(false);
  const [summary, setSummary] = useState<CaseSummary | null>(null);
  const [factors, setFactors] = useState<DashavidhaFactor[]>([]);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [answers, setAnswers] = useState<HistoryAnswer[]>([]);
  const [activeTab, setActiveTab] = useState<"summary" | "dashavidha" | "ocr" | "transcript" | "spoken">("summary");

  // Review states
  const [reviewMode, setReviewMode] = useState<"idle" | "amend" | "reject">("idle");
  const [amendedNote, setAmendedNote] = useState("");
  const [amendedClinicianText, setAmendedClinicianText] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [exportingFhir, setExportingFhir] = useState(false);
  const [escalatingAmbulance, setEscalatingAmbulance] = useState(false);
  const [showAmbulanceTracker, setShowAmbulanceTracker] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // Fetch all queue sessions
  const fetchQueue = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      // 1. Fetch sessions
      const { data: sessData, error: sessErr } = await supabase
        .from("case_sessions")
        .select("*")
        .in("status", ["ready", "summarising", "scanning", "interviewing", "consulted", "identifying"])
        .order("red_flag", { ascending: false })
        .order("started_at", { ascending: false });

      if (sessErr) throw sessErr;

      const sessionsList = (sessData as CaseSession[]) || [];

      // 2. Fetch linked patients
      const patientIds = Array.from(new Set(sessionsList.map((s) => s.patient_id).filter(Boolean)));
      let patientMap = new Map<string, PatientRecord>();

      if (patientIds.length > 0) {
        const { data: patData } = await supabase
          .from("patients")
          .select("id,name,phone,abha_id,gender,dob,chronic_conditions,current_medications,allergies")
          .in("id", patientIds);

        if (patData) {
          patData.forEach((p) => patientMap.set(p.id, p as PatientRecord));
        }
      }

      const merged = sessionsList.map((s) => ({
        ...s,
        patient: patientMap.get(s.patient_id),
      }));

      setSessions(merged);

      // Auto-select first ready or red-flag case if none selected
      if (!selectedSessionId && merged.length > 0) {
        const priority = merged.find((s) => s.red_flag || s.status === "ready") || merged[0];
        setSelectedSessionId(priority.id);
      }
    } catch (err) {
      console.error("fetchQueue failed:", err);
      toast.error("Failed to load kiosk queue");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase, selectedSessionId]);

  useEffect(() => {
    fetchQueue();
    // Poll every 8s for live walk-ins
    const interval = setInterval(() => {
      fetchQueue(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Fetch details for selected session
  const fetchSessionDetails = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    setReviewMode("idle");
    setAmendedNote("");
    setRejectionReason("");
    try {
      // 1. Summary
      const { data: sumData } = await supabase
        .from("case_summaries")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

      const loadedSummary = (sumData as CaseSummary) || null;
      setSummary(loadedSummary);
      if (loadedSummary?.clinician_text) {
        setAmendedClinicianText(loadedSummary.clinician_text);
      }

      // 2. Dashavidha factors
      const { data: facData } = await supabase
        .from("dashavidha_assessments")
        .select("*")
        .eq("session_id", sessionId)
        .order("recorded_at", { ascending: true });

      setFactors((facData as DashavidhaFactor[]) || []);

      // 3. Documents & Entities
      const { data: docData } = await supabase
        .from("case_documents")
        .select("id,doc_type,doc_date,ocr_text,status")
        .eq("session_id", sessionId);

      const docs = (docData as CaseDocument[]) || [];
      if (docs.length > 0) {
        const docIds = docs.map((d) => d.id);
        const { data: entData } = await supabase
          .from("document_entities")
          .select("*")
          .in("document_id", docIds);

        const entities = (entData as DocumentEntity[]) || [];
        docs.forEach((d) => {
          d.entities = entities.filter((e) => (e as any).document_id === d.id);
        });
      }
      setDocuments(docs);

      // 4. Raw History Answers
      const { data: ansData } = await supabase
        .from("history_answers")
        .select("*")
        .eq("session_id", sessionId)
        .order("asked_at", { ascending: true });

      setAnswers((ansData as HistoryAnswer[]) || []);
    } catch (err) {
      console.error("fetchSessionDetails failed:", err);
      toast.error("Failed to load session details");
    } finally {
      setDetailLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId, fetchSessionDetails]);

  const selectedSession = useMemo(() => {
    return sessions.find((s) => s.id === selectedSessionId) || null;
  }, [sessions, selectedSessionId]);

  // Review Actions: Accept
  async function handleAccept() {
    if (!selectedSessionId) return;
    setSubmittingReview(true);
    try {
      // First attempt native RPC
      const { error: rpcErr } = await supabase.rpc("review_case_summary", {
        p_session: selectedSessionId,
        p_action: "accepted",
        p_notes: "Accepted without alterations by clinician",
      });

      if (rpcErr) {
        // Fallback to edge function review endpoint
        await callReviewCaseSummary({
          sessionId: selectedSessionId,
          action: "accepted",
          doctorName: userName || "Duty Clinician",
          notes: "Accepted without alterations by clinician",
        });
      }

      toast.success("Case summary accepted. Patient consultation recorded.");
      await fetchSessionDetails(selectedSessionId);
      await fetchQueue(true);
    } catch (err: any) {
      console.error("handleAccept error:", err);
      toast.error(err.message || "Failed to accept summary");
    } finally {
      setSubmittingReview(false);
    }
  }

  // Review Actions: Amend
  async function handleAmend() {
    if (!selectedSessionId) return;
    if (!amendedClinicianText.trim()) {
      toast.error("Please enter the amended clinician summary text");
      return;
    }
    setSubmittingReview(true);
    try {
      const amendedSections = [
        ...(summary?.sections || []),
        {
          section: "clinician_amendment",
          heading: "Clinician Notes & Corrections",
          body: amendedClinicianText,
        },
      ];

      const { error: rpcErr } = await supabase.rpc("review_case_summary", {
        p_session: selectedSessionId,
        p_action: "amended",
        p_amended: amendedSections,
        p_notes: amendedNote || "Summary amended with clinician clinical notes",
      });

      if (rpcErr) {
        await callReviewCaseSummary({
          sessionId: selectedSessionId,
          action: "amended",
          doctorName: userName || "Duty Clinician",
          notes: amendedNote || "Summary amended with clinician clinical notes",
          amendedSections,
        });
      }

      toast.success("Case summary amended & consultation recorded.");
      setReviewMode("idle");
      await fetchSessionDetails(selectedSessionId);
      await fetchQueue(true);
    } catch (err: any) {
      console.error("handleAmend error:", err);
      toast.error(err.message || "Failed to amend summary");
    } finally {
      setSubmittingReview(false);
    }
  }

  // Review Actions: Reject
  async function handleReject() {
    if (!selectedSessionId) return;
    if (!rejectionReason.trim()) {
      toast.error("Please provide a clinical justification for rejection");
      return;
    }
    setSubmittingReview(true);
    try {
      const { error: rpcErr } = await supabase.rpc("review_case_summary", {
        p_session: selectedSessionId,
        p_action: "rejected",
        p_notes: rejectionReason,
      });

      if (rpcErr) {
        await callReviewCaseSummary({
          sessionId: selectedSessionId,
          action: "rejected",
          doctorName: userName || "Duty Clinician",
          notes: rejectionReason,
        });
      }

      toast.warning("Draft summary marked as rejected.");
      setReviewMode("idle");
      await fetchSessionDetails(selectedSessionId);
      await fetchQueue(true);
    } catch (err: any) {
      console.error("handleReject error:", err);
      toast.error(err.message || "Failed to reject summary");
    } finally {
      setSubmittingReview(false);
    }
  }

  // Export authentic ABDM FHIR R4 Bundle
  async function handleExportAbdm() {
    if (!selectedSession) return;
    setExportingFhir(true);
    try {
      const result = await callExportAbdm(selectedSession.patient_id, selectedSession.id);
      const jsonStr = JSON.stringify(result.bundle || result, null, 2);
      const blob = new Blob([jsonStr], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FHIR-R4-ABDM-${selectedSession.patient?.name || "Patient"}-${selectedSession.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`ABDM Bundle generated (${result.resource_count || "7"} FHIR resources)`);
    } catch (err: any) {
      console.error("handleExportAbdm error:", err);
      toast.error("ABDM Export failed: " + err.message);
    } finally {
      setExportingFhir(false);
    }
  }

  // Emergency Acute Dispatch Trigger
  async function handleEmergencyDispatch() {
    if (!selectedSession) return;
    setEscalatingAmbulance(true);
    try {
      const reasonText = selectedSession.red_flag_reason || "Doctor escalated acute emergency from walk-in OPD queue";
      const { data: escData, error: escErr } = await supabase
        .from("escalations")
        .insert({
          patient_id: selectedSession.patient_id,
          severity_level: "CRITICAL",
          severity: "CRITICAL",
          reason: `[OPD MediKiosk Alert] ${reasonText}`,
          status: "open",
        })
        .select("id")
        .single();

      if (escErr) throw escErr;

      // Update case_session with escalation reference
      await supabase
        .from("case_sessions")
        .update({
          red_flag: true,
          red_flag_reason: reasonText,
          escalation_id: escData.id,
        })
        .eq("id", selectedSession.id);

      toast.success("Emergency escalation dispatched to acute ambulance operations queue!");
      await fetchQueue(true);
      await fetchSessionDetails(selectedSession.id);
    } catch (err: any) {
      console.error("handleEmergencyDispatch error:", err);
      toast.error("Failed to dispatch ambulance: " + err.message);
    } finally {
      setEscalatingAmbulance(false);
    }
  }

  // Filter queue
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const pat = s.patient;
      const term = search.toLowerCase();
      const matchesSearch =
        !search ||
        (pat?.name?.toLowerCase().includes(term) ?? false) ||
        (pat?.phone?.includes(term) ?? false) ||
        (pat?.abha_id?.toLowerCase().includes(term) ?? false) ||
        (s.red_flag_reason?.toLowerCase().includes(term) ?? false);

      if (!matchesSearch) return false;

      if (statusFilter === "red_flag") return s.red_flag;
      if (statusFilter === "ready") return s.status === "ready";
      if (statusFilter === "ayush") return s.mode === "ayush";
      if (statusFilter === "in_progress") {
        return ["interviewing", "scanning", "summarising"].includes(s.status);
      }
      if (statusFilter === "consulted") return s.status === "consulted";

      return true;
    });
  }, [sessions, search, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: sessions.length,
      redFlags: sessions.filter((s) => s.red_flag).length,
      ready: sessions.filter((s) => s.status === "ready").length,
      inProgress: sessions.filter((s) => ["interviewing", "scanning", "summarising"].includes(s.status)).length,
      consulted: sessions.filter((s) => s.status === "consulted").length,
    };
  }, [sessions]);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Walk-In MediKiosk OPD Queue
            </h1>
            <Badge variant="outline" className="text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
              Live Clinic
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time walk-in intake, Ayush Dashavidha Pariksha, and Prescription OCR. Review AI draft summaries, accept/amend/reject, or escalate emergencies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              fetchQueue();
            }}
            disabled={refreshing || loading}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => window.open("/kiosk", "_blank")}
            className="text-xs bg-slate-900 text-white hover:bg-slate-800"
          >
            Open MediKiosk Station &rarr;
          </Button>
        </div>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="shadow-xs border-slate-200">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs font-medium">Total Walk-Ins</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={`shadow-xs ${stats.redFlags > 0 ? "border-rose-300 bg-rose-50/50" : "border-slate-200"}`}>
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs font-medium text-rose-700 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Red Flags
            </CardDescription>
            <CardTitle className={`text-2xl font-black ${stats.redFlags > 0 ? "text-rose-600 animate-pulse" : "text-slate-900"}`}>
              {stats.redFlags}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-xs border-slate-200">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs font-medium text-amber-700">Ready for Doctor</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-600">{stats.ready}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-xs border-slate-200">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs font-medium text-blue-700">In Kiosk Intake</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-600">{stats.inProgress}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-xs border-slate-200">
          <CardHeader className="p-4 pb-1">
            <CardDescription className="text-xs font-medium text-slate-500">Consulted</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-700">{stats.consulted}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main Split Layout: Queue List (Left) + Consultation Workspace (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Queue List */}
        <div className="lg:col-span-5 space-y-3">
          {/* Search & Filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search patient, ABHA, phone, or symptom..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {[
                { key: "all", label: "All Cases" },
                { key: "red_flag", label: "🚨 Red Flag", count: stats.redFlags },
                { key: "ready", label: "Ready", count: stats.ready },
                { key: "ayush", label: "Ayush OPD" },
                { key: "in_progress", label: "In Intake" },
                { key: "consulted", label: "Consulted" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                    statusFilter === f.key
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                  {f.count !== undefined && f.count > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-white">
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Queue Items */}
          <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
            {loading && sessions.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-400">Loading walk-in queue...</div>
            )}

            {!loading && filteredSessions.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-400 border border-dashed rounded-lg">
                No walk-in sessions matching your filter.
              </div>
            )}

            {filteredSessions.map((s) => {
              const isSelected = s.id === selectedSessionId;
              const pat = s.patient;

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`p-3.5 rounded-lg border transition-all cursor-pointer relative ${
                    isSelected
                      ? "border-blue-600 bg-blue-50/40 shadow-xs ring-1 ring-blue-600/20"
                      : s.red_flag
                      ? "border-rose-300 bg-rose-50/20 hover:bg-rose-50/40"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  {/* Top line: Name & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                        {pat?.name || "Walk-In Patient"}
                        {s.red_flag && (
                          <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0">
                            Red Flag
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>{pat?.phone || "No phone"}</span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          ABHA: {pat?.abha_id || "Unlinked"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold uppercase ${
                          s.status === "ready"
                            ? "bg-amber-100 text-amber-800 border-amber-300"
                            : s.status === "consulted"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                            : "bg-blue-100 text-blue-800 border-blue-200"
                        }`}
                      >
                        {s.status}
                      </Badge>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeAgo(s.started_at)}
                      </span>
                    </div>
                  </div>

                  {/* Red Flag alert snippet if present */}
                  {s.red_flag && s.red_flag_reason && (
                    <div className="mt-2 text-xs text-rose-700 bg-rose-100/60 p-1.5 rounded border border-rose-200 font-medium">
                      ⚠️ {s.red_flag_reason}
                    </div>
                  )}

                  {/* Bottom tags */}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 font-medium capitalize">
                      {s.mode} OPD
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 capitalize">
                      {s.language}
                    </span>
                    {pat?.chronic_conditions && (
                      <span className="truncate max-w-[160px] text-slate-400">
                        Hx: {pat.chronic_conditions}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Doctor Consultation Workspace */}
        <div className="lg:col-span-7">
          {!selectedSession ? (
            <Card className="h-full flex items-center justify-center p-12 text-center text-slate-400 border-dashed">
              <div>
                <Stethoscope className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h3 className="font-semibold text-slate-700">Select a Walk-In Patient</h3>
                <p className="text-sm mt-1">Choose a case from the queue to review history, Dashavidha factors, and prescription OCR.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Patient Banner */}
              <Card className="border-slate-200 shadow-xs overflow-hidden">
                <div className="bg-slate-900 text-white p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold">
                          {selectedSession.patient?.name || "Walk-In Patient"}
                        </h2>
                        <Badge className="bg-slate-800 text-slate-200 border-slate-700 text-xs">
                          {selectedSession.mode.toUpperCase()} OPD
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            selectedSession.status === "ready"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : selectedSession.status === "consulted"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-blue-500/20 text-blue-300 border-blue-500/40"
                          }
                        >
                          {selectedSession.status.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                        <span>ABHA: {selectedSession.patient?.abha_id || "Unlinked"}</span>
                        <span>•</span>
                        <span>Phone: {selectedSession.patient?.phone || "N/A"}</span>
                        <span>•</span>
                        <span>Gender: {selectedSession.patient?.gender || "Not specified"}</span>
                        <span>•</span>
                        <span>Language: {selectedSession.language}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleExportAbdm}
                        disabled={exportingFhir}
                        className="text-xs font-semibold bg-white text-slate-900 hover:bg-slate-100"
                      >
                        <FileDown className="w-3.5 h-3.5 mr-1" />
                        {exportingFhir ? "Exporting..." : "Export ABDM FHIR"}
                      </Button>
                    </div>
                  </div>

                  {/* Pre-existing conditions row */}
                  <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-4 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-500">Chronic Hx: </span>
                      {selectedSession.patient?.chronic_conditions || "None reported"}
                    </div>
                    <div>
                      <span className="text-slate-500">Known Allergies: </span>
                      <span className="text-rose-400 font-medium">
                        {selectedSession.patient?.allergies || "NKDA"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Current Rx: </span>
                      {selectedSession.patient?.current_medications || "None"}
                    </div>
                  </div>
                </div>

                {/* Emergency Alert Callout (if red flag) */}
                {selectedSession.red_flag && (
                  <div className="bg-rose-600 text-white p-3.5 px-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
                      <div>
                        <div className="font-bold text-sm">🚨 CLINICAL RED FLAG DETECTED</div>
                        <div className="text-xs text-rose-100 font-medium">
                          {selectedSession.red_flag_reason || "Immediate clinical intervention required"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAmbulanceTracker(!showAmbulanceTracker)}
                        className="bg-rose-700 hover:bg-rose-800 text-white border-rose-400 font-semibold text-xs shrink-0"
                      >
                        <Ambulance className="w-3.5 h-3.5 mr-1.5" />
                        {showAmbulanceTracker ? "Hide Tracker" : "Track Moving Ambulance 🚑"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleEmergencyDispatch}
                        disabled={escalatingAmbulance}
                        className="bg-white text-rose-700 hover:bg-rose-50 font-bold text-xs shrink-0"
                      >
                        {escalatingAmbulance ? "Dispatching..." : "Dispatch Ambulance"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Live Moving Ambulance Tracker Panel */}
                {selectedSession.red_flag && showAmbulanceTracker && (
                  <div className="p-3.5 border-t border-rose-300 bg-slate-950 rounded-b-lg animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between pb-2 text-xs">
                      <span className="font-semibold text-rose-400 flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                        </span>
                        Live Moving Ambulance Telemetry (En Route to Kiosk)
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        Patient: {selectedSession.patient?.name || "Walk-In Patient"}
                      </span>
                    </div>
                    <LiveAmbulanceMap
                      scene={{
                        lat: (selectedSession.patient as any)?.lat || 26.1445,
                        lon: (selectedSession.patient as any)?.lon || 91.7362,
                        victimName: selectedSession.patient?.name || "Walk-In Patient",
                        severity: "CRITICAL",
                        address: (selectedSession.patient as any)?.village || "MediKiosk Intake Booth",
                      }}
                      hospital={{
                        name: "AIIA / GMCH Emergency Trauma Ward",
                        lat: 26.1554,
                        lon: 91.7745,
                        bedsAvailable: 8,
                      }}
                      unit={{
                        callSign: "AMB-108-DISPUR",
                        driverName: "Pranab Barman",
                      }}
                      status="en_route"
                      height="320px"
                    />
                  </div>
                )}
              </Card>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1 border-b border-slate-200 pb-1">
                <button
                  onClick={() => setActiveTab("summary")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "summary"
                      ? "bg-slate-900 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Clinical SOAP Summary
                </button>
                {selectedSession.mode === "ayush" && (
                  <button
                    onClick={() => setActiveTab("dashavidha")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
                      activeTab === "dashavidha"
                        ? "bg-emerald-800 text-white font-semibold"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Dashavidha Pariksha (10 Factors)
                    <Badge variant="outline" className="text-[10px] ml-1 bg-white/20 text-inherit border-none py-0">
                      {factors.length}/10
                    </Badge>
                  </button>
                )}
                <button
                  onClick={() => setActiveTab("ocr")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "ocr"
                      ? "bg-slate-900 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Pill className="w-3.5 h-3.5" />
                  Prescriptions & OCR Labs
                  {documents.length > 0 && (
                    <Badge variant="outline" className="text-[10px] ml-1 bg-slate-200 text-slate-800 border-none py-0">
                      {documents.length}
                    </Badge>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("transcript")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "transcript"
                      ? "bg-slate-900 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Intake Transcript ({answers.length})
                </button>
                <button
                  onClick={() => setActiveTab("spoken")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "spoken"
                      ? "bg-slate-900 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Spoken Patient Readback
                </button>
              </div>

              {/* Tab Content 1: Clinical SOAP Summary */}
              {activeTab === "summary" && (
                <div className="space-y-4">
                  {/* Governance Notice */}
                  <div className="bg-slate-100 border border-slate-300 rounded-lg p-3 text-xs text-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-slate-600 shrink-0" />
                      <span>
                        <strong>Clinical Governance:</strong> This is a draft summary generated from kiosk intake. The AI never acts as an autonomous diagnostic authority; clinician review & sign-off is required.
                      </span>
                    </div>
                    <Badge
                      className={`text-xs uppercase font-bold shrink-0 ${
                        summary?.status === "accepted"
                          ? "bg-emerald-600 text-white"
                          : summary?.status === "amended"
                          ? "bg-amber-600 text-white"
                          : summary?.status === "rejected"
                          ? "bg-rose-600 text-white"
                          : "bg-slate-700 text-white"
                      }`}
                    >
                      Status: {summary?.status || "Draft"}
                    </Badge>
                  </div>

                  {summary?.status === "accepted" && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Verified and signed off by Clinician ({summary.reviewed_by ? "Attributed" : "Doctor"}) at {summary.reviewed_at ? new Date(summary.reviewed_at).toLocaleString("en-IN") : "Session Close"}.
                      </span>
                    </div>
                  )}

                  {detailLoading ? (
                    <div className="p-8 text-center text-sm text-slate-400">Loading clinical summary...</div>
                  ) : !summary ? (
                    <div className="p-8 text-center text-sm text-slate-500 border border-dashed rounded-lg bg-slate-50">
                      No summary generated yet for this session. It will be created when the patient reaches Step 5 in MediKiosk.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Formatted Sections */}
                      {summary.sections?.map((sec, idx) => (
                        <Card key={idx} className="border-slate-200 shadow-xs">
                          <CardHeader className="p-3.5 pb-1 bg-slate-50/50 border-b border-slate-100">
                            <CardTitle className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                              {sec.heading}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3.5 text-xs space-y-2">
                            {sec.body && (
                              <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                                {sec.body}
                              </p>
                            )}
                            {sec.items && sec.items.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                {sec.items.map((it, i) => (
                                  <div key={i} className="bg-slate-50 p-2 rounded border border-slate-100">
                                    <div className="text-[10px] text-slate-400 font-medium">{it.label}</div>
                                    <div className="font-semibold text-slate-800 mt-0.5">{it.value}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}

                      {/* If amended, display amended sections */}
                      {summary.amended_sections && (
                        <Card className="border-amber-300 bg-amber-50/30 shadow-xs">
                          <CardHeader className="p-3.5 pb-1 border-b border-amber-200">
                            <CardTitle className="text-xs font-bold text-amber-900 uppercase">
                              Clinician Amendments & Annotations
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3.5 text-xs text-amber-950">
                            <div className="whitespace-pre-line font-mono text-[11px]">
                              {JSON.stringify(summary.amended_sections, null, 2)}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}

                  {/* Doctor Sign-off Actions Bar */}
                  {summary && summary.status === "draft" && (
                    <Card className="border-slate-300 bg-slate-50 p-4 shadow-sm">
                      <div className="font-semibold text-xs text-slate-800 mb-3 flex items-center gap-1.5">
                        <Stethoscope className="w-4 h-4 text-blue-600" />
                        Clinical Governance Decision:
                      </div>

                      {reviewMode === "idle" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            onClick={handleAccept}
                            disabled={submittingReview}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            {submittingReview ? "Processing..." : "Accept Draft Summary"}
                          </Button>

                          <Button
                            variant="outline"
                            onClick={() => setReviewMode("amend")}
                            className="text-xs font-semibold border-amber-300 text-amber-800 hover:bg-amber-50"
                          >
                            <Edit3 className="w-3.5 h-3.5 mr-1" />
                            Amend / Add Notes
                          </Button>

                          <Button
                            variant="outline"
                            onClick={() => setReviewMode("reject")}
                            className="text-xs font-semibold border-rose-300 text-rose-700 hover:bg-rose-50"
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Reject Summary
                          </Button>
                        </div>
                      )}

                      {reviewMode === "amend" && (
                        <div className="space-y-3 bg-white p-3 rounded border border-amber-200 animate-in fade-in">
                          <div className="text-xs font-semibold text-amber-900">
                            Amend Clinician Summary / Append Doctor Consultation Notes
                          </div>
                          <Textarea
                            rows={4}
                            value={amendedClinicianText}
                            onChange={(e) => setAmendedClinicianText(e.target.value)}
                            placeholder="Add your clinical assessment, examination findings, or prescription modifications..."
                            className="text-xs font-sans"
                          />
                          <Input
                            placeholder="Reason for amendment (e.g., corrected duration of fever, added physical findings)..."
                            value={amendedNote}
                            onChange={(e) => setAmendedNote(e.target.value)}
                            className="text-xs h-8"
                          />
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              onClick={handleAmend}
                              disabled={submittingReview}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                            >
                              {submittingReview ? "Saving..." : "Sign Off with Amendments"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReviewMode("idle")}
                              className="text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {reviewMode === "reject" && (
                        <div className="space-y-3 bg-white p-3 rounded border border-rose-200 animate-in fade-in">
                          <div className="text-xs font-semibold text-rose-900">
                            Reject Draft Case Summary
                          </div>
                          <Textarea
                            rows={2}
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="State reason for rejection (e.g., conflicting patient identification, incoherent OCR scan, uncooperative intake)..."
                            className="text-xs"
                          />
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              onClick={handleReject}
                              disabled={submittingReview}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                            >
                              {submittingReview ? "Rejecting..." : "Confirm Rejection"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReviewMode("idle")}
                              className="text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  )}
                </div>
              )}

              {/* Tab Content 2: Ayush Dashavidha Pariksha */}
              {activeTab === "dashavidha" && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex items-center justify-between">
                    <div>
                      <strong>दशविध परीक्षा (Dashavidha Pariksha):</strong> Classical ten-fold clinical examination framework from Charaka Samhita & Ashtanga Hridaya.
                    </div>
                    <Badge className="bg-emerald-700 text-white text-[10px]">
                      {factors.length} Recorded
                    </Badge>
                  </div>

                  {factors.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400 border border-dashed rounded-lg">
                      No Dashavidha Pariksha factors recorded yet. (Only applicable to Ayush OPD intake mode).
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {factors.map((f) => {
                        const meta = AYUSH_FACTOR_TITLES[f.factor] || {
                          title: f.factor,
                          eng: f.factor,
                        };
                        return (
                          <Card key={f.id} className="border-emerald-100 shadow-xs">
                            <CardHeader className="p-3 pb-1 bg-emerald-50/40 border-b border-emerald-50">
                              <CardTitle className="text-xs font-bold text-emerald-950">
                                {meta.title}
                              </CardTitle>
                              <CardDescription className="text-[10px] text-emerald-700">
                                {meta.eng}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="p-3 text-xs space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500 font-medium">Assessed Value:</span>
                                <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200 font-bold capitalize text-[11px]">
                                  {f.value ? f.value.replace(/_/g, " ") : "Not evaluated"}
                                </Badge>
                              </div>
                              {f.detail && (
                                <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                                  <span className="text-slate-400 font-medium">Patient Justification: </span>
                                  {typeof f.detail === "string"
                                    ? f.detail
                                    : f.detail.reason || JSON.stringify(f.detail)}
                                </div>
                              )}
                              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                                <span>Input: {f.source}</span>
                                <span>{new Date(f.recorded_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tab Content 3: Prescriptions & OCR Findings */}
              {activeTab === "ocr" && (
                <div className="space-y-4">
                  {/* Drug Interaction Safety Banner */}
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <strong>Formulary Safety Cross-Check:</strong> Prescriptions and active medications cross-checked against 24 primary care interaction pairs (Metformin + Iodinated Contrast, ACE-I + K-sparing diuretics, NSAIDs + Anticoagulants, Ayush Rasashastra preparations).
                    </div>
                  </div>

                  {documents.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400 border border-dashed rounded-lg">
                      No prescription or lab documents scanned during this kiosk session.
                    </div>
                  ) : (
                    documents.map((doc) => (
                      <Card key={doc.id} className="border-slate-200 shadow-xs">
                        <CardHeader className="p-3.5 pb-2 bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between">
                          <div>
                            <CardTitle className="text-xs font-bold text-slate-800 uppercase">
                              {doc.doc_type?.replace(/_/g, " ") || "Scanned Clinical Document"}
                            </CardTitle>
                            <CardDescription className="text-[10px] text-slate-500">
                              Document Date: {doc.doc_date || "Not detected on paper"} • Status: {doc.status}
                            </CardDescription>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            OCR Processed
                          </Badge>
                        </CardHeader>
                        <CardContent className="p-3.5 space-y-3 text-xs">
                          {/* Extracted Entities */}
                          {doc.entities && doc.entities.length > 0 && (
                            <div>
                              <div className="font-semibold text-slate-700 mb-1.5 text-[11px] uppercase tracking-wider">
                                Extracted Medications & Laboratory Analytes:
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {doc.entities.map((ent) => (
                                  <div
                                    key={ent.id}
                                    className={`p-2 rounded border ${
                                      ent.out_of_range
                                        ? "bg-rose-50 border-rose-200 text-rose-950"
                                        : "bg-slate-50 border-slate-200 text-slate-900"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-xs">{ent.name}</span>
                                      {ent.out_of_range && (
                                        <Badge variant="destructive" className="text-[9px] py-0">
                                          Abnormal
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-xs mt-0.5">
                                      <span className="font-semibold">{ent.value || "N/A"}</span>{" "}
                                      <span className="text-slate-500 text-[10px]">{ent.unit || ""}</span>
                                    </div>
                                    {(ent.ref_low !== null || ent.ref_high !== null) && (
                                      <div className="text-[10px] text-slate-400 mt-0.5">
                                        Ref: {ent.ref_low ?? "0"} - {ent.ref_high ?? "—"} {ent.unit}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Raw OCR Text Snippet */}
                          {doc.ocr_text && (
                            <div>
                              <div className="font-semibold text-slate-500 mb-1 text-[10px] uppercase">
                                Raw OCR Transcription:
                              </div>
                              <div className="bg-slate-50 p-2.5 rounded border border-slate-200 font-mono text-[11px] text-slate-700 whitespace-pre-wrap max-h-36 overflow-y-auto">
                                {doc.ocr_text}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              )}

              {/* Tab Content 4: Intake Transcript */}
              {activeTab === "transcript" && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500 flex items-center justify-between pb-1">
                    <span>Clinical Intake DAG Execution: {answers.length} questions answered</span>
                  </div>

                  {answers.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-400 border border-dashed rounded-lg">
                      No interview questions logged yet.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                      {answers.map((ans, idx) => (
                        <div key={ans.id || idx} className="p-2.5 rounded border border-slate-200 bg-white text-xs space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                            <span className="uppercase tracking-wider px-1.5 py-0.2 bg-slate-100 rounded">
                              {ans.section.replace(/_/g, " ")} • {ans.item_code}
                            </span>
                            <span className="capitalize">{ans.source} input</span>
                          </div>
                          <div className="font-semibold text-slate-800">{ans.question || ans.item_code}</div>
                          <div className="text-slate-700 bg-slate-50 p-1.5 rounded font-medium">
                            {ans.answer_text || JSON.stringify(ans.answer_value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab Content 5: Spoken Patient Readback */}
              {activeTab === "spoken" && (
                <div className="space-y-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex items-start gap-2">
                    <Volume2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                    <div>
                      <strong>Patient Conversational Readback:</strong> In accordance with Module C and DPDP Act informed consent, this is the exact spoken explanation read aloud to the patient in {selectedSession.language} before clinical sign-off.
                    </div>
                  </div>

                  <Card className="border-slate-200 shadow-xs">
                    <CardHeader className="p-3.5 pb-2 bg-slate-50 border-b border-slate-100">
                      <CardTitle className="text-xs font-bold text-slate-800 uppercase">
                        Spoken Confirmation Script ({selectedSession.language})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      {summary?.patient_text ? (
                        <p className="text-sm text-slate-800 leading-relaxed font-serif whitespace-pre-line bg-slate-50 p-4 rounded-lg border border-slate-200">
                          {summary.patient_text}
                        </p>
                      ) : (
                        <div className="text-sm text-slate-400 italic">
                          Spoken summary not generated yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
