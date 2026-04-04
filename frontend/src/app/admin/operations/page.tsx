"use client";

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
  AlertTriangle,
  CheckCircle2,
  Clock,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  RefreshCw,
  Timer,
  TrendingDown,
  UserX,
  Users,
} from "lucide-react";
import {
  usePatients,
  useCallLogs,
  useEscalations,
  useDoctors,
  type Patient,
  type VoiceCall,
} from "@/hooks/use-supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isLast7Days(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 7 * 24 * 60 * 60 * 1000;
}

function isLast30Days(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 30 * 24 * 60 * 60 * 1000;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Non-responsive patient detection
// ---------------------------------------------------------------------------
interface NonResponsivePatient {
  patient: Patient;
  lastAttempt: string;
  failedCount: number;
  daysSinceLastAttempt: number;
}

function findNonResponsivePatients(
  patients: Patient[],
  calls: VoiceCall[]
): NonResponsivePatient[] {
  const result: NonResponsivePatient[] = [];

  // Group calls by patient
  const callsByPatient = new Map<string, VoiceCall[]>();
  for (const c of calls) {
    const arr = callsByPatient.get(c.patient_id) || [];
    arr.push(c);
    callsByPatient.set(c.patient_id, arr);
  }

  for (const patient of patients) {
    const patientCalls = callsByPatient.get(patient.id) || [];
    if (patientCalls.length === 0) continue;

    // Sort by date desc
    const sorted = [...patientCalls].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Count recent failed/missed calls
    const recentFailed = sorted.filter(
      (c) =>
        (c.status === "failed" || c.status === "missed") &&
        isLast30Days(c.created_at)
    );

    // Check if last call was failed/missed
    if (
      recentFailed.length >= 2 &&
      (sorted[0].status === "failed" || sorted[0].status === "missed")
    ) {
      result.push({
        patient,
        lastAttempt: sorted[0].created_at,
        failedCount: recentFailed.length,
        daysSinceLastAttempt: daysSince(sorted[0].created_at),
      });
    }
  }

  return result.sort((a, b) => b.failedCount - a.failedCount);
}

// ---------------------------------------------------------------------------
// Overdue follow-up detection
// ---------------------------------------------------------------------------
interface OverdueFollowUp {
  patient: Patient;
  daysSinceLastCall: number;
  expectedInterval: number;
  lastCallType: string;
}

function findOverdueFollowUps(
  patients: Patient[],
  calls: VoiceCall[]
): OverdueFollowUp[] {
  const result: OverdueFollowUp[] = [];
  const callsByPatient = new Map<string, VoiceCall[]>();
  for (const c of calls) {
    const arr = callsByPatient.get(c.patient_id) || [];
    arr.push(c);
    callsByPatient.set(c.patient_id, arr);
  }

  // Expected intervals by journey status
  const intervalMap: Record<string, number> = {
    chronic_management: 30,
    recovery: 7,
    follow_up_active: 14,
    opd_referred: 7,
    ipd_admitted: 3,
  };

  for (const patient of patients) {
    const journey = patient.journey_status || "screened";
    const expectedDays = intervalMap[journey];
    if (!expectedDays) continue;

    const patientCalls = callsByPatient.get(patient.id) || [];
    const completedCalls = patientCalls
      .filter((c) => c.status === "completed")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const lastCompleted = completedCalls[0];
    const dSince = lastCompleted
      ? daysSince(lastCompleted.created_at)
      : daysSince(patient.created_at);

    if (dSince > expectedDays) {
      result.push({
        patient,
        daysSinceLastCall: dSince,
        expectedInterval: expectedDays,
        lastCallType: lastCompleted?.call_type || lastCompleted?.use_case || "none",
      });
    }
  }

  return result.sort((a, b) => b.daysSinceLastCall - a.daysSinceLastCall);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AdminOperationsPage() {
  const { data: patients, loading: pLoad } = usePatients();
  const { data: calls, loading: cLoad } = useCallLogs();
  const { data: escalations, loading: eLoad } = useEscalations();
  const { data: doctors } = useDoctors();

  const loading = pLoad || cLoad || eLoad;

  // Today's calls
  const todayCalls = calls.filter((c) => isToday(c.created_at));
  const todayCompleted = todayCalls.filter((c) => c.status === "completed").length;
  const todayFailed = todayCalls.filter((c) => c.status === "failed").length;
  const todayMissed = todayCalls.filter((c) => c.status === "missed").length;
  const todayScheduled = todayCalls.filter((c) => c.status === "scheduled").length;
  const todayInProgress = todayCalls.filter((c) => c.status === "in_progress").length;

  // Last 7 days calls
  const weekCalls = calls.filter((c) => isLast7Days(c.created_at));
  const weekCompleted = weekCalls.filter((c) => c.status === "completed").length;
  const weekTotal = weekCalls.length;
  const weekSuccessRate = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;

  // Average call duration (TAT)
  const durationsMs = calls
    .filter((c) => c.duration_seconds && c.duration_seconds > 0)
    .map((c) => c.duration_seconds);
  const avgDuration =
    durationsMs.length > 0
      ? Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length)
      : 0;
  const avgMinutes = Math.floor(avgDuration / 60);
  const avgSeconds = avgDuration % 60;

  // No-show rate (failed+missed / total) last 30 days
  const monthCalls = calls.filter((c) => isLast30Days(c.created_at));
  const monthNoShow = monthCalls.filter(
    (c) => c.status === "failed" || c.status === "missed"
  ).length;
  const noShowRate = monthCalls.length > 0 ? Math.round((monthNoShow / monthCalls.length) * 100) : 0;

  // Open escalations
  const openEscalations = escalations.filter(
    (e) => e.status === "open" || e.status === "Open"
  );
  const criticalOpen = openEscalations.filter((e) => e.severity === "CRITICAL").length;
  const highOpen = openEscalations.filter((e) => e.severity === "HIGH").length;

  // Non-responsive patients
  const nonResponsive = findNonResponsivePatients(patients, calls);

  // Overdue follow-ups
  const overdueFollowUps = findOverdueFollowUps(patients, calls);

  // Failed call retry queue (recent failed calls)
  const failedCalls = calls
    .filter((c) => c.status === "failed" || c.status === "missed")
    .slice(0, 10);

  // Doctor workload
  const doctorWorkload = doctors.map((doc) => {
    const assigned = patients.filter((p) => p.assigned_doctor_id === doc.id);
    const highRisk = assigned.filter((p) => p.risk_level === "High").length;
    const docEscalations = openEscalations.filter((e) => {
      const patient = patients.find((p) => p.id === e.patient_id);
      return patient?.assigned_doctor_id === doc.id;
    }).length;
    const docCalls = calls.filter((c) => {
      const patient = patients.find((p) => p.id === c.patient_id);
      return patient?.assigned_doctor_id === doc.id && isLast7Days(c.created_at);
    });
    const completedRate =
      docCalls.length > 0
        ? Math.round(
            (docCalls.filter((c) => c.status === "completed").length / docCalls.length) * 100
          )
        : 0;

    return {
      name: doc.name,
      specialty: doc.specialization,
      patients: assigned.length,
      highRisk,
      openEscalations: docEscalations,
      weekCalls: docCalls.length,
      completedRate,
    };
  });

  // Patient map for name lookups
  const patientMap = new Map(patients.map((p) => [p.id, p]));

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Operations Center
        </h1>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Real-time operational control, exception handling, and workforce management.
        </p>
      </div>

      {/* KPI Row — Today's Operations */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-8 w-12" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-6">
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Today&apos;s Calls
              </CardTitle>
              <PhoneCall className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-900">{todayCalls.length}</div>
              <p className="text-[10px] text-slate-500 font-medium mt-1">
                {todayScheduled} scheduled, {todayInProgress} active
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Completed
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-900">{todayCompleted}</div>
              <p className="text-[10px] text-slate-500 font-medium mt-1">
                {weekSuccessRate}% weekly rate
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Failed / Missed
              </CardTitle>
              <PhoneMissed className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-900">
                {todayFailed + todayMissed}
              </div>
              <p className="text-[10px] text-slate-500 font-medium mt-1">
                {noShowRate}% no-show rate (30d)
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Avg Duration
              </CardTitle>
              <Timer className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-900">
                {avgMinutes}:{String(avgSeconds).padStart(2, "0")}
              </div>
              <p className="text-[10px] text-slate-500 font-medium mt-1">
                TAT per call
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800 shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Open Escalations
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-slate-300" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-white">{openEscalations.length}</div>
              <p className="text-[10px] text-slate-400 font-medium mt-1">
                {criticalOpen} critical, {highOpen} high
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800 shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Overdue Follow-ups
              </CardTitle>
              <Clock className="h-4 w-4 text-slate-300" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-white">{overdueFollowUps.length}</div>
              <p className="text-[10px] text-slate-400 font-medium mt-1">
                {nonResponsive.length} non-responsive
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Row 2: Non-responsive + Overdue */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Non-Responsive Patients */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-800">
                  <UserX className="w-4 h-4 text-slate-500" />
                  Non-Responsive Patients
                </CardTitle>
                <CardDescription className="font-medium mt-1 text-slate-500">
                  2+ failed/missed calls, no successful contact
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="bg-white border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]"
              >
                {nonResponsive.length} patients
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Patient
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Risk
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Failed
                  </TableHead>
                  <TableHead className="pr-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Last Attempt
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonResponsive.slice(0, 5).map((nr) => (
                  <TableRow key={nr.patient.id} className="hover:bg-slate-50 border-slate-100">
                    <TableCell className="pl-6 py-3">
                      <div className="font-semibold text-sm text-slate-900">
                        {nr.patient.name}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">
                        {nr.patient.health_camp}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={nr.patient.risk_level === "High" ? "destructive" : "secondary"}
                        className="text-[10px] font-bold uppercase tracking-widest"
                      >
                        {nr.patient.risk_level}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold text-slate-700">
                      {nr.failedCount}x
                    </TableCell>
                    <TableCell className="pr-6 text-[11px] text-slate-500 font-mono">
                      {nr.daysSinceLastAttempt}d ago
                    </TableCell>
                  </TableRow>
                ))}
                {nonResponsive.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500 py-8 font-medium">
                      No non-responsive patients detected.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Overdue Follow-ups */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-800">
                  <Clock className="w-4 h-4 text-slate-500" />
                  Overdue Follow-ups
                </CardTitle>
                <CardDescription className="font-medium mt-1 text-slate-500">
                  Patients past their expected call interval
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="bg-white border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]"
              >
                {overdueFollowUps.length} overdue
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Patient
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Journey
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Overdue By
                  </TableHead>
                  <TableHead className="pr-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Expected
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueFollowUps.slice(0, 5).map((od) => (
                  <TableRow key={od.patient.id} className="hover:bg-slate-50 border-slate-100">
                    <TableCell className="pl-6 py-3">
                      <div className="font-semibold text-sm text-slate-900">
                        {od.patient.name}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">
                        {od.patient.health_camp}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest">
                        {od.patient.journey_status?.replace(/_/g, " ") || "screened"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold text-slate-900">
                      +{od.daysSinceLastCall - od.expectedInterval}d
                    </TableCell>
                    <TableCell className="pr-6 text-[11px] text-slate-500 font-medium">
                      every {od.expectedInterval}d
                    </TableCell>
                  </TableRow>
                ))}
                {overdueFollowUps.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500 py-8 font-medium">
                      All follow-ups on schedule.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Failed Call Queue + Workforce Load */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Failed Call Retry Queue */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-slate-800">
              <PhoneOff className="w-4 h-4 text-slate-500" />
              Failed Call Queue
            </CardTitle>
            <CardDescription className="font-medium mt-1 text-slate-500">
              Recent failed/missed calls requiring retry
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Patient
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Call Type
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Status
                  </TableHead>
                  <TableHead className="pr-6 h-9 text-xs font-bold uppercase text-slate-400">
                    When
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedCalls.map((call) => {
                  const patient = patientMap.get(call.patient_id);
                  return (
                    <TableRow key={call.id} className="hover:bg-slate-50 border-slate-100">
                      <TableCell className="pl-6 py-3">
                        <div className="font-semibold text-sm text-slate-900">
                          {patient?.name || call.patient_id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest">
                          {(call.call_type || call.use_case || "follow_up").replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="destructive"
                          className="text-[10px] font-bold uppercase tracking-widest"
                        >
                          {call.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-[11px] text-slate-500 font-mono">
                        {timeAgo(call.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {failedCalls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500 py-8 font-medium">
                      No failed calls in queue.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Workforce Load Distribution */}
        <Card className="border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-slate-800">
              <Users className="w-4 h-4 text-slate-500" />
              Workforce Load
            </CardTitle>
            <CardDescription className="font-medium mt-1 text-slate-500">
              Doctor workload, escalation burden, and call success rates
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Doctor
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Patients
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    High Risk
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Escalations
                  </TableHead>
                  <TableHead className="pr-6 h-9 text-xs font-bold uppercase text-slate-400">
                    7d Success
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doctorWorkload.map((doc) => (
                  <TableRow key={doc.name} className="hover:bg-slate-50 border-slate-100">
                    <TableCell className="pl-6 py-3">
                      <div className="font-semibold text-sm text-slate-900">{doc.name}</div>
                      <div className="text-[10px] font-medium text-slate-500">
                        {doc.specialty}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-700">{doc.patients}</TableCell>
                    <TableCell>
                      <span
                        className={`font-mono text-sm font-semibold ${
                          doc.highRisk >= 10
                            ? "text-slate-900"
                            : doc.highRisk >= 5
                            ? "text-slate-600"
                            : "text-slate-400"
                        }`}
                      >
                        {doc.highRisk}
                      </span>
                    </TableCell>
                    <TableCell>
                      {doc.openEscalations > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {doc.openEscalations}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex items-center gap-2">
                        <div className="w-12 bg-slate-100 rounded-full h-1.5">
                          <div
                            className="bg-slate-600 h-1.5 rounded-full"
                            style={{ width: `${doc.completedRate}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-slate-600">
                          {doc.completedRate}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Outcome Metrics Summary */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <CardTitle className="flex items-center gap-2 text-base text-slate-800">
            <Activity className="w-4 h-4 text-slate-500" />
            Outcome Metrics (30-Day)
          </CardTitle>
          <CardDescription className="font-medium text-slate-500">
            Clinical and operational outcomes — no-show, readmission indicators, turnaround
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <div className="grid gap-4 md:grid-cols-5">
            {[
              {
                label: "No-Show Rate",
                value: `${noShowRate}%`,
                sub: `${monthNoShow} of ${monthCalls.length} calls`,
                icon: TrendingDown,
              },
              {
                label: "Avg TAT",
                value: `${avgMinutes}:${String(avgSeconds).padStart(2, "0")}`,
                sub: `${durationsMs.length} calls measured`,
                icon: Timer,
              },
              {
                label: "Escalation Rate",
                value: `${
                  monthCalls.length > 0
                    ? Math.round(
                        (escalations.filter((e) => isLast30Days(e.created_at)).length /
                          monthCalls.length) *
                          100
                      )
                    : 0
                }%`,
                sub: "of calls generate escalations",
                icon: AlertTriangle,
              },
              {
                label: "Recovery Compliance",
                value: `${
                  patients.filter((p) => p.journey_status === "recovery").length
                }`,
                sub: "patients in recovery track",
                icon: RefreshCw,
              },
              {
                label: "Chronic Adherence",
                value: `${
                  patients.filter((p) => p.journey_status === "chronic_management").length
                }`,
                sub: "active chronic patients",
                icon: Activity,
              },
            ].map((m) => (
              <div
                key={m.label}
                className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm text-center"
              >
                <m.icon className="w-5 h-5 text-slate-400 mx-auto mb-2" />
                <div className="text-2xl font-black text-slate-900 tracking-tight">
                  {m.value}
                </div>
                <div className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wider">
                  {m.label}
                </div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5">{m.sub}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
