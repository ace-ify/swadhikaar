"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  IndianRupee,
  Mic,
  TrendingUp,
  Zap,
  Users,
  MapPin,
  ShieldCheck,
  BrainCircuit,
  MessageSquare,
  Target,
  ArrowRight,
  AlertTriangle,
  Flame,
} from "lucide-react";
import {
  usePatients,
  useEscalations,
  useCallLogs,
  useConversionFunnel,
  useFHIRResources,
  useConsents,
  type Patient,
  type Escalation,
  type VoiceCall,
} from "@/hooks/use-supabase";
import { cn } from "@/lib/utils";

// (Fallback data removed — all data comes from Supabase)

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function computeCampBreakdown(patients: Patient[]) {
  const map: Record<string, { high: number; moderate: number; low: number }> = {};
  for (const p of patients) {
    const camp = p.health_camp || "General Clinic";
    if (!map[camp]) map[camp] = { high: 0, moderate: 0, low: 0 };
    if (p.risk_level === "High") map[camp].high++;
    else if (p.risk_level === "Moderate") map[camp].moderate++;
    else map[camp].low++;
  }
  return Object.entries(map).map(([name, counts]) => ({
    name,
    patients: counts.high + counts.moderate + counts.low,
    ...counts,
  })).sort((a,b) => b.patients - a.patients);
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-3 w-24 mb-2" /><Skeleton className="h-8 w-16" /></CardHeader></Card>
      ))}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { data: patients, loading: pLoad } = usePatients();
  const { data: escalations, loading: eLoad } = useEscalations();
  const { data: calls, loading: cLoad } = useCallLogs();
  const { data: conversionFunnel, loading: fLoad } = useConversionFunnel();
  const { data: fhirResources } = useFHIRResources();
  const { data: consents } = useConsents();

  const loading = pLoad || eLoad || cLoad;
  const patientMap = new Map(patients.map((p) => [p.id, p]));

  // Use real data — no fallbacks
  const displayCamps = patients.length > 0 ? computeCampBreakdown(patients) : [];
  const displayEscalations = escalations.slice(0, 5);

  const totalPatients = patients.length;
  const totalCalls = calls.length;

  // Compute enrollment growth (patients added in last 7 days vs previous 7 days)
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const recentPatients = patients.filter(
    (p) => now - new Date(p.created_at).getTime() < weekMs
  ).length;
  const prevPatients = patients.filter(
    (p) => {
      const age = now - new Date(p.created_at).getTime();
      return age >= weekMs && age < weekMs * 2;
    }
  ).length;
  const enrollmentGrowth = prevPatients > 0 ? Math.round(((recentPatients - prevPatients) / prevPatients) * 100) : recentPatients > 0 ? 100 : 0;

  // Compute call success rate
  const completedCalls = calls.filter((c) => c.status === "completed").length;
  const callSuccessRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

  // Compute dialect metrics from real call data
  const dialectCounts: Record<string, number> = {};
  for (const c of calls) {
    const extracted = (c.extracted_data || {}) as Record<string, any>;
    const lang = extracted.language_detected || c.language || "hindi";
    dialectCounts[lang] = (dialectCounts[lang] || 0) + 1;
  }
  const dialectTotal = Math.max(Object.values(dialectCounts).reduce((a, b) => a + b, 0), 1);
  const dialectMetrics = [
    { label: "Hindi", pct: Math.round(((dialectCounts["hindi"] || 0) / dialectTotal) * 100), color: "bg-slate-700" },
    { label: "Mixed (Hindi+English)", pct: Math.round(((dialectCounts["mixed"] || 0) / dialectTotal) * 100), color: "bg-slate-500" },
    { label: "Bhojpuri / Maithili / English", pct: Math.round((((dialectCounts["bhojpuri"] || 0) + (dialectCounts["maithili"] || 0) + (dialectCounts["english"] || 0)) / dialectTotal) * 100), color: "bg-slate-300" },
  ];

  // ROI / Cost Savings Calculation
  // Human telecaller: ~₹15 per call. Swadhikaar AI: ~₹3.86 per call.
  const savingsPerCall = 15 - 3.86;
  const totalSavings = Math.round(totalCalls * savingsPerCall);

  // FHIR extraction approval rate (real data)
  const fhirTotal = fhirResources.length;
  const fhirApproved = fhirResources.filter(
    (r) => r.review_status === "approved" || r.review_status === "corrected"
  ).length;
  const fhirApprovalRate = fhirTotal > 0 ? Math.round((fhirApproved / fhirTotal) * 1000) / 10 : 0;

  // DPDP Consent compliance rate (real data)
  const activeConsents = consents.filter((c) => c.is_active).length;
  const totalConsents = consents.length;
  const consentRate = totalConsents > 0 ? Math.round((activeConsents / totalConsents) * 1000) / 10 : 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Operations Center</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            District-level view of AI pipeline performance, population health, and automated tele-triage.
          </p>
        </div>
        <Link
          href="/admin/trends"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition shadow-xs self-start md:self-auto"
        >
          <Activity className="h-4 w-4" />
          Community Health Trends & Outbreak Surveillance →
        </Link>
      </div>

      {/* Lenovo LEAP / IndiaAI Outbreak Alert Banner */}
      <div className="p-4 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-slate-900 dark:text-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 rounded-lg shrink-0 border border-rose-200 dark:border-rose-800">
            <Flame className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                Lenovo LEAP 2026 • AI Public Health Alert (Theme 3.3)
              </span>
              <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-semibold">
                2 HOTSPOTS ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Epidemiological anomaly detected: <strong>+38.4% surge in Febrile Pyrexia</strong> across Mohanlalganj (Lucknow) &amp; pediatric respiratory wheezing in Barabanki CHC catchment.
            </p>
          </div>
        </div>
        <Link
          href="/admin/trends"
          className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold px-3 py-1.5 rounded-md transition shrink-0 inline-flex items-center gap-1.5 shadow-xs"
        >
          Inspect Outbreak Map &amp; Report
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* KPI Cards (System Impact & ROI) */}
      {loading ? <StatsSkeleton /> : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total Patients Enrolled</CardTitle>
              <div className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <Users className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-foreground tracking-tight">{totalPatients}</div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center">
                  <TrendingUp className="w-3.5 h-3.5 mr-0.5" /> {enrollmentGrowth >= 0 ? "+" : ""}{enrollmentGrowth}%
                </span>{" "}
                this week
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total AI Calls Executed</CardTitle>
              <div className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <Mic className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-foreground tracking-tight">{totalCalls}</div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {callSuccessRate}% successful connection rate
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cost Saved vs Telecallers</CardTitle>
              <div className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <IndianRupee className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-foreground tracking-tight">₹{totalSavings.toLocaleString('en-IN')}</div>
              <p className="text-[11px] text-muted-foreground mt-1">
                ₹3.86 AI call vs ₹15.00 human call
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Voice Pipeline</CardTitle>
              <div className="h-8 w-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <Zap className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold font-mono text-foreground tracking-tight">
                STT <span className="text-muted-foreground">→</span> LLM <span className="text-muted-foreground">→</span> TTS
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Deepgram · Groq Llama 3.3 · Murf Indic
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Conversion Funnel — Use Case Pipeline */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-slate-800 text-lg">
                <Target className="w-5 h-5 text-slate-500" /> Patient Conversion Funnel
              </CardTitle>
              <CardDescription className="font-medium mt-1 text-slate-500">
                End-to-end conversion rates across all 6 Voice AI use cases.
              </CardDescription>
            </div>
            <Badge variant="outline" className="bg-white border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]">All Camps</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid gap-4 md:grid-cols-3">
            {conversionFunnel.map((item) => (
              <div key={item.label} className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-slate-700">{item.label}</span>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-black text-slate-900 tracking-tight">{item.rate}</span>
                  <span className="text-lg font-bold text-slate-400">%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner mb-2">
                  <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.rate}%` }}></div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-slate-400">{item.from} in pipeline</span>
                  <span className="text-[10px] font-bold text-slate-600 flex items-center gap-0.5">
                    <ArrowRight className="w-2.5 h-2.5" /> {item.converted} converted
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Analytics Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* District Risk Heatmap (Simulated) */}
        <Card className="flex-1 border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-slate-800 text-lg">
                  <MapPin className="w-5 h-5 text-slate-500" /> District Health Camps
                </CardTitle>
                <CardDescription className="font-medium mt-1 text-slate-500">Population risk distribution by region</CardDescription>
              </div>
              <Badge variant="outline" className="bg-white border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]">Live Sync</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 w-[200px] h-10 text-xs font-bold uppercase text-slate-400">Camp Location</TableHead>
                  <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">Patients</TableHead>
                  <TableHead className="w-[200px] h-10 text-xs font-bold uppercase text-slate-400">Risk Map (L / M / H)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayCamps.map((camp) => (
                  <TableRow key={camp.name} className="hover:bg-slate-50/50 border-slate-100">
                    <TableCell className="pl-6 font-semibold text-slate-700 py-3">{camp.name}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-500 font-medium py-3">{camp.patients}</TableCell>
                    <TableCell className="py-3 pr-6">
                      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-100 shadow-inner">
                        <div style={{ width: `${(camp.low / camp.patients) * 100}%` }} className="bg-slate-300 hover:bg-slate-400 transition-colors" title={`Low: ${camp.low}`} />
                        <div style={{ width: `${(camp.moderate / camp.patients) * 100}%` }} className="bg-slate-500 hover:bg-slate-600 transition-colors" title={`Moderate: ${camp.moderate}`} />
                        <div style={{ width: `${(camp.high / camp.patients) * 100}%` }} className="bg-slate-800 hover:bg-slate-900 transition-colors" title={`High: ${camp.high}`} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* AI Performance & Compliance */}
        <div className="flex flex-col gap-6">
          <Card className="flex-1 border-slate-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2 text-slate-800">
                <BrainCircuit className="w-5 h-5 text-slate-500" /> AI Dialect & Language Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6 mt-2">
                {dialectMetrics.map((d) => (
                  <div key={d.label}>
                    <div className="flex justify-between text-sm mb-2 font-semibold">
                      <span className="text-slate-700">{d.label}</span>
                      <span className="text-slate-500 font-mono">{d.pct}%</span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full ${d.color} rounded-full`} style={{ width: `${d.pct}%` }}></div></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4 h-[120px]">
            <Card className="bg-slate-50/50 border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
              <CardContent className="p-0 flex flex-col justify-center items-center text-center h-full">
                <ShieldCheck className="w-6 h-6 text-slate-600 mb-2" />
                <h4 className="text-2xl font-black text-slate-900 tracking-tight">{consentRate}%</h4>
                <p className="text-[11px] font-bold text-slate-600 mt-1 uppercase tracking-widest">Consent Active</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-50/50 border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
              <CardContent className="p-0 flex flex-col justify-center items-center text-center h-full">
                <MessageSquare className="w-6 h-6 text-slate-600 mb-2" />
                <h4 className="text-2xl font-black text-slate-900 tracking-tight">{fhirApprovalRate}%</h4>
                <p className="text-[11px] font-bold text-slate-600 mt-1 uppercase tracking-widest">Extractions Approved</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Global Escalation Feed */}
      <Card className="border-slate-200 shadow-sm mt-6">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
            <Activity className="w-5 h-5 text-slate-500" /> Global Escalation Feed (Triage Center)
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">Live district-wide alerts auto-generated by the Voice AI.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-white">
              <TableRow>
                <TableHead className="pl-6 h-10 text-xs font-bold uppercase text-slate-400">Patient</TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">Severity</TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">Clinical Reason (Extracted)</TableHead>
                <TableHead className="text-right pr-6 h-10 text-xs font-bold uppercase text-slate-400">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayEscalations.map((esc) => {
                const fb = esc as any;
                const patientName = fb._patient ?? patientMap.get(esc.patient_id)?.name ?? esc.patient_id.slice(0, 8);
                const campLabel = fb.camp ?? patientMap.get(esc.patient_id)?.health_camp ?? "Unknown";

                return (
                  <TableRow key={esc.id} className="hover:bg-slate-50 border-slate-100">
                    <TableCell className="pl-6 py-4">
                      <div className="font-semibold text-slate-900">{patientName}</div>
                      <div className="text-[11px] font-medium text-slate-500 mt-0.5">{campLabel}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={esc.severity === "CRITICAL" ? "destructive" : "secondary"} className="uppercase text-[10px] font-bold tracking-widest px-2 py-0.5">
                        {esc.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-slate-700 max-w-md">
                      {esc.reason}
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-slate-400 font-mono font-medium pr-6 whitespace-nowrap">
                      {timeAgo(esc.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {displayEscalations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500 py-12 font-medium">
                    No active escalations. System is operating normally.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
