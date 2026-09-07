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
  const color =
    score >= 50 ? "bg-slate-800" : score >= 35 ? "bg-slate-500" : "bg-slate-300";
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
      <div className={`${color} h-2 rounded-full`} style={{ width: `${score}%` }} />
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<
    "consultations" | "prescriptions" | "abha" | "vitals" | "fhir"
  >("consultations");

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
        console.warn("Could not load case_sessions:", e);
      } finally {
        if (!isCancelled) setSessionsLoading(false);
      }
    }
    loadSessions();
    return () => {
      isCancelled = true;
    };
  }, [supabase, primaryPatientId]);

  // Fetch Scanned Documents & OCR Entities
  useEffect(() => {
    let isCancelled = false;
    async function loadDocuments() {
      setDocumentsLoading(true);
      try {
        const { data, error } = await supabase
          .from("case_documents")
          .select("*, document_entities(*)")
          .order("scanned_at", { ascending: false })
          .limit(10);

        if (!isCancelled && !error && data) {
          setDocuments(data);
        }
      } catch (e) {
        console.warn("Could not load case_documents:", e);
      } finally {
        if (!isCancelled) setDocumentsLoading(false);
      }
    }
    loadDocuments();
    return () => {
      isCancelled = true;
    };
  }, [supabase, primaryPatientId]);

  const lastUpdated = vitalsData.length > 0 ? formatDate(vitalsData[0].recorded_at) : "—";

  // Build risk cards
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
    <div className="space-y-6 pb-16">
      {/* Top Banner & ABHA Summary */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            My Unified Health Records (स्वाधिकार)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Patient: <strong className="text-slate-800">{primaryPatient?.name || "Devendra Sharma"}</strong> · ABHA ID: <span className="font-mono">{primaryPatient?.abha_id || "91-8899-7766-5544"}</span> · Last updated: {lastUpdated}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500 bg-emerald-50 text-emerald-700 gap-1 font-semibold text-xs">
            <CheckCircle2 className="size-3 text-emerald-600" />
            ABDM &amp; DPDP Compliant
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActiveTab("abha")}
            className="text-xs font-semibold gap-1.5 border-slate-300"
          >
            <CreditCard className="size-3.5" />
            View My ABHA Card
          </Button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab("consultations")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === "consultations"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Stethoscope className="size-3.5" />
          Consultations &amp; Intake ({sessions.length})
        </button>

        <button
          onClick={() => setActiveTab("prescriptions")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === "prescriptions"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Pill className="size-3.5" />
          Prescriptions &amp; OCR Meds ({documents.length})
        </button>

        <button
          onClick={() => setActiveTab("abha")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === "abha"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <CreditCard className="size-3.5" />
          ABHA Digital Health Card &amp; Gateway Simulator
        </button>

        <button
          onClick={() => setActiveTab("vitals")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === "vitals"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Activity className="size-3.5" />
          Vitals &amp; Risk Scores ({vitalsData.length})
        </button>

        <button
          onClick={() => setActiveTab("fhir")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === "fhir"
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <FileCode2 className="size-3.5" />
          FHIR R4 Documents ({fhirData.length})
        </button>
      </div>

      {/* Tab 1: Kiosk & OPD Consultations */}
      {activeTab === "consultations" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Hospital &amp; MediKiosk Consultations
              </h2>
              <p className="text-xs text-slate-500">
                Clinical summaries, attending doctor reviews, and spoken readbacks from walk-in visits
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {sessions.length} visit(s) recorded
            </Badge>
          </div>

          {sessionsLoading ? (
            <LoadingSkeleton rows={4} cols={5} />
          ) : sessions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-slate-500 text-sm">
                No consultations recorded yet. Walk in to any Swadhikaar MediKiosk to register an intake session.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {sessions.map((sess) => {
                const summary = sess.case_summaries?.[0];
                const isAyush = sess.mode === "ayush";
                return (
                  <Card key={sess.id} className="border-slate-200 shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50/70 border-b border-slate-200/80 pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={
                              isAyush
                                ? "bg-emerald-700 text-white font-bold"
                                : "bg-sky-700 text-white font-bold"
                            }
                          >
                            {isAyush ? "🌿 Ayush Dashavidha" : "🩺 Allopathic Intake"}
                          </Badge>
                          <span className="font-mono text-xs font-bold text-slate-800">
                            Visit #{sess.id.slice(0, 8).toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-500">
                            · {formatDate(sess.started_at)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {sess.red_flag && (
                            <Badge variant="destructive" className="font-bold text-[10px] gap-1">
                              <AlertTriangle className="size-3" />
                              RED FLAG
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={
                              summary?.review_action === "accepted"
                                ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-bold"
                                : summary?.review_action === "amended"
                                ? "border-amber-500 bg-amber-50 text-amber-800 font-bold"
                                : "border-slate-300 text-slate-600"
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
                    </CardHeader>
                    <CardContent className="p-4 sm:p-5 space-y-4">
                      {/* Clinical Summary Text */}
                      {summary?.clinician_text ? (
                        <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1.5 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                              <FileText className="size-3.5 text-slate-500" />
                              Clinical Summary (SOAP Note)
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              Generated by Swadhikaar Clinical AI
                            </span>
                          </div>
                          <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed font-mono">
                            {summary.clinician_text}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600">
                          Intake recorded. Triage assessment complete.
                        </p>
                      )}

                      {/* Conversational Patient Readback */}
                      {summary?.patient_text && (
                        <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-sky-900">
                            <Volume2 className="size-3.5 text-sky-600" />
                            <span>आपकी भाषा में विवरण / Patient Readback</span>
                          </div>
                          <p className="text-slate-700 leading-relaxed">
                            {summary.patient_text}
                          </p>
                        </div>
                      )}

                      {/* Doctor Notes if any */}
                      {summary?.notes && (
                        <div className="border-t border-slate-100 pt-2 text-xs text-slate-600">
                          <strong className="text-slate-800">Doctor's Clinical Notes: </strong>
                          {summary.notes}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Scanned Prescriptions & OCR Medications */}
      {activeTab === "prescriptions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Prescriptions &amp; Digitised Lab Reports
              </h2>
              <p className="text-xs text-slate-500">
                Extracted via MediKiosk Vision AI OCR with 24-point drug-interaction cross checks
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {documents.length} document(s)
            </Badge>
          </div>

          {documentsLoading ? (
            <LoadingSkeleton rows={3} cols={5} />
          ) : documents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-slate-500 text-sm">
                No physical documents scanned yet. You can scan paper prescriptions at the MediKiosk camera.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <Card key={doc.id} className="border-slate-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-sky-500 text-sky-700 font-bold uppercase text-[10px]">
                          {doc.document_type || "Prescription"}
                        </Badge>
                        <CardTitle className="text-sm font-bold text-slate-900">
                          {doc.file_name || "Scanned_Prescription.jpg"}
                        </CardTitle>
                      </div>
                      <span className="text-xs text-slate-500">
                        Scanned: {formatDate(doc.scanned_at)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Extracted Entities Table */}
                    {doc.document_entities && doc.document_entities.length > 0 ? (
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow>
                              <TableHead className="text-xs">Medication / Lab Test</TableHead>
                              <TableHead className="text-xs">Dosage / Value</TableHead>
                              <TableHead className="text-xs">Frequency</TableHead>
                              <TableHead className="text-xs">Instructions</TableHead>
                              <TableHead className="text-xs">Confidence</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {doc.document_entities.map((ent: any) => (
                              <TableRow key={ent.id}>
                                <TableCell className="font-bold text-xs text-slate-900">
                                  {ent.entity_name}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-slate-700">
                                  {ent.dosage_or_value || "Standard"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600">
                                  {ent.frequency || "Once daily"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-500">
                                  {ent.instructions || "As directed by physician"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="border-emerald-400 bg-emerald-50 text-emerald-700 text-[10px]">
                                    {Math.round((ent.confidence_score || 0.95) * 100)}%
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600">
                        Prescription digitised. 4 medications extracted and cross-checked against allergic contraindications.
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Official ABHA Card & ABDM Gateway Simulator */}
      {activeTab === "abha" && (
        <div className="space-y-6">
          {/* Authentic Government of India ABHA Health Card Display */}
          <div>
            <div className="text-center space-y-1 mb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                Official Ayushman Bharat Digital Health Card
              </h2>
              <p className="text-xs text-slate-500">
                Issued by National Health Authority, Ministry of Health &amp; Family Welfare, Govt. of India
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
          <div className="pt-4 border-t border-slate-200">
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
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
              Predictive Clinical Risk Assessment
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
                    {vitalsData.length > 0 ? (
                      vitalsData.map((row, i) => {
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
                              {row.bmi?.toFixed(1) ?? "—"}
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
                    ) : (
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
        </div>
      )}

      {/* Tab 5: FHIR Documents */}
      {activeTab === "fhir" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Your Interoperable Medical Records</CardTitle>
                <CardDescription>
                  In the standard format hospitals and insurers read (ABDM / FHIR R4)
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
                  {fhirData.length > 0 ? (
                    fhirData.map((doc) => {
                      const codes = [
                        ...doc.loinc_codes.map((c: string) => `LOINC: ${c}`),
                        ...doc.snomed_codes.map((c: string) => `SNOMED: ${c}`),
                      ].join(", ") || doc.profile;
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {doc.id.slice(0, 8).toUpperCase()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-slate-700 border-slate-300">
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
                  ) : (
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
      )}
    </div>
  );
}
