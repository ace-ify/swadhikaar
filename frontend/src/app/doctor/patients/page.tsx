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
import { Input } from "@/components/ui/input";
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
import { Phone, Loader2, Bot, ChevronDown } from "lucide-react";
import {
  usePatients,
  useVitals,
  useRiskAssessments,
  useCallLogs,
  useConsents,
  useEscalations,
  useNewborns,
  useVaccinationSchedules,
  useDoctors,
  createAuditLog,
  type Patient,
} from "@/hooks/use-supabase";
import { toast } from "sonner";
import {
  resolveAllPatients,
  resolveCallType,
  CALL_TYPE_LABELS,
  type CallRecommendation,
} from "@/lib/resolve-call-type";
import { callStartVoiceCall } from "@/lib/edge-functions";

// Stable seeded pseudo-random age (30–75) derived from patient id string
function seededAge(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return 30 + (hash % 46);
}

// Infer gender from last character of first name — rough heuristic for Indian names
function inferGender(name: string): "M" | "F" {
  const feminine = ["a", "i", "ee", "evi", "ita", "mi", "ni"];
  const lower = name.split(" ")[0].toLowerCase();
  return feminine.some((s) => lower.endsWith(s)) ? "F" : "M";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Patient Detail Sheet (case management view)
// ---------------------------------------------------------------------------
function PatientDetailSheet({
  patient,
  onClose,
  onCall,
  calling,
  recommendation,
}: {
  patient: Patient;
  onClose: () => void;
  onCall: (callType: string, phoneNumber?: string) => void;
  calling: boolean;
  recommendation: CallRecommendation;
}) {
  const [phoneNumber, setPhoneNumber] = useState(patient.phone || "");
  const [callType, setCallType] = useState(recommendation.callType);
  const [showTypeOverride, setShowTypeOverride] = useState(false);
  const { data: vitals, loading: vitalsLoading } = useVitals(patient.id);
  const { data: risks, loading: risksLoading } = useRiskAssessments(patient.id);
  const { data: calls, loading: callsLoading } = useCallLogs(patient.id);
  const { data: consents, loading: consentsLoading } = useConsents(patient.id);
  const { data: escalations } = useEscalations();

  const patientEscalations = escalations.filter((e) => e.patient_id === patient.id);
  const latestVitals = vitals[0];
  const latestRisk = risks[0];
  const age = seededAge(patient.id);
  const gender = inferGender(patient.name);

  return (
    <Sheet open onOpenChange={(val) => !val && onClose()}>
      <SheetContent className="sm:max-w-[600px] w-[95vw] flex flex-col p-0 gap-0 border-l border-slate-200 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-6 border-b bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-widest ${
                patient.risk_level === "High"
                  ? "bg-slate-900 text-white border-slate-900"
                  : patient.risk_level === "Moderate"
                  ? "bg-slate-200 text-slate-700 border-slate-300"
                  : "bg-white text-slate-400 border-slate-200"
              }`}
            >
              {patient.risk_level} Risk
            </Badge>
            <span className="text-xs text-slate-400 font-mono">
              {patient.id.slice(0, 12).toUpperCase()}
            </span>
          </div>
          <SheetTitle className="text-2xl font-bold text-slate-900 tracking-tight">
            {patient.name}
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-500 mt-1.5 flex items-center gap-3 flex-wrap">
            <span>{age}y, {gender === "M" ? "Male" : "Female"}</span>
            <span className="text-slate-300">|</span>
            <span className="font-mono text-xs">{patient.abha_id}</span>
            <span className="text-slate-300">|</span>
            <span>{patient.health_camp}</span>
          </SheetDescription>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 bg-slate-50/30">

          {/* Risk Assessment */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Risk Assessment
            </h4>
            {risksLoading ? (
              <div className="h-20 bg-slate-100 rounded-lg animate-pulse" />
            ) : latestRisk ? (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Heart", score: latestRisk.heart_risk_score, level: latestRisk.heart_risk_level },
                  { label: "Diabetic", score: latestRisk.diabetic_risk_score, level: latestRisk.diabetic_risk_level },
                  { label: "Hypertension", score: latestRisk.hypertension_risk_score, level: latestRisk.hypertension_risk_level },
                ].map((r) => (
                  <div key={r.label} className="border rounded-lg p-3 bg-white">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">{r.label}</div>
                    <div className="text-lg font-bold tabular-nums mt-1">
                      <span className={
                        r.score >= 50 ? "text-slate-900" : r.score >= 30 ? "text-slate-600" : "text-slate-400"
                      }>
                        {r.score.toFixed(1)}
                      </span>
                    </div>
                    <div className={`text-[10px] font-medium uppercase ${
                      r.level === "High" ? "text-slate-900" : r.level === "Moderate" ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {r.level}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No risk assessment data.</p>
            )}
            {latestRisk && (
              <div className="flex items-center gap-2 mt-2 px-1">
                <span className="text-[10px] text-slate-400">Overall:</span>
                <span className={`text-sm font-bold tabular-nums ${
                  latestRisk.overall_risk_score >= 50 ? "text-slate-900" : "text-slate-600"
                }`}>
                  {latestRisk.overall_risk_score.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400">
                  assessed {formatDate(latestRisk.assessed_at)}
                </span>
              </div>
            )}
          </div>

          {/* Latest Vitals */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Latest Vitals
            </h4>
            {vitalsLoading ? (
              <div className="h-20 bg-slate-100 rounded-lg animate-pulse" />
            ) : latestVitals ? (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "BP", value: `${latestVitals.systolic_bp}/${latestVitals.diastolic_bp}`, unit: "mmHg", warn: latestVitals.systolic_bp > 140 },
                  { label: "Heart Rate", value: latestVitals.heart_rate, unit: "bpm", warn: latestVitals.heart_rate > 100 },
                  { label: "SpO2", value: latestVitals.oxygen_saturation, unit: "%", warn: latestVitals.oxygen_saturation < 95 },
                  { label: "Glucose", value: latestVitals.blood_glucose, unit: "mg/dL", warn: latestVitals.blood_glucose > 200 },
                  { label: "BMI", value: latestVitals.bmi?.toFixed(1), unit: latestVitals.bmi_category?.split(/[\s(]/)[0] || "", warn: false },
                  { label: "Temp", value: latestVitals.temperature?.toFixed(1), unit: "°F", warn: latestVitals.temperature > 100 },
                ].map((v) => (
                  <div key={v.label} className="border rounded-lg p-3 bg-white">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">{v.label}</div>
                    <div className="text-sm font-bold tabular-nums mt-1">
                      <span className={v.warn ? "text-slate-900" : "text-slate-600"}>
                        {v.value}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">{v.unit}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No vitals recorded.</p>
            )}
            {latestVitals && (
              <p className="text-[10px] text-slate-400 mt-2 px-1">
                Recorded {formatDate(latestVitals.recorded_at)}
              </p>
            )}
          </div>

          {/* Recent Calls */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Voice Call History
              {calls.length > 0 && (
                <span className="ml-2 text-slate-300 font-normal normal-case">({calls.length})</span>
              )}
            </h4>
            {callsLoading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
              </div>
            ) : calls.length > 0 ? (
              <div className="space-y-2">
                {calls.slice(0, 5).map((call) => (
                  <div key={call.id} className="flex items-center justify-between border rounded-lg p-3 bg-white">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700 capitalize">{call.use_case.replace(/_/g, " ")}</span>
                        <Badge variant="outline" className={`text-[9px] ${
                          call.status === "completed" ? "text-slate-500 border-slate-200" : "text-slate-400 border-slate-200"
                        }`}>
                          {call.status}
                        </Badge>
                        {call.severity && call.severity !== "low" && (
                          <Badge variant="outline" className="text-[9px] font-bold uppercase text-slate-700 border-slate-300">
                            {call.severity}
                          </Badge>
                        )}
                      </div>
                      {call.transcript && (
                        <p className="text-[11px] text-slate-400 mt-1 truncate max-w-sm">
                          {call.transcript.slice(0, 80)}...
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-xs text-slate-500">{timeAgo(call.created_at)}</div>
                      {call.duration_seconds > 0 && (
                        <div className="text-[10px] text-slate-400">{Math.ceil(call.duration_seconds / 60)}m</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No voice calls recorded.</p>
            )}
          </div>

          {/* Escalations */}
          {patientEscalations.length > 0 && (
            <div>
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Escalations
                <span className="ml-2 text-slate-300 font-normal normal-case">({patientEscalations.length})</span>
              </h4>
              <div className="space-y-2">
                {patientEscalations.slice(0, 3).map((esc) => (
                  <div key={esc.id} className="flex items-start justify-between border rounded-lg p-3 bg-white">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-[9px] font-bold uppercase ${
                          esc.severity === "CRITICAL" ? "bg-slate-900 text-white border-slate-900"
                          : esc.severity === "HIGH" ? "bg-slate-700 text-white border-slate-700"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {esc.severity}
                        </Badge>
                        <span className={`text-[10px] ${
                          esc.status === "resolved" ? "text-slate-400" : "text-slate-600 font-medium"
                        }`}>
                          {esc.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">{esc.reason}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">{timeAgo(esc.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consent Status */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Consent Status
            </h4>
            {consentsLoading ? (
              <div className="h-12 bg-slate-100 rounded-lg animate-pulse" />
            ) : consents.length > 0 ? (
              <div className="space-y-1.5">
                {consents.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border rounded-lg px-3 py-2 bg-white">
                    <span className="text-xs font-medium text-slate-700">{c.purpose}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        c.is_active
                          ? "text-slate-700 bg-slate-50 border-slate-300"
                          : "text-slate-400 border-slate-200"
                      }`}
                    >
                      {c.is_active ? "Active" : "Revoked"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No consent records.</p>
            )}
          </div>

          {/* Patient Info */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Patient Details
            </h4>
            <div className="border rounded-lg bg-white divide-y divide-slate-100">
              {[
                { label: "Phone", value: patient.phone },
                { label: "Language", value: patient.language },
                { label: "Camp Type", value: patient.camp_type },
                { label: "Journey Status", value: patient.journey_status },
                { label: "Consent", value: patient.consent_status },
                { label: "Enrolled", value: formatDate(patient.created_at) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-slate-400">{row.label}</span>
                  <span className="text-xs font-medium text-slate-700">{row.value || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer — Smart call initiation */}
        <div className="p-4 border-t bg-white shrink-0 space-y-3">
          {/* AI Recommendation */}
          <div className="flex items-start gap-2 px-1">
            <Bot className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-700">Recommended:</span>
                <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-700 border-slate-300">
                  {CALL_TYPE_LABELS[callType] || callType}
                </Badge>
                <button
                  onClick={() => setShowTypeOverride(!showTypeOverride)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                >
                  {showTypeOverride ? "hide" : "change"}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{recommendation.reason}</p>
            </div>
          </div>

          {/* Call type override */}
          {showTypeOverride && (
            <div className="flex gap-1.5 flex-wrap px-1">
              {Object.entries(CALL_TYPE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setCallType(key); setShowTypeOverride(false); }}
                  className={`px-2.5 py-1 rounded-full text-[10px] border font-medium transition-colors ${
                    callType === key
                      ? "bg-slate-800 text-white border-slate-800"
                      : "border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Phone + Call button */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-slate-500">
              Close
            </Button>
            <Input
              placeholder="+91..."
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="flex-1 h-8 text-xs font-mono"
            />
            <Button
              size="sm"
              disabled={calling}
              onClick={() => onCall(callType, phoneNumber || undefined)}
              className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
              {calling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Phone className="w-3.5 h-3.5" />
              )}
              {calling ? "Calling…" : phoneNumber ? "Dial" : "AI Call"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function DoctorPatientsPage() {
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [callingPatient, setCallingPatient] = useState<string | null>(null);

  const { data: supabasePatients, loading } = usePatients();
  const { data: allCalls } = useCallLogs();
  const { data: allEscalations } = useEscalations();
  const { data: allRisks } = useRiskAssessments();
  const { data: newborns } = useNewborns();
  const { data: vacSchedules } = useVaccinationSchedules();
  const { data: doctors } = useDoctors();

  // Build lookup maps for resolver
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

  // Resolve call type recommendations for all patients
  const recommendations = resolveAllPatients(
    supabasePatients, allCalls, allEscalations, allRisks,
    parentPatientIds, dueVaxParentIds,
  );

  // Build last-call lookup: patient_id → most recent call date
  const lastCallMap = new Map<string, string>();
  for (const call of allCalls) {
    const existing = lastCallMap.get(call.patient_id);
    if (!existing || call.created_at > existing) {
      lastCallMap.set(call.patient_id, call.created_at);
    }
  }

  async function initiateCall(patient: Patient, callType: string, phoneNumber?: string) {
    setCallingPatient(patient.id);
    // Resolve assigned doctor name
    const assignedDoc = doctors.find((d) => d.id === patient.assigned_doctor_id);
    const doctorName = assignedDoc?.name || "Dr. Priya Sharma";
    try {
      const data = await callStartVoiceCall({
        language: patient.language || "hindi",
        patient_id: patient.id,
        patient_name: patient.name,
        call_type: callType,
        phone_number: phoneNumber,
        health_camp: patient.health_camp,
        risk_level: patient.risk_level,
        risk_score: patient.overall_risk_score,
        doctor_name: doctorName,
      });
      if (data.error) throw new Error(data.error);
      await createAuditLog({
        user_role: "coordinator",
        action: "call_initiated",
        resource_type: "voice_call",
        resource_id: data.call_id,
        details: { patient_name: patient.name, call_type: callType },
      });
      const label = CALL_TYPE_LABELS[callType] || callType;
      if (String(data.status || "").toLowerCase() === "dialing") {
        toast.success(`Call initiated to ${patient.name}`, {
          description: `${label} outreach${phoneNumber ? ` -> ${phoneNumber}` : ""} - Call ID: ${data.call_id.slice(0, 20)}...`,
        });
      } else {
        toast.error("Call not dialed", {
          description: `Function returned status: ${data.status || "unknown"}`,
        });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to initiate call");
    } finally {
      setCallingPatient(null);
    }
  }

  const patients = supabasePatients.map((p) => ({
    ...p,
    age: seededAge(p.id),
    gender: inferGender(p.name),
    status: p.consent_status === "granted" ? "Active" : "Pending",
  }));

  const filtered = patients
    .filter((p) => riskFilter === "All" || p.risk_level === riskFilter)
    .filter(
      (p) =>
        search === "" ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.abha_id.includes(search) ||
        p.health_camp.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Health Camp Patients</h1>
        <p className="text-sm text-slate-500">
          {patients.length} patients from health camp screenings. Trigger Voice AI follow-up calls or review patient profiles.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Total Assigned</CardDescription>
            <CardTitle className="text-2xl">{patients.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">High Risk</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {patients.filter((p) => p.risk_level === "High").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Moderate Risk</CardDescription>
            <CardTitle className="text-2xl text-slate-600">
              {patients.filter((p) => p.risk_level === "Moderate").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Low Risk</CardDescription>
            <CardTitle className="text-2xl text-slate-400">
              {patients.filter((p) => p.risk_level === "Low").length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name, ABHA ID, camp..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {["All", "High", "Moderate", "Low"].map((r) => (
            <button
              key={r}
              onClick={() => setRiskFilter(r)}
              className={`px-3 py-1 rounded-full text-xs border font-medium transition-colors ${
                riskFilter === r
                  ? "bg-slate-800 text-white border-slate-800"
                  : "border-slate-300 text-slate-600 hover:border-slate-500"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {loading && (
          <span className="text-xs text-slate-400 ml-2 animate-pulse">Loading…</span>
        )}
      </div>

      {/* Patients Table */}
      <Card>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 w-[160px]">Patient</TableHead>
                <TableHead className="w-[140px]">ABHA ID</TableHead>
                <TableHead>Camp</TableHead>
                <TableHead className="w-[100px]">Risk Level</TableHead>
                <TableHead className="w-[70px]">Score</TableHead>
                <TableHead className="w-[90px]">Last Call</TableHead>
                <TableHead className="w-[120px]">Next Call</TableHead>
                <TableHead className="text-right pr-5 w-[70px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400 py-12 text-sm">
                    {loading ? "Loading patients…" : "No patients match your filters."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => {
                const lastCall = lastCallMap.get(p.id);
                const rec = recommendations.get(p.id);
                return (
                <TableRow key={p.id} className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="pl-5 py-3.5">
                    <div className="font-medium text-sm text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {p.age}y · {p.gender === "M" ? "Male" : "Female"}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500 truncate">{p.abha_id}</TableCell>
                  <TableCell className="text-sm text-slate-600 truncate">{p.health_camp}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        p.risk_level === "High"
                          ? "bg-slate-900 text-white border-slate-900"
                          : p.risk_level === "Moderate"
                          ? "bg-slate-200 text-slate-700 border-slate-300"
                          : "bg-white text-slate-400 border-slate-200"
                      }`}
                    >
                      {p.risk_level}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`font-mono text-sm font-semibold ${
                        p.overall_risk_score >= 50
                          ? "text-slate-900"
                          : p.overall_risk_score >= 35
                          ? "text-slate-600"
                          : "text-slate-400"
                      }`}
                    >
                      {p.overall_risk_score}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {lastCall ? timeAgo(lastCall) : (
                      <span className="text-slate-300 italic">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {rec && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-bold uppercase tracking-wider bg-slate-50 text-slate-600 border-slate-200"
                      >
                        {rec.label}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs px-3 text-slate-600 hover:text-slate-900 font-medium"
                      onClick={() => setSelectedPatient(p)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Patient Detail Sheet */}
      {selectedPatient && (
        <PatientDetailSheet
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
          onCall={(callType, phoneNumber) => initiateCall(selectedPatient, callType, phoneNumber)}
          calling={callingPatient === selectedPatient.id}
          recommendation={recommendations.get(selectedPatient.id) || {
            callType: "follow_up", label: "Follow-up",
            reason: "Routine follow-up check", priority: 5,
          }}
        />
      )}
    </div>
  );
}
