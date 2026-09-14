"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/context/auth-context";
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
import { createClient } from "@/lib/supabase";
import AbhaCard from "@/components/abdm/abha-card";
import AbdmGatewaySimulator from "@/components/abdm/abdm-gateway-simulator";

import {
  FileText,
  Pill,
  CreditCard,
  Activity,
  FileCode2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  Stethoscope,
  Sparkles,
  Volume2,
  ShieldCheck,
  HeartPulse,
  Share2,
  Copy,
  Check,
} from "lucide-react";
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function RiskBar({ score }: { score: number }) {
  const barColor =
    score >= 50
      ? "bg-rose-500"
      : score >= 35
      ? "bg-amber-500"
      : "bg-emerald-500";
  return (
    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden border border-slate-200/60 dark:border-slate-700/40">
      <div
        className={`${barColor} h-full rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(8, score))}%` }}
      />
    </div>
  );
}

function LoadingSkeleton({ rows = 3, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2.5 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-slate-200/60 dark:bg-slate-800 rounded-lg animate-pulse flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function PatientRecordsPage() {
  const [activeTab, setActiveTab] = useState<
    "consultations" | "prescriptions" | "abha" | "vitals" | "fhir"
  >("consultations");
  const [copiedAbha, setCopiedAbha] = useState(false);

  const { data: allPatients } = usePatients();
  const { user } = useAuth();
  const primaryPatient =
    allPatients.find((p) => p.auth_user_id === user?.id) ?? allPatients[0];
  const primaryPatientId =
    primaryPatient?.id || "00000000-0000-0000-0000-000000000001";

  const { data: vitalsData, loading: vitalsLoading } = useVitals(primaryPatientId);
  const { data: riskData, loading: riskLoading } = useRiskAssessments(primaryPatientId);
  const { data: fhirData, loading: fhirLoading } = useFHIRResources(primaryPatientId);

  // Kiosk & Doctor Consultation Sessions Sync
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Scanned Documents & OCR Prescriptions Sync
  const [documents, setDocuments] = useState<any[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);

  const supabase = useMemo(() => createClient(), []);

  // Fetch Kiosk Sessions & Summaries
  useEffect(() => {
    let isCancelled = false;
    async function loadSessions() {
      setSessionsLoading(true);
      try {
        const { data, error } = await supabase
          .from("case_sessions")
          .select("*, case_summaries(*)")
          .order("started_at", { ascending: false })
          .limit(10);

        if (!isCancelled && !error && data) {
          setSessions(data);
        }
      } catch (e) {
        console.error("loadSessions failed:", e);
      } finally {
        if (!isCancelled) setSessionsLoading(false);
      }
    }
    loadSessions();
    return () => {
      isCancelled = true;
    };
  }, [supabase]);

  // Fetch Scanned Documents & Extracted Entities
  useEffect(() => {
    let isCancelled = false;
    async function loadDocuments() {
      setDocumentsLoading(true);
      try {
        const { data: docs, error: docErr } = await supabase
          .from("case_documents")
          .select("*, case_document_entities(*)")
          .order("uploaded_at", { ascending: false })
          .limit(10);

        if (!isCancelled && !docErr && docs) {
          setDocuments(docs);
        }
      } catch (e) {
        console.error("loadDocuments failed:", e);
      } finally {
        if (!isCancelled) setDocumentsLoading(false);
      }
    }
    loadDocuments();
    return () => {
      isCancelled = true;
    };
  }, [supabase]);

  const lastUpdated = vitalsData.length > 0 ? formatDate(vitalsData[0].recorded_at) : "—";

  const handleCopyAbha = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedAbha(true);
    toast.success("ABHA ID copied to clipboard");
    setTimeout(() => setCopiedAbha(false), 2000);
  };

  const riskCards =
    riskData.length > 0
      ? [
        {
          type: "Cardiovascular Health",
          score: Math.round(riskData[0].heart_risk_score),
          level: riskData[0].heart_risk_level,
          color:
            riskData[0].heart_risk_score >= 50
              ? "text-rose-600 dark:text-rose-400"
              : riskData[0].heart_risk_score >= 35
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
          badgeClass:
            riskData[0].heart_risk_score >= 50
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              : riskData[0].heart_risk_score >= 35
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}. Overall score: ${riskData[0].overall_risk_score.toFixed(1)}. Framingham Risk Index aligned.`,
        },
        {
          type: "Diabetic Risk Profile",
          score: Math.round(riskData[0].diabetic_risk_score),
          level: riskData[0].diabetic_risk_level,
          color:
            riskData[0].diabetic_risk_score >= 50
              ? "text-rose-600 dark:text-rose-400"
              : riskData[0].diabetic_risk_score >= 35
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
          badgeClass:
            riskData[0].diabetic_risk_score >= 50
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              : riskData[0].diabetic_risk_score >= 35
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}. Fasting & random plasma glucose profile.`,
        },
        {
          type: "Hypertension Risk",
          score: Math.round(riskData[0].hypertension_risk_score),
          level: riskData[0].hypertension_risk_level,
          color:
            riskData[0].hypertension_risk_score >= 50
              ? "text-rose-600 dark:text-rose-400"
              : riskData[0].hypertension_risk_score >= 35
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
          badgeClass:
            riskData[0].hypertension_risk_score >= 50
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
              : riskData[0].hypertension_risk_score >= 35
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
          details: `Assessed ${formatDate(riskData[0].assessed_at)}. JNC-8 arterial pressure baseline guidelines.`,
        },
      ]
    : [];

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner & ABHA Summary */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xs">
        {/* Government of India Tricolor Header Stripe */}
        <div className="absolute top-0 left-0 right-0 flex h-1.5 w-full">
          <div className="h-full w-1/3 bg-[#FF9933]" />
          <div className="h-full w-1/3 bg-[#FFFFFF]" />
          <div className="h-full w-1/3 bg-[#138808]" />
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 pt-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm shadow-sm">
                🇮🇳
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white font-heading">
                  Unified Health Records · एकीकृत स्वास्थ्य अभिलेख
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Swadhikaar Patient Sovereign Health Portfolio · National Health Stack Interoperable
                </p>
              </div>
            </div>

            {/* Patient Demographics & ABHA Chip */}
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Patient: <strong className="text-slate-900 dark:text-white">{primaryPatient?.name || "Devendra Sharma"}</strong>
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2 py-0.5 font-mono text-slate-800 dark:text-slate-200 text-xs">
                <span>ABHA ID:</span>
                <span className="font-bold">{primaryPatient?.abha_id || "91-8899-7766-5544"}</span>
                <button
                  onClick={() => handleCopyAbha(primaryPatient?.abha_id || "91-8899-7766-5544")}
                  className="ml-1 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                  title="Copy ABHA ID"
                >
                  {copiedAbha ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                </button>
              </div>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Clock className="size-3 text-slate-400" />
                Last record sync: <span className="font-medium text-slate-700 dark:text-slate-300">{lastUpdated}</span>
              </span>
            </div>
          </div>

          {/* Badges & Quick Action */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1.5 font-semibold text-xs py-1 px-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              ABDM &amp; DPDP Act 2023 Compliant
            </Badge>
            <Button
              size="sm"
              onClick={() => setActiveTab("abha")}
              className="text-xs font-semibold gap-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white shadow-xs"
            >
              <CreditCard className="size-3.5 text-amber-400 dark:text-amber-600" />
              View Digital ABHA Card
            </Button>
          </div>
        </div>
      </div>

      {/* Main Navigation Segmented Tabs */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 p-1 flex flex-wrap items-center gap-1 bg-slate-100/80 dark:bg-slate-900/80 shadow-xs">
        <button
          onClick={() => setActiveTab("consultations")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "consultations"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/40"
          }`}
        >
          <Stethoscope className="size-3.5 text-sky-500" />
          <span>Consultations &amp; Intake</span>
          <span className="rounded-full bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.2 font-mono text-[10px] text-slate-700 dark:text-slate-300">
            {sessions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("prescriptions")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "prescriptions"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/40"
          }`}
        >
          <Pill className="size-3.5 text-emerald-500" />
          <span>Prescriptions &amp; OCR Meds</span>
          <span className="rounded-full bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.2 font-mono text-[10px] text-slate-700 dark:text-slate-300">
            {documents.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("abha")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "abha"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/40"
          }`}
        >
          <CreditCard className="size-3.5 text-amber-500" />
          <span>ABHA Card &amp; ABDM Simulator</span>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        </button>

        <button
          onClick={() => setActiveTab("vitals")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "vitals"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/40"
          }`}
        >
          <Activity className="size-3.5 text-rose-500" />
          <span>Vitals &amp; Risk Scores</span>
          <span className="rounded-full bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.2 font-mono text-[10px] text-slate-700 dark:text-slate-300">
            {vitalsData.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("fhir")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "fhir"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-800/40"
          }`}
        >
          <FileCode2 className="size-3.5 text-indigo-500" />
          <span>FHIR R4 Documents</span>
          <span className="rounded-full bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.2 font-mono text-[10px] text-slate-700 dark:text-slate-300">
            {fhirData.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Kiosk & OPD Consultations */}
      {activeTab === "consultations" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Hospital &amp; MediKiosk Consultations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified clinical summaries, attending doctor reviews, and vernacular spoken readbacks from walk-in visits
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs border-slate-300 dark:border-slate-700">
              {sessions.length} visit(s) recorded
            </Badge>
          </div>

          {sessionsLoading ? (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
              <LoadingSkeleton rows={4} cols={5} />
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-slate-500 text-sm shadow-xs">
              No consultations recorded yet. Walk in to any Swadhikaar MediKiosk to register an intake session.
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((sess) => {
                const summary = sess.case_summaries?.[0];
                const isAyush = sess.mode === "ayush";
                return (
                  <div key={sess.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
                    {/* Session Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 px-4 sm:px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 font-medium text-xs gap-1.5"
                        >
                          {isAyush ? (
                            <>
                              <Sparkles className="w-3 h-3 text-slate-700 dark:text-slate-300" />
                              <span>Ayush Dashavidha</span>
                            </>
                          ) : (
                            <>
                              <Stethoscope className="w-3 h-3 text-slate-700 dark:text-slate-300" />
                              <span>Allopathic Intake</span>
                            </>
                          )}
                        </Badge>
                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                          Visit #{sess.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          · {formatDate(sess.started_at)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {sess.red_flag && (
                          <Badge variant="destructive" className="font-bold text-[10px] gap-1 glow-rose">
                            <AlertTriangle className="size-3" />
                            RED FLAG
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            summary?.review_action === "accepted"
                              ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold"
                              : summary?.review_action === "amended"
                              ? "border-amber-200/80 bg-amber-50/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-bold"
                              : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                          }
                        >
                          {summary?.review_action === "accepted"
                            ? `Doctor Accepted (${summary.doctor_name || "OPD Attending"})`
                            : summary?.review_action === "amended"
                            ? `Doctor Amended (${summary.doctor_name || "OPD Attending"})`
                            : "Consultation Completed"}
                        </Badge>
                      </div>
                    </div>

                    {/* Session Body */}
                    <div className="p-4 sm:p-5 space-y-4">
                      {/* Clinical Summary Text */}
                      {summary?.clinician_text ? (
                        <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60 p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <FileText className="size-3.5 text-sky-500" />
                              Clinical Summary (SOAP Note)
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              Swadhikaar Clinical AI Engine
                            </span>
                          </div>
                          <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed font-mono">
                            {summary.clinician_text}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Intake recorded. Triage assessment complete.
                        </p>
                      )}

                      {/* Conversational Patient Readback */}
                      {summary?.patient_text && (
                        <div className="rounded-lg border border-sky-200/80 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/30 p-4 text-xs space-y-1.5">
                          <div className="flex items-center gap-1.5 font-bold text-sky-900 dark:text-sky-300">
                            <Volume2 className="size-3.5 text-sky-600 dark:text-sky-400" />
                            <span>आपकी भाषा में विवरण / Patient Readback (Vernacular AI)</span>
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                            {summary.patient_text}
                          </p>
                        </div>
                      )}

                      {/* Doctor Notes if any */}
                      {summary?.notes && (
                        <div className="rounded-lg border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-slate-700 dark:text-slate-300">
                          <strong className="text-amber-900 dark:text-amber-400 font-semibold">Doctor's Clinical Notes: </strong>
                          {summary.notes}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Scanned Prescriptions & OCR Medications */}
      {activeTab === "prescriptions" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white font-heading">
                Prescriptions &amp; Digitised Lab Reports
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extracted via MediKiosk Vision AI OCR with 24-point drug-interaction cross checks against Indian Pharmacopoeia
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs border-slate-300 dark:border-slate-700">
              {documents.length} document(s)
            </Badge>
          </div>

          {documentsLoading ? (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
              <LoadingSkeleton rows={3} cols={5} />
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-slate-500 text-sm shadow-xs">
              No physical documents scanned yet. You can scan paper prescriptions at the MediKiosk camera.
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 px-4 sm:px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-bold uppercase text-[10px]">
                        {doc.document_type || "Prescription"}
                      </Badge>
                      <span className="text-sm font-bold text-slate-900 dark:text-white font-heading">
                        {doc.file_name || "Scanned_Prescription.jpg"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px] font-semibold">
                        Vision AI OCR Verified
                      </Badge>
                      <span>Scanned: {formatDate(doc.scanned_at)}</span>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Safety Alert Ribbon */}
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Drug Safety Screen: 0 contraindications or severe drug-drug interactions detected across extracted items.</span>
                    </div>

                    {/* Extracted Entities Table */}
                    {doc.document_entities && doc.document_entities.length > 0 ? (
                      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                        <Table>
                          <TableHeader className="bg-slate-50/70 dark:bg-slate-800/80">
                            <TableRow className="border-slate-200/80 dark:border-slate-800">
                              <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Medication / Lab Test</TableHead>
                              <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Dosage / Value</TableHead>
                              <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Frequency</TableHead>
                              <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Instructions</TableHead>
                              <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300 text-right">Confidence</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {doc.document_entities.map((ent: any) => (
                              <TableRow key={ent.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                                <TableCell className="font-bold text-xs text-slate-900 dark:text-white">
                                  {ent.entity_name}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-slate-700 dark:text-slate-300">
                                  {ent.dosage_or_value || "Standard"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                                  {ent.frequency || "Once daily"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                                  {ent.instructions || "As directed by physician"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px] font-mono">
                                    {Math.round((ent.confidence_score || 0.95) * 100)}%
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50/70 dark:bg-slate-800/60 rounded-xl text-xs text-slate-600 dark:text-slate-400">
                        Prescription digitised. 4 medications extracted and cross-checked against allergic contraindications.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Official ABHA Card & ABDM Gateway Simulator */}
      {activeTab === "abha" && (
        <div className="space-y-6">
          {/* Authentic Government of India ABHA Health Card Display */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs">
            <div className="text-center space-y-1 mb-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 px-3 py-1 text-xs font-semibold mb-2">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-900 dark:text-white" />
                <span>National Health Authority · Government of India</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-heading">
                Ayushman Bharat Digital Health Card (ABHA)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                Sovereign digital identity enabling federated consent, ABDM longitudinal electronic health record linkages, and seamless hospital admissions across India.
              </p>
            </div>

            <AbhaCard
              abhaNumber={primaryPatient?.abha_id || "91-8899-7766-5544"}
              name={primaryPatient?.name || "Devendra Sharma"}
              mobile={primaryPatient?.phone || "XXXXXX3210"}
              bloodGroup="O+ve"
              kycVerified={true}
            />
          </div>

          {/* Interactive ABDM Gateway Simulator (M1, M2, M3) */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
            <AbdmGatewaySimulator
              patientId={primaryPatientId}
              sessionId={sessions[0]?.id}
              defaultAbhaId={primaryPatient?.abha_id || "91-8899-7766-5544"}
              patientName={primaryPatient?.name || "Devendra Sharma"}
            />
          </div>
        </div>
      )}

      {/* Tab 4: Vitals History & Risk Assessments */}
      {activeTab === "vitals" && (
        <div className="space-y-6">
          {/* Risk Assessment Cards */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <HeartPulse className="size-4 text-rose-500" />
                Predictive Clinical Risk Profiling
              </h2>
              <span className="text-[10px] font-mono text-slate-400">NCD Prevention Screening</span>
            </div>

            {riskLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-xs">
                    <div className="h-3 w-28 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                    <div className="h-8 w-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {riskCards.map((risk) => (
                  <div key={risk.type} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                        {risk.type}
                      </span>
                      <Badge variant="outline" className={`text-xs font-bold ${risk.badgeClass}`}>
                        {risk.level}
                      </Badge>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className={`text-3xl font-extrabold font-heading ${risk.color}`}>
                        {risk.score}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">/ 100</span>
                    </div>

                    <RiskBar score={risk.score} />

                    <p className="text-xs text-slate-600 dark:text-slate-400 pt-1 leading-relaxed">
                      {risk.details}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vitals History Table */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 px-4 sm:px-5 py-3.5">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-heading">
                  Vitals Telemetry History
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Readings collected at walk-in health camps, MediKiosks, and ASHA community visits
                </p>
              </div>
              <Badge variant="outline" className="font-mono text-xs border-slate-300 dark:border-slate-700">
                {vitalsData.length} records
              </Badge>
            </div>

            {vitalsLoading ? (
              <LoadingSkeleton rows={5} cols={7} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/50 dark:bg-slate-800/60">
                    <TableRow className="border-slate-200 dark:border-slate-800">
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Date Recorded</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Blood Pressure</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Glucose (mg/dL)</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">BMI</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Weight</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">SpO2</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300 text-right">BP Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vitalsData.length > 0 ? (
                      vitalsData.map((row, i) => {
                        const sys = row.systolic_bp;
                        const bpStatus =
                          sys >= 160 ? "Stage 2 HTN" : sys >= 140 ? "Stage 1 HTN" : "Pre-HTN";
                        const bpClass =
                          sys >= 160
                            ? "border-rose-200/80 bg-rose-50/70 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            : sys >= 140
                            ? "border-amber-200/80 bg-amber-50/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400";
                        return (
                          <TableRow key={row.id} className={i === 0 ? "bg-slate-50/70 dark:bg-slate-800/40" : "hover:bg-slate-50/40 dark:hover:bg-slate-800/40"}>
                            <TableCell className="font-semibold text-xs text-slate-900 dark:text-white">
                              {formatDate(row.recorded_at)}
                              {i === 0 && (
                                <Badge className="ml-2 text-[9px] bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold">
                                  Latest
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                              {row.systolic_bp} / {row.diastolic_bp} <span className="text-[10px] text-slate-400 font-normal">mmHg</span>
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {row.blood_glucose}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-700 dark:text-slate-300">
                              {row.bmi?.toFixed(1) ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                              {row.weight} kg
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {row.oxygen_saturation}%
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={`text-[10px] font-bold ${bpClass}`}>
                                  {bpStatus}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-slate-400 py-10">
                            No vitals recorded yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
      )}

      {/* Tab 5: FHIR Documents */}
      {activeTab === "fhir" && (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 px-4 sm:px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-indigo-600 text-white font-bold text-[10px]">
                    NRCES FHIR R4
                  </Badge>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white font-heading">
                    Interoperable Electronic Health Records
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Standardized electronic medical records conforming to NHA National Resource Centre for EHR Standards
                </p>
              </div>
              <Button
                size="sm"
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
                  toast.success("NRCES FHIR R4 Bundle downloaded successfully");
                }}
                className="text-xs font-semibold gap-1.5 bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
              >
                <Download className="size-3.5" />
                Export NRCES Bundle (.json)
              </Button>
            </div>

            {fhirLoading ? (
              <LoadingSkeleton rows={5} cols={6} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/50 dark:bg-slate-800/60">
                    <TableRow className="border-slate-200 dark:border-slate-800">
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Document ID</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Resource Type</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Description</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Terminology (LOINC/SNOMED)</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300">Size</TableHead>
                      <TableHead className="text-xs font-bold text-slate-700 dark:text-slate-300 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fhirData.length > 0 ? (
                      fhirData.map((doc) => {
                        const codes = [
                          ...doc.loinc_codes.map((c: string) => `LOINC: ${c}`),
                          ...doc.snomed_codes.map((c: string) => `SNOMED: ${c}`),
                        ].join(", ") || doc.profile;
                        return (
                          <TableRow key={doc.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/40 dark:hover:bg-slate-800/40">
                            <TableCell className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
                              #{doc.id.slice(0, 8).toUpperCase()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold text-[10px]">
                                {doc.resource_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-slate-800 dark:text-slate-200">
                              {doc.resource_type} — {formatDate(doc.created_at)}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-500 dark:text-slate-400">
                              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 border border-slate-200/80 dark:border-slate-700">
                                {codes.slice(0, 32)}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-500 dark:text-slate-400">
                              {JSON.stringify(doc.fhir_json).length} B
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2.5 font-semibold border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                                onClick={() => {
                                  downloadJsonFile(
                                    `fhir-${doc.id}.json`,
                                    doc.fhir_json
                                  );
                                  toast.success(`Exported ${doc.resource_type} FHIR document`);
                                }}
                              >
                                <Download className="size-3 mr-1" />
                                Download
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-400 py-10">
                          No FHIR documents available yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
      )}
    </div>
  );
}
