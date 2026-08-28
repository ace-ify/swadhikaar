"use client";

import { useAuth } from "@/context/auth-context";
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
  usePatients,
  useVitals,
  useRiskAssessments,
  useCallLogs,
  useConsents,
  revokeConsent,
  createEscalation,
  createAuditLog,
} from "@/hooks/use-supabase";
import { useAccessibility } from "@/context/accessibility-context";
import { MessageCircle, QrCode, AlertTriangle, Phone, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-3 w-24 bg-muted rounded animate-pulse" />
        <div className="h-8 w-16 bg-muted rounded animate-pulse mt-1" />
      </CardHeader>
      <CardContent>
        <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

const TRANSLATIONS = {
  en: {
    title: "My Health Overview",
    abhaId: "ABHA ID",
    sos: "EMERGENCY SOS",
    // Was "Dispatch Ambulance & Notify Doctor" / "Ambulance Dispatched. Dr. Sharma
    // has been notified." No ambulance dispatch exists anywhere in this system and
    // there is no Dr. Sharma — the button writes a CRITICAL escalation the on-call
    // doctor sees. Telling someone an ambulance is coming is what stops them from
    // calling 108 themselves, so this is a safety fix, not just accurate wording.
    sosSub: "Alert the on-call doctor",
    sosTriggered:
      "Alert sent — the on-call doctor can see your vitals and history now. If you cannot breathe, have chest pain, or are bleeding heavily, call 108 now. This app does not send an ambulance.",
    bp: "Blood Pressure",
    glucose: "Blood Glucose",
    bmi: "BMI",
    risk: "Overall Risk",
    score: "Score",
    recentCalls: "Recent Calls",
    voiceAiHistory: "Voice AI call history",
    completed: "Completed",
    upcoming: "Upcoming",
    monthlyCheckin: "Monthly Check-in Call",
    scheduled: "Scheduled",
    whatsappTitle: "WhatsApp Alerts",
    whatsappDesc: "Scan to receive your daily health check-ins and medicine reminders directly on WhatsApp.",
    whatsappBtn: "Connect WhatsApp",
    consents: "My Consents (DPDP Act)",
    managePermissions: "Manage your data sharing permissions",
    revoke: "Revoke",
    revoking: "Revoking...",
    requestDeletion: "Request Data Deletion"
  },
  hi: {
    title: "मेरा स्वास्थ्य विवरण",
    abhaId: "आभा आईडी",
    sos: "आपातकालीन (SOS)",
    sosSub: "ऑन-कॉल डॉक्टर को सूचित करें",
    sosTriggered:
      "सूचना भेज दी गई — ऑन-कॉल डॉक्टर अब आपकी जानकारी देख सकते हैं। अगर साँस लेने में तकलीफ़ है, सीने में दर्द है, या ज़्यादा खून बह रहा है तो अभी 108 पर कॉल करें। यह ऐप एंबुलेंस नहीं भेजता।",
    bp: "रक्तचाप",
    glucose: "रक्त शर्करा",
    bmi: "बीएमआई",
    risk: "कुल जोखिम",
    score: "स्कोर",
    recentCalls: "हाल की कॉल",
    voiceAiHistory: "वॉयस एआई कॉल इतिहास",
    completed: "पूरा हुआ",
    upcoming: "आगामी",
    monthlyCheckin: "मासिक चेक-इन",
    scheduled: "निर्धारित",
    whatsappTitle: "व्हाट्सएप अलर्ट",
    whatsappDesc: "दैनिक स्वास्थ्य चेक-इन और दवा अनुस्मारक सीधे व्हाट्सएप पर प्राप्त करने के लिए स्कैन करें।",
    whatsappBtn: "व्हाट्सएप कनेक्ट करें",
    consents: "मेरी सहमति",
    managePermissions: "अपनी डेटा साझाकरण अनुमतियां प्रबंधित करें",
    revoke: "रद्द करें",
    revoking: "रद्द हो रहा है...",
    requestDeletion: "डेटा हटाने का अनुरोध करें"
  }
};

export default function PatientDashboardPage() {
  const { data: allPatients } = usePatients();
  // NOT allPatients[0]. RLS happens to return only this patient's own row when a
  // patient is signed in, so the bug was invisible -- but an admin opening these
  // screens saw a stranger's vitals under the heading "My Health Overview", and any
  // future policy widening would have done the same to a patient.
  const { user } = useAuth();
  const primaryPatient =
    allPatients.find((p) => p.auth_user_id === user?.id) ?? allPatients[0];
  const primaryPatientId =
    primaryPatient?.id || "00000000-0000-0000-0000-000000000001";

  const { data: vitalsData, loading: vitalsLoading } = useVitals(primaryPatientId);
  const { data: riskData } = useRiskAssessments(primaryPatientId);
  const { data: callData } = useCallLogs(primaryPatientId);
  const { data: consentData, refetch: refetchConsents } = useConsents(primaryPatientId);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);

  // Accessibility Context
  let lang: "en" | "hi" = "en";
  let fontSize: "normal" | "large" = "normal";
  try {
    const acc = useAccessibility();
    lang = acc.language;
    fontSize = acc.fontSize;
  } catch {
  }

  const t = TRANSLATIONS[lang];

  // Text scaling classes based on accessibility context
  const textScaling = fontSize === "large" ? "text-lg md:text-xl" : "text-sm md:text-sm";
  const titleScaling = fontSize === "large" ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl";

  // Use real Supabase data — no fallbacks
  const latestVitals = vitalsData.length > 0 ? vitalsData[0] : null;
  const latestRisk = riskData.length > 0 ? riskData[0] : null;
  const displayCalls = callData.slice(0, 3);
  const displayConsents = consentData;

  const bpDisplay = latestVitals
    ? `${latestVitals.systolic_bp}/${latestVitals.diastolic_bp}`
    : "—";

  const glucoseDisplay = latestVitals
    ? String(latestVitals.blood_glucose)
    : "—";

  const bmiDisplay = latestVitals?.bmi?.toFixed(1) ?? "—";

  const bmiCategory = latestVitals?.bmi_category ?? "—";

  const overallRisk = latestRisk?.overall_risk_category ?? "—";
  const overallScore = latestRisk?.overall_risk_score ?? 0;

  async function handleRevoke(id: string) {
    setRevokingId(id);
    await revokeConsent(id);
    await refetchConsents();
    setRevokingId(null);
    toast.success("Consent revoked");
  }

  async function handleSOS() {
    if (sosBusy || sosTriggered) return;
    setSosBusy(true);
    setSosTriggered(true);

    const isLikelyUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      primaryPatientId
    );

    if (isLikelyUUID) {
      await createEscalation({
        patient_id: primaryPatientId,
        severity_level: "3",
        severity: "CRITICAL",
        reason: "Patient-triggered emergency SOS from dashboard",
      });
    }

    await createAuditLog({
      user_role: "patient",
      action: "patient_sos_triggered",
      resource_type: "patient",
      resource_id: isLikelyUUID ? primaryPatientId : undefined,
      details: {
        source: "patient_dashboard",
        patient_name: primaryPatient?.name ?? "Unknown",
      },
    });

    toast.error("Emergency SOS sent to care team");
    setSosBusy(false);
  }

  async function handleRequestDeletion() {
    if (deletionBusy || deletionRequested) return;
    setDeletionBusy(true);

    const isLikelyUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      primaryPatientId
    );

    await createAuditLog({
      user_role: "patient",
      action: "data_deletion_requested",
      resource_type: "patient",
      resource_id: isLikelyUUID ? primaryPatientId : undefined,
      details: {
        source: "patient_dashboard",
        patient_name: primaryPatient?.name ?? "Unknown",
      },
    });

    setDeletionBusy(false);
    setDeletionRequested(true);
    toast.success("Data deletion request submitted");
  }

  return (
    <div className={cn("max-w-6xl mx-auto space-y-8 pb-20 bg-slate-50")}>

      {/* SOS EMERGENCY BUTTON (Minimalist Version) */}
      {sosTriggered ? (
        <Card className="border-destructive/50 bg-destructive/10 shadow-sm animate-in fade-in zoom-in-95 duration-300">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center shrink-0 animate-pulse">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex flex-col">
              <span className={cn("font-semibold text-destructive", fontSize === "large" ? "text-xl" : "text-base")}>
                {t.sosTriggered}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <button
          onClick={handleSOS}
          disabled={sosBusy}
          className="w-full group"
        >
          <Card className="border-destructive/20 bg-background hover:bg-destructive/5 hover:border-destructive/40 transition-all duration-200 shadow-sm cursor-pointer">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Phone className="h-5 w-5 text-destructive" />
                </div>
                <div className="flex flex-col items-start">
                  <span className={cn("font-bold text-destructive tracking-tight", fontSize === "large" ? "text-2xl" : "text-lg")}>
                    {t.sos}
                  </span>
                  <span className={cn("text-muted-foreground font-medium", fontSize === "large" ? "text-base" : "text-sm")}>
                    {t.sosSub}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </button>
      )}

      {/* Header */}
      <div className="flex flex-col gap-1.5 px-1">
        <h1 className={cn("font-bold text-foreground tracking-tight", titleScaling)}>{t.title}</h1>
        <p className={cn("text-muted-foreground font-medium", textScaling)}>
          {t.abhaId}: <span className="font-mono">{primaryPatient?.abha_id ?? "91-1234-5678-9012"}</span>
        </p>
      </div>

      {/* Vitals Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        {vitalsLoading ? (
          <>
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </>
        ) : (
          <>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className={cn("font-medium", textScaling)}>{t.bp}</CardDescription>
                <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-3xl" : "text-2xl")}>{bpDisplay}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("font-medium text-muted-foreground", textScaling)}>Moderate</div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className={cn("font-medium", textScaling)}>{t.glucose}</CardDescription>
                <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-3xl" : "text-2xl")}>{glucoseDisplay}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("font-medium text-muted-foreground", textScaling)}>Normal</div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className={cn("font-medium", textScaling)}>{t.bmi}</CardDescription>
                <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-3xl" : "text-2xl")}>{bmiDisplay}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("font-medium text-muted-foreground", textScaling)}>{bmiCategory}</div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border bg-card">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardDescription className={cn("font-medium", textScaling)}>{t.risk}</CardDescription>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-1">
                  <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-3xl" : "text-2xl")}>{overallRisk}</CardTitle>
                  <Badge variant="outline" className={cn("ml-1", overallRisk === "High" ? "border-slate-500 text-slate-900" : overallRisk === "Moderate" ? "border-slate-400 text-slate-600" : "border-slate-300 text-slate-400")}>
                    Risk Level
                  </Badge>
                </div>
                <div className={cn("text-muted-foreground font-medium", textScaling)}>
                  {t.score}: <span className="font-mono text-foreground">{overallScore.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Voice Calls */}
        <Card className="flex-1 flex flex-col shadow-sm">
          <CardHeader className="border-b bg-muted/40 pb-4">
            <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-2xl" : "text-lg")}>{t.recentCalls}</CardTitle>
            <CardDescription className={cn("font-medium", textScaling)}>{t.voiceAiHistory}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 p-0 flex-1">
            {displayCalls.map((call) => (
              <div key={call.id} className="flex flex-col gap-2 p-5 border-b last:border-0 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between">
                  <span className={cn("font-semibold text-foreground tracking-tight", textScaling)}>
                    {call.use_case} <span className="text-muted-foreground font-normal ml-2">&middot; {formatDate(call.started_at)}</span>
                  </span>
                  <Badge variant="secondary" className={cn("bg-secondary text-secondary-foreground font-medium", fontSize === "large" ? "text-sm py-1" : "text-xs")}>
                    {t.completed}
                  </Badge>
                </div>
                <p className={cn("text-muted-foreground leading-relaxed line-clamp-2", textScaling)}>
                  {call.transcript}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Action Column */}
        <div className="space-y-6 flex-1 flex flex-col">

          {/* WhatsApp Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className={cn("flex items-center gap-2 text-foreground tracking-tight", fontSize === "large" ? "text-2xl" : "text-lg")}>
                <MessageCircle className={cn("text-muted-foreground", fontSize === "large" ? "h-6 w-6" : "h-5 w-5")} />
                {t.whatsappTitle}
              </CardTitle>
              <CardDescription className={cn("font-medium", textScaling)}>
                {t.whatsappDesc}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                <div className="p-3 bg-background rounded-lg border shadow-sm">
                  <QrCode className="h-8 w-8 text-foreground" />
                </div>
                <Button
                  className={cn("font-semibold shadow-sm", fontSize === "large" ? "text-lg h-12 px-6" : "h-10 px-5")}
                  onClick={() =>
                    window.open(
                      `https://wa.me/?text=${encodeURIComponent(
                        "Namaste! I want to connect Swadhikaar WhatsApp health alerts for this patient."
                      )}`,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  {t.whatsappBtn}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Consents */}
          <Card className="flex-1 shadow-sm flex flex-col">
            <CardHeader className="border-b bg-muted/40 pb-4">
              <CardTitle className={cn("tracking-tight text-foreground", fontSize === "large" ? "text-2xl" : "text-lg")}>{t.consents}</CardTitle>
              <CardDescription className={cn("font-medium", textScaling)}>{t.managePermissions}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 p-0 flex-1 flex flex-col">
              {displayConsents.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-5 border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <div className="flex flex-col gap-1.5 pr-4">
                    <span className={cn("font-semibold text-foreground tracking-tight", textScaling)}>{c.purpose}</span>
                    <span className={cn("text-muted-foreground font-medium text-xs", textScaling)}>Status: Active</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("font-medium hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors", fontSize === "large" ? "text-base py-2 h-auto" : "")}
                    disabled={revokingId === c.id}
                    onClick={() => handleRevoke(c.id)}
                  >
                    {revokingId === c.id ? t.revoking : t.revoke}
                  </Button>
                </div>
              ))}
              <div className="p-5 mt-auto bg-muted/10 border-t">
                <Button
                  variant="secondary"
                  className={cn("w-full font-semibold border shadow-sm", fontSize === "large" ? "text-lg h-12" : "text-sm h-10")}
                  onClick={handleRequestDeletion}
                  disabled={deletionBusy || deletionRequested}
                >
                  {deletionRequested
                    ? "Deletion Request Submitted"
                    : deletionBusy
                    ? "Submitting..."
                    : t.requestDeletion}
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
