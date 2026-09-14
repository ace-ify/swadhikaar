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
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold font-heading tracking-tight text-slate-900 dark:text-white">
              Walk-In MediKiosk OPD Queue
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live OPD Clinic
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Real-time walk-in intake, Ayush Dashavidha Pariksha, and Prescription OCR. Review AI draft summaries, accept/amend/reject, or escalate acute emergency ambulances.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              fetchQueue();
            }}
            disabled={refreshing || loading}
            className="text-xs font-semibold border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 h-8 px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin text-emerald-600" : "text-slate-500"}`} />
            Refresh Feed
          </Button>
          <Button
            size="sm"
            onClick={() => window.open("/kiosk", "_blank")}
            className="text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white h-8 px-3.5 shadow-xs"
          >
            Open MediKiosk Station &rarr;
          </Button>
        </div>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1 shadow-xs">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500 font-mono">Total Walk-Ins</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">{stats.total}</div>
        </div>

        <div className={`rounded-xl border p-4 space-y-1 shadow-xs ${stats.redFlags > 0 ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20" : "border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-rose-700 dark:text-rose-400 font-mono flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            Red Flags
          </div>
          <div className={`text-2xl sm:text-3xl font-bold font-mono tracking-tight ${stats.redFlags > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"}`}>
            {stats.redFlags}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1 shadow-xs">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500 font-mono">Ready for Doctor</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">{stats.ready}</div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1 shadow-xs">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500 font-mono">In Kiosk Intake</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">{stats.inProgress}</div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1 shadow-xs">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500 font-mono">Consulted</div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-white tracking-tight">{stats.consulted}</div>
        </div>
      </div>

      {/* Main Split Layout: Queue List (Left) + Consultation Workspace (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Queue List */}
        <div className="lg:col-span-5 space-y-3.5">
          {/* Search & Filters */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <Input
                placeholder="Search patient, ABHA, phone, or symptom..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-10 text-xs rounded-xl border-slate-200 bg-white shadow-2xs focus:border-slate-900 font-medium"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "all", label: "All Cases" },
                { key: "red_flag", label: "Red Flag Priority", count: stats.redFlags },
                { key: "ready", label: "Ready", count: stats.ready },
                { key: "ayush", label: "AYUSH OPD" },
                { key: "in_progress", label: "In Intake" },
                { key: "consulted", label: "Consulted" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    statusFilter === f.key
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  {f.label}
                  {f.count !== undefined && f.count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] bg-rose-600 text-white font-mono">
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Queue Items */}
          <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
            {loading && sessions.length === 0 && (
              <div className="p-12 text-center text-xs font-medium text-slate-400">Loading walk-in queue...</div>
            )}

            {!loading && filteredSessions.length === 0 && (
              <div className="p-12 text-center text-xs font-medium text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                No walk-in sessions matching your filter criteria.
              </div>
            )}

            {filteredSessions.map((s) => {
              const isSelected = s.id === selectedSessionId;
              const pat = s.patient;

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-slate-900 bg-slate-50 dark:border-white dark:bg-slate-800 shadow-xs ring-1 ring-slate-900/10"
                      : s.red_flag
                      ? "border-rose-200 bg-rose-50/40 hover:bg-rose-50/70 shadow-2xs"
                      : "border-slate-200/80 bg-white hover:bg-slate-50/70 shadow-2xs"
                  }`}
                >
                  {/* Top line: Name & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                        {s.red_flag && (
                          <span className="h-2 w-2 rounded-full bg-rose-600 shrink-0 animate-pulse" />
                        )}
                        <span>{pat?.name || "Walk-In Patient"}</span>
                        {s.red_flag && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wider uppercase bg-rose-100 text-rose-800 border border-rose-200">
                            Red Flag
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 font-normal">
                        <span>{pat?.phone || "No phone"}</span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          ABHA: {pat?.abha_id || "Unlinked"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {s.status}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {timeAgo(s.started_at)}
                      </span>
                    </div>
                  </div>

                  {/* Red Flag alert snippet if present */}
                  {s.red_flag && s.red_flag_reason && (
                    <div className="mt-2.5 text-xs text-rose-800 bg-rose-100/60 p-2 rounded-lg border border-rose-200 font-medium flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 text-rose-600 shrink-0" />
                      <span>{s.red_flag_reason}</span>
                    </div>
                  )}

                  {/* Bottom tags */}
                  <div className="mt-2.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono uppercase text-[10px] text-slate-600 dark:text-slate-400 border border-slate-200/60">
                      {s.mode} OPD
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono uppercase text-[10px] text-slate-500 border border-slate-200/60">
                      {s.language}
                    </span>
                    {pat?.chronic_conditions && (
                      <span className="truncate max-w-[160px] text-slate-500 font-normal">
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
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 h-full min-h-[480px] flex flex-col items-center justify-center p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-900/30">
              <div className="size-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3 border border-slate-200 dark:border-slate-700">
                <Stethoscope className="w-7 h-7 text-slate-400" />
              </div>
              <h3 className="font-bold text-base text-slate-800 dark:text-slate-200 tracking-tight">Select a Walk-In Patient</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                Choose a case from the live queue to review automated clinical history, Ayush Dashavidha factors, and prescription OCR entities.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Patient Banner */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {selectedSession.patient?.name || "Walk-In Patient"}
                      </h2>
                      <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {selectedSession.mode.toUpperCase()} OPD
                      </span>
                      <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {selectedSession.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-2.5 font-normal">
                      <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">ABHA: {selectedSession.patient?.abha_id || "Unlinked"}</span>
                      <span>•</span>
                      <span>Phone: {selectedSession.patient?.phone || "N/A"}</span>
                      <span>•</span>
                      <span>Gender: {selectedSession.patient?.gender || "Not specified"}</span>
                      <span>•</span>
                      <span className="uppercase font-mono text-[11px] text-slate-500">Lang: {selectedSession.language}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleExportAbdm}
                      disabled={exportingFhir}
                      className="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg h-9 px-3.5 transition-colors gap-1.5 shadow-xs"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>{exportingFhir ? "Exporting..." : "Export ABDM FHIR"}</span>
                    </Button>
                  </div>
                </div>

                {/* Pre-existing conditions row */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                    <span className="text-slate-500 font-normal">Chronic Hx: </span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{selectedSession.patient?.chronic_conditions || "None reported"}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                    <span className="text-slate-500 font-normal">Known Allergies: </span>
                    <span className="text-rose-700 dark:text-rose-400 font-medium">
                      {selectedSession.patient?.allergies || "NKDA (None)"}
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                    <span className="text-slate-500 font-normal">Current Rx: </span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{selectedSession.patient?.current_medications || "None"}</span>
                  </div>
                </div>

                {/* Emergency Alert Callout (if red flag) */}
                {selectedSession.red_flag && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/80 dark:border-rose-900/60 dark:bg-rose-950/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-lg bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-800">
                        <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-rose-900 dark:text-rose-200 tracking-wider uppercase font-mono">
                          CLINICAL RED FLAG DETECTED
                        </div>
                        <div className="text-xs text-rose-700 dark:text-rose-400 font-normal mt-0.5">
                          {selectedSession.red_flag_reason || "Immediate clinical intervention required"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAmbulanceTracker(!showAmbulanceTracker)}
                        className="bg-white hover:bg-rose-50 border-rose-200 text-rose-800 font-medium text-xs rounded-lg h-8 px-3 shadow-2xs transition-colors"
                      >
                        <Ambulance className="w-3.5 h-3.5 mr-1.5 text-rose-600" />
                        {showAmbulanceTracker ? "Hide Tracker" : "Track Moving Ambulance"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleEmergencyDispatch}
                        disabled={escalatingAmbulance}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs rounded-lg h-8 px-3.5 shadow-xs transition-colors"
                      >
                        {escalatingAmbulance ? "Dispatching..." : "Dispatch Ambulance"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Live Moving Ambulance Tracker Panel */}
                {selectedSession.red_flag && showAmbulanceTracker && (
                  <div className="p-4 border border-rose-500/30 bg-slate-950 rounded-xl animate-in slide-in-from-top-2 space-y-2">
                    <div className="flex items-center justify-between pb-1 text-xs">
                      <span className="font-bold text-rose-400 flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
                        </span>
                        Live Moving Ambulance Telemetry (En Route to Kiosk)
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        Patient: {selectedSession.patient?.name || "Walk-In Patient"}
                      </span>
                    </div>
                    <div className="rounded-xl overflow-hidden border border-slate-800">
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
                  </div>
                )}
              </div>

              {/* Navigation Tabs Bar */}
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-1 flex items-center gap-1 overflow-x-auto scrollbar-thin bg-slate-100/80 dark:bg-slate-800/60">
                <button
                  onClick={() => setActiveTab("summary")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "summary"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Clinical SOAP Summary
                </button>
                {selectedSession.mode === "ayush" && (
                  <button
                    onClick={() => setActiveTab("dashavidha")}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                      activeTab === "dashavidha"
                        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Dashavidha Pariksha
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                      {factors.length}/10
                    </span>
                  </button>
                )}
                <button
                  onClick={() => setActiveTab("ocr")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "ocr"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Pill className="w-3.5 h-3.5" />
                  Prescriptions & OCR Labs
                  {documents.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono">
                      {documents.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("transcript")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "transcript"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Intake Transcript ({answers.length})
                </button>
                <button
                  onClick={() => setActiveTab("spoken")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "spoken"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Spoken Readback
                </button>
              </div>

              {/* Tab Content 1: Clinical SOAP Summary */}
              {activeTab === "summary" && (
                <div className="space-y-4">
                  {/* Governance Notice */}
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        <strong className="text-slate-900 dark:text-white font-bold">Clinical Governance:</strong> Draft summary generated from kiosk intake. AI never acts as an autonomous diagnostic authority; clinician review & sign-off is required.
                      </span>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold uppercase shrink-0 border ${
                        summary?.status === "accepted"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60"
                          : summary?.status === "amended"
                          ? "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60"
                          : summary?.status === "rejected"
                          ? "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60"
                          : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                      }`}
                    >
                      Status: {summary?.status || "Draft"}
                    </span>
                  </div>

                  {summary?.status === "accepted" && (
                    <div className="bg-emerald-50 border border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800/60 rounded-xl p-4 text-xs text-emerald-900 dark:text-emerald-300 flex items-center gap-2.5 shadow-xs font-medium">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span>
                        Verified and signed off by Clinician ({summary.reviewed_by ? "Attributed" : "Duty Physician"}) at {summary.reviewed_at ? new Date(summary.reviewed_at).toLocaleString("en-IN") : "Session Close"}.
                      </span>
                    </div>
                  )}

                  {detailLoading ? (
                    <div className="p-12 text-center text-xs font-bold text-slate-400">Loading clinical summary...</div>
                  ) : !summary ? (
                    <div className="p-12 text-center text-xs font-medium text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      No summary generated yet for this session. It will be created when the patient reaches Step 5 in MediKiosk.
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {/* Formatted Sections */}
                      {summary.sections?.map((sec, idx) => (
                        <div key={idx} className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-3 bg-white dark:bg-slate-900 shadow-xs">
                          <div className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-widest font-mono pb-2 border-b border-slate-100 dark:border-slate-800">
                            {sec.heading}
                          </div>
                          {sec.body && (
                            <p className="text-slate-700 dark:text-slate-300 text-xs sm:text-sm leading-relaxed whitespace-pre-line font-medium">
                              {sec.body}
                            </p>
                          )}
                          {sec.items && sec.items.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                              {sec.items.map((it, i) => (
                                <div key={i} className="bg-slate-50/70 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200/80 dark:border-slate-700/60">
                                  <div className="text-[10px] text-slate-400 font-mono font-medium">{it.label}</div>
                                  <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5">{it.value}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* If amended, display amended sections */}
                      {summary.amended_sections && (
                        <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20 p-5 space-y-2.5 shadow-xs">
                          <div className="text-xs font-bold text-amber-900 dark:text-amber-400 uppercase tracking-wider font-mono">
                            Clinician Amendments & Annotations
                          </div>
                          <div className="whitespace-pre-line font-mono text-[11px] text-amber-950 dark:text-amber-300">
                            {JSON.stringify(summary.amended_sections, null, 2)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Doctor Sign-off Actions Bar */}
                  {summary && summary.status === "draft" && (
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-5 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                      <div className="font-bold text-xs uppercase tracking-wider text-slate-500 font-mono flex items-center gap-2">
                        <Stethoscope className="w-4 h-4 text-emerald-600" />
                        Clinical Governance Decision:
                      </div>

                      {reviewMode === "idle" && (
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Button
                            onClick={handleAccept}
                            disabled={submittingReview}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg h-9 px-4 shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5 mr-1.5" />
                            {submittingReview ? "Processing..." : "Accept Draft Summary"}
                          </Button>

                          <Button
                            variant="outline"
                            onClick={() => setReviewMode("amend")}
                            className="text-xs font-semibold border-amber-300 text-amber-800 hover:bg-amber-50 rounded-lg h-9 px-4"
                          >
                            <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                            Amend / Add Notes
                          </Button>

                          <Button
                            variant="outline"
                            onClick={() => setReviewMode("reject")}
                            className="text-xs font-semibold border-rose-300 text-rose-700 hover:bg-rose-50 rounded-lg h-9 px-4"
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1.5" />
                            Reject Summary
                          </Button>
                        </div>
                      )}

                      {reviewMode === "amend" && (
                        <div className="space-y-3 bg-amber-50/40 p-4 rounded-xl border border-amber-200">
                          <div className="text-xs font-bold text-amber-900">
                            Amend Clinician Summary / Append Doctor Consultation Notes
                          </div>
                          <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Type amended clinical notes, lab corrections, or revised triage recommendations..."
                            rows={4}
                            className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={handleAmend}
                              disabled={submittingReview}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg h-8 px-3"
                            >
                              Save Amendments & Sign Off
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReviewMode("idle")}
                              className="text-xs text-slate-600 h-8"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {reviewMode === "reject" && (
                        <div className="space-y-3 bg-rose-50/40 p-4 rounded-xl border border-rose-200">
                          <div className="text-xs font-bold text-rose-900">
                            Reason for Rejecting Automated Summary
                          </div>
                          <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="State clinical rationale for rejection (e.g. invalid vitals recorded, chief complaint mismatch)..."
                            rows={3}
                            className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-500 font-medium bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={handleReject}
                              disabled={submittingReview}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg h-8 px-3"
                            >
                              Confirm Rejection
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReviewMode("idle")}
                              className="text-xs text-slate-600 h-8"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tab Content 2: Dashavidha Pariksha */}
              {activeTab === "dashavidha" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                      <span className="font-bold text-slate-900 dark:text-white">Ayush Dashavidha Pariksha (दशविध परीक्षा)</span>
                      <span className="text-slate-500 dark:text-slate-400 ml-1">Classical ten-fold clinical examination framework from Charaka Samhita & Ashtanga Hridaya.</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-mono font-bold text-[11px] shadow-xs shrink-0">
                      {factors.length} Recorded Factors
                    </span>
                  </div>

                  {factors.length === 0 ? (
                    <div className="p-12 text-center text-xs font-medium text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
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
                          <div key={f.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-2.5 bg-white dark:bg-slate-900 shadow-xs">
                            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                              <div>
                                <div className="text-xs font-bold text-slate-900 dark:text-white">
                                  {meta.title}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                                  {meta.eng}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold capitalize text-[11px] font-mono">
                                {f.value ? f.value.replace(/_/g, " ") : "Not evaluated"}
                              </span>
                            </div>

                            {f.detail && (
                              <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60 font-medium leading-relaxed">
                                <span className="text-slate-400 text-[10px] font-mono uppercase block mb-0.5">Patient Observation:</span>
                                {typeof f.detail === "string"
                                  ? f.detail
                                  : f.detail.reason || JSON.stringify(f.detail)}
                              </div>
                            )}

                            <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 font-mono">
                              <span>Source: {f.source}</span>
                              <span>{new Date(f.recorded_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </div>
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
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-4 flex items-start gap-3 text-xs text-slate-800 dark:text-slate-200 shadow-xs">
                    <div className="size-8 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertCircle className="size-4 text-slate-700 dark:text-slate-300" />
                    </div>
                    <div>
                      <strong className="text-slate-900 dark:text-white font-bold">Formulary Safety Cross-Check (Module B):</strong>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed font-medium">
                        Prescriptions and active medications cross-checked against 24 primary care interaction pairs (Metformin + Iodinated Contrast, ACE-I + K-sparing diuretics, NSAIDs + Anticoagulants, Ayush Rasashastra preparations).
                      </p>
                    </div>
                  </div>

                  {documents.length === 0 ? (
                    <div className="p-12 text-center text-xs font-medium text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      No prescription or lab documents scanned during this kiosk session.
                    </div>
                  ) : (
                    documents.map((doc) => (
                      <div key={doc.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 bg-white dark:bg-slate-900 shadow-xs">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                          <div>
                            <div className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-widest font-mono">
                              {doc.doc_type?.replace(/_/g, " ") || "Scanned Clinical Document"}
                            </div>
                            <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                              Document Date: {doc.doc_date || "Not detected on paper"} • Status: <span className="font-mono text-emerald-700 dark:text-emerald-400 font-bold">{doc.status}</span>
                            </div>
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
                            OCR Processed
                          </span>
                        </div>

                        {/* Extracted Entities */}
                        {doc.entities && doc.entities.length > 0 && (
                          <div className="space-y-2">
                            <div className="font-bold text-slate-400 text-[10px] uppercase tracking-widest font-mono">
                              Extracted Medications & Laboratory Analytes:
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {doc.entities.map((ent) => (
                                <div
                                  key={ent.id}
                                  className={`p-3 rounded-lg border ${
                                    ent.out_of_range
                                      ? "bg-rose-50/70 border-rose-200/80 text-rose-950 dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-300"
                                      : "bg-slate-50/70 border-slate-200/80 text-slate-900 dark:bg-slate-800/60 dark:border-slate-700/60 dark:text-slate-200"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-xs">{ent.name}</span>
                                    {ent.out_of_range && (
                                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-rose-600 text-white">
                                        Abnormal
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs mt-1">
                                    <span className="font-bold text-slate-900 dark:text-white">{ent.value || "N/A"}</span>{" "}
                                    <span className="text-slate-500 font-mono text-[10px]">{ent.unit || ""}</span>
                                  </div>
                                  {(ent.ref_low !== null || ent.ref_high !== null) && (
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                      Ref Range: {ent.ref_low ?? "0"} - {ent.ref_high ?? "—"} {ent.unit}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Raw OCR Text Snippet */}
                        {doc.ocr_text && (
                          <div className="space-y-1.5 pt-1">
                            <div className="font-bold text-slate-400 text-[10px] uppercase tracking-widest font-mono">
                              Raw OCR Transcription:
                            </div>
                            <div className="bg-slate-50/80 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed">
                              {doc.ocr_text}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab Content 4: Intake Transcript */}
              {activeTab === "transcript" && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 flex items-center justify-between pb-1 font-mono font-bold">
                    <span>DAG Execution: {answers.length} logged items</span>
                  </div>

                  {answers.length === 0 ? (
                    <div className="p-12 text-center text-xs font-medium text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      No interview questions logged yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                      {answers.map((ans, idx) => (
                        <div key={ans.id || idx} className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-1.5 shadow-xs">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium font-mono">
                            <span className="uppercase tracking-wider px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-bold text-slate-600 dark:text-slate-300">
                              {ans.section.replace(/_/g, " ")} • {ans.item_code}
                            </span>
                            <span className="capitalize">{ans.source} input</span>
                          </div>
                          <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">{ans.question || ans.item_code}</div>
                          <div className="text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg font-medium border border-slate-100 dark:border-slate-800">
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
                <div className="space-y-4">
                  <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 dark:border-sky-900/50 dark:bg-sky-950/20 p-4 flex items-start gap-3 text-xs text-sky-950 dark:text-sky-300 shadow-xs">
                    <div className="size-8 rounded-lg bg-sky-500/20 text-sky-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Volume2 className="size-4 text-sky-700" />
                    </div>
                    <div>
                      <strong className="text-sky-950 dark:text-sky-300 font-bold">Patient Conversational Readback (DPDP Act 2023):</strong>
                      <p className="text-sky-900/80 dark:text-sky-400 mt-0.5 leading-relaxed font-medium">
                        In accordance with Module C and informed consent, this is the exact spoken explanation read aloud to the patient in {selectedSession.language} before clinical sign-off.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-5 bg-white dark:bg-slate-900 shadow-xs space-y-3">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono pb-2 border-b border-slate-100 dark:border-slate-800">
                      Spoken Confirmation Script ({selectedSession.language})
                    </div>
                    <div>
                      {summary?.patient_text ? (
                        <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line bg-slate-50/70 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 font-medium">
                          {summary.patient_text}
                        </p>
                      ) : (
                        <div className="text-xs text-slate-400 italic p-4 text-center">
                          Spoken summary not generated yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
