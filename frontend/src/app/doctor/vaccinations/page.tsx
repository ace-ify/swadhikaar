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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Syringe,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Baby,
  Calendar,
  Phone,
  Loader2,
  User,
  HeartPulse,
} from "lucide-react";
import {
  useNewborns,
  useVaccinationSchedules,
  usePatientNames,
  usePatients,
  useCallLogs,
  updateVaccinationStatus,
  createAuditLog,
  type Newborn,
  type VaccinationSchedule,
  type Patient,
} from "@/hooks/use-supabase";
import { toast } from "sonner";
import { useState } from "react";
import { callStartVoiceCall } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function babyAge(dob: string): string {
  const birth = new Date(dob);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days} days`;
  if (days < 30) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

function babyAgeVerbose(dob: string): string {
  const birth = new Date(dob);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""} old`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks !== 1 ? "s" : ""} old`;
  }
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} old`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge
          variant="secondary"
          className="bg-slate-100 text-slate-800 border-slate-300 text-[10px] uppercase tracking-widest font-bold"
        >
          <CheckCircle2 className="w-3 h-3 mr-1" /> Done
        </Badge>
      );
    case "overdue":
      return (
        <Badge
          variant="outline"
          className="text-[10px] uppercase tracking-widest font-bold bg-slate-900 text-white border-slate-900"
        >
          <AlertTriangle className="w-3 h-3 mr-1" /> Overdue
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="text-slate-700 bg-slate-50 border-slate-200 text-[10px] uppercase tracking-widest font-bold"
        >
          <Clock className="w-3 h-3 mr-1" /> Upcoming
        </Badge>
      );
  }
}

// ---------------------------------------------------------------------------
// Vaccination Call Sheet — Parent-centric UI
// ---------------------------------------------------------------------------
function VaccinationCallSheet({
  newborn,
  parent,
  schedule,
  allSchedules,
  onClose,
  calling,
  onCall,
}: {
  newborn: Newborn;
  parent: Patient | null;
  schedule: VaccinationSchedule;
  allSchedules: VaccinationSchedule[];
  onClose: () => void;
  calling: boolean;
  onCall: (phoneNumber?: string) => void;
}) {
  const parentPhone = parent?.phone || newborn.phone || "";
  const [phoneNumber, setPhoneNumber] = useState(parentPhone);

  // All schedules for this baby, sorted by due_date
  const babySchedules = allSchedules
    .filter((s) => s.newborn_id === newborn.id)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

  const completedDoses = babySchedules.filter((s) => s.status === "completed").length;
  const totalDoses = babySchedules.length;
  const completionPct = totalDoses > 0 ? Math.round((completedDoses / totalDoses) * 100) : 0;

  const daysLeft = daysUntil(schedule.due_date);

  return (
    <Sheet open onOpenChange={(val) => !val && onClose()}>
      <SheetContent className="sm:max-w-[540px] w-[95vw] flex flex-col p-0 gap-0 border-l border-slate-200 shadow-2xl">
        {/* Header — Baby-centric */}
        <div className="px-6 py-6 border-b bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-widest ${
                schedule.status === "overdue"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-slate-100 text-slate-700 border-slate-300"
              }`}
            >
              <Syringe className="w-3 h-3 mr-1" />
              {schedule.status === "overdue" ? "Overdue" : "Due Soon"}
            </Badge>
            <span className="text-xs text-slate-400 font-mono">
              Dose {schedule.dose_number}
            </span>
          </div>
          <SheetTitle className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Baby className="w-6 h-6 text-slate-400" />
            {newborn.baby_name}
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-500 mt-1.5 flex items-center gap-3 flex-wrap">
            <span>{babyAgeVerbose(newborn.date_of_birth)}</span>
            <span className="text-slate-300">|</span>
            <span>{newborn.gender}</span>
            <span className="text-slate-300">|</span>
            <span>{newborn.birth_weight_kg} kg at birth</span>
          </SheetDescription>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 bg-slate-50/30">
          {/* Next Vaccine Card */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Next Vaccine Due
            </h4>
            <div className="border rounded-xl p-4 bg-white shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">
                    {schedule.vaccine_name}
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    Dose {schedule.dose_number} &middot; Due at{" "}
                    {schedule.due_age}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-2xl font-black tracking-tight ${
                      daysLeft < 0
                        ? "text-slate-900"
                        : daysLeft <= 3
                        ? "text-slate-700"
                        : "text-slate-500"
                    }`}
                  >
                    {daysLeft < 0
                      ? `${Math.abs(daysLeft)}d overdue`
                      : daysLeft === 0
                      ? "Today"
                      : `${daysLeft}d left`}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {formatDate(schedule.due_date)}
                  </div>
                </div>
              </div>
              {schedule.route_site && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Route / Site
                    </div>
                    <div className="text-xs font-medium text-slate-700 mt-0.5">
                      {schedule.route_site}
                    </div>
                  </div>
                  {schedule.remarks && (
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                        Notes
                      </div>
                      <div className="text-xs font-medium text-slate-700 mt-0.5">
                        {schedule.remarks}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Vaccination Timeline */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Vaccination Timeline
              <span className="ml-2 text-slate-300 font-normal normal-case">
                ({completedDoses}/{totalDoses} complete)
              </span>
            </h4>
            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>{completionPct}% immunized</span>
                <span>
                  {completedDoses} of {totalDoses} doses
                </span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-slate-700 rounded-full transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
            {/* Timeline list */}
            <div className="space-y-1.5">
              {babySchedules.map((vs) => (
                <div
                  key={vs.id}
                  className={`flex items-center justify-between border rounded-lg px-3 py-2 ${
                    vs.id === schedule.id
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white border-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {vs.status === "completed" ? (
                      <CheckCircle2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          vs.id === schedule.id
                            ? "text-slate-300"
                            : "text-slate-400"
                        }`}
                      />
                    ) : vs.status === "overdue" ? (
                      <AlertTriangle
                        className={`w-3.5 h-3.5 shrink-0 ${
                          vs.id === schedule.id
                            ? "text-white"
                            : "text-slate-700"
                        }`}
                      />
                    ) : (
                      <Clock
                        className={`w-3.5 h-3.5 shrink-0 ${
                          vs.id === schedule.id
                            ? "text-slate-300"
                            : "text-slate-300"
                        }`}
                      />
                    )}
                    <span
                      className={`text-xs font-medium truncate ${
                        vs.id === schedule.id
                          ? "text-white"
                          : vs.status === "completed"
                          ? "text-slate-400"
                          : "text-slate-700"
                      }`}
                    >
                      {vs.vaccine_name} (Dose {vs.dose_number})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-mono ${
                        vs.id === schedule.id
                          ? "text-slate-300"
                          : "text-slate-400"
                      }`}
                    >
                      {vs.due_age}
                    </span>
                    {vs.status === "completed" && vs.administered_at && (
                      <CheckCircle2
                        className={`w-3 h-3 ${
                          vs.id === schedule.id
                            ? "text-slate-300"
                            : "text-slate-400"
                        }`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Parent Info */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              <User className="w-3 h-3 inline mr-1" />
              Parent Details (Call Recipient)
            </h4>
            <div className="border rounded-lg bg-white divide-y divide-slate-100">
              {[
                {
                  label: "Parent Name",
                  value: parent?.name || "Unknown",
                },
                {
                  label: "Phone",
                  value: parentPhone || "Not recorded",
                },
                { label: "Language", value: parent?.language || newborn.language || "hindi" },
                {
                  label: "Health Camp",
                  value: parent?.health_camp || "—",
                },
                {
                  label: "Birth Hospital",
                  value: newborn.birth_hospital || "—",
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-xs text-slate-400">{row.label}</span>
                  <span className="text-xs font-medium text-slate-700">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer — Vaccination call initiation */}
        <div className="p-4 border-t bg-white shrink-0 space-y-3">
          {/* Context banner */}
          <div className="flex items-start gap-2 px-1">
            <Syringe className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-700">
                  Vaccination Reminder Call
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-700 border-slate-300"
                >
                  {schedule.vaccine_name}
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                AI will call {parent?.name || "parent"} in Hindi to remind about{" "}
                {newborn.baby_name}&apos;s {schedule.vaccine_name} (Dose{" "}
                {schedule.dose_number})
              </p>
            </div>
          </div>

          {/* Phone + Call button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-slate-500"
            >
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
              onClick={() => onCall(phoneNumber || undefined)}
              className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
              {calling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Phone className="w-3.5 h-3.5" />
              )}
              {calling ? "Calling..." : "Call Parent"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function VaccinationsPage() {
  const { data: newborns, loading: nbLoading } = useNewborns();
  const {
    data: schedules,
    loading: sLoading,
    refetch: refetchSchedules,
  } = useVaccinationSchedules();
  const { data: patientNames } = usePatientNames();
  const { data: patients } = usePatients();
  const { data: calls } = useCallLogs();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [callingSchedule, setCallingSchedule] = useState<string | null>(null);
  const [selectedSchedule, setSelectedSchedule] =
    useState<VaccinationSchedule | null>(null);
  const loading = nbLoading || sLoading;

  const parentMap = new Map(patientNames.map((p) => [p.id, p.name]));
  const patientMap = new Map(patients.map((p) => [p.id, p]));
  const newbornMap = new Map(newborns.map((n) => [n.id, n]));

  // Stats
  const overdueCount = schedules.filter((s) => s.status === "overdue").length;
  const upcomingCount = schedules.filter((s) => s.status === "pending").length;
  const completedCount = schedules.filter(
    (s) => s.status === "completed"
  ).length;

  // Vaccination call history count
  const vacCallCount = calls.filter(
    (c) =>
      c.call_type === "newborn_vaccination" ||
      c.use_case === "newborn_vaccination"
  ).length;

  // Overdue + pending sorted by due_date
  const actionableSchedules = schedules
    .filter((s) => s.status === "overdue" || s.status === "pending")
    .sort(
      (a, b) =>
        new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    );

  async function handleMarkDone(scheduleId: string) {
    setMarkingId(scheduleId);
    const { error } = await updateVaccinationStatus(scheduleId, "completed");
    if (error) {
      toast.error(error);
    } else {
      await createAuditLog({
        user_role: "doctor",
        action: "vaccination_administered",
        resource_type: "vaccination_schedule",
        resource_id: scheduleId,
      });
      refetchSchedules();
      toast.success("Vaccination marked as administered");
    }
    setMarkingId(null);
  }

  async function handleVaccinationCall(
    schedule: VaccinationSchedule,
    phoneNumber?: string
  ) {
    const baby = newbornMap.get(schedule.newborn_id);
    if (!baby) {
      toast.error("Baby record not found");
      return;
    }
    const parent = patientMap.get(baby.parent_patient_id);

    setCallingSchedule(schedule.id);
    try {
      const data = await callStartVoiceCall({
        language: parent?.language || baby.language || "hindi",
        patient_id: baby.parent_patient_id,
        patient_name: parent?.name || "Parent",
        call_type: "newborn_vaccination",
        phone_number: phoneNumber,
        health_camp: parent?.health_camp || "",
        risk_level: parent?.risk_level || "Low",
        risk_score: parent?.overall_risk_score || 0,
        baby_name: baby.baby_name,
        baby_age: babyAge(baby.date_of_birth),
        baby_gender: baby.gender,
        next_vaccine: schedule.vaccine_name,
        vaccine_dose: String(schedule.dose_number),
        vaccine_due_date: formatDate(schedule.due_date),
        birth_hospital: baby.birth_hospital || "",
      });
      if (data.error) throw new Error(data.error);
      await createAuditLog({
        user_role: "coordinator",
        action: "vaccination_call_initiated",
        resource_type: "voice_call",
        resource_id: data.call_id,
        details: {
          baby_name: baby.baby_name,
          vaccine: schedule.vaccine_name,
          dose: schedule.dose_number,
          parent_name: parent?.name,
        },
      });
      const callStatus = String(data.status || "").toLowerCase();
      if (callStatus === "dialing") {
        toast.success(
          `Call initiated for ${parent?.name || "parent"}`,
          {
            description: `${baby.baby_name} — ${schedule.vaccine_name} (Dose ${schedule.dose_number})`,
          }
        );
      } else {
        toast.error("Call not dialed", {
          description: `Function returned status: ${data.status || "unknown"}`,
        });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to initiate call");
    } finally {
      setCallingSchedule(null);
    }
  }

  // Resolve selected schedule's baby and parent for the sheet
  const selectedBaby = selectedSchedule
    ? newbornMap.get(selectedSchedule.newborn_id)
    : null;
  const selectedParent =
    selectedBaby && patientMap.get(selectedBaby.parent_patient_id);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Newborn Vaccination Tracker
        </h1>
        <p className="text-sm text-slate-500 font-medium mt-1">
          India&apos;s National Immunization Program (0-12 months). Call parents
          for reminders or confirm doses administered.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600">
              Registered Babies
            </CardTitle>
            <Baby className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-900 tracking-tight">
              {newborns.length}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600">
              Overdue Vaccines
            </CardTitle>
            <AlertTriangle className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-900 tracking-tight">
              {overdueCount}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600">
              Upcoming
            </CardTitle>
            <Calendar className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-900 tracking-tight">
              {upcomingCount}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-600">
              Completed Doses
            </CardTitle>
            <CheckCircle2 className="h-5 w-5 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-900 tracking-tight">
              {completedCount}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400">
              Reminder Calls
            </CardTitle>
            <Phone className="h-5 w-5 text-slate-300" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-white tracking-tight">
              {vacCallCount}
            </div>
            <p className="text-[10px] text-slate-400 font-medium mt-1">
              AI calls to parents
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Enrolled Newborns */}
      <Card className="shadow-sm">
        <CardHeader className="border-b bg-slate-50/50">
          <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
            <Baby className="w-5 h-5 text-slate-400" /> Enrolled Newborns
          </CardTitle>
          <CardDescription className="font-medium text-slate-500">
            Babies registered for vaccination tracking
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader className="bg-white">
              <TableRow>
                <TableHead className="pl-6 h-10 text-xs font-bold uppercase text-slate-400 w-[140px]">
                  Baby Name
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[140px]">
                  Parent
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[80px]">
                  Age
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[70px]">
                  Gender
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  Birth Hospital
                </TableHead>
                <TableHead className="text-right pr-6 h-10 text-xs font-bold uppercase text-slate-400 w-[80px]">
                  Weight
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newborns.map((nb) => (
                <TableRow
                  key={nb.id}
                  className="hover:bg-slate-50 border-slate-100"
                >
                  <TableCell className="pl-6 py-3 font-semibold text-slate-900">
                    {nb.baby_name}
                  </TableCell>
                  <TableCell className="text-slate-600 font-medium">
                    {parentMap.get(nb.parent_patient_id) || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="font-mono text-slate-600"
                    >
                      {babyAge(nb.date_of_birth)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{nb.gender}</TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {nb.birth_hospital}
                  </TableCell>
                  <TableCell className="text-right pr-6 font-mono text-slate-600">
                    {nb.birth_weight_kg} kg
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Vaccination Schedule (Actionable) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="border-b bg-slate-50/50">
          <CardTitle className="text-lg flex items-center gap-2 text-slate-800">
            <Syringe className="w-5 h-5 text-slate-400" /> Vaccination Schedule
          </CardTitle>
          <CardDescription className="font-medium text-slate-500">
            Overdue and upcoming vaccines. &quot;Call Parent&quot; triggers a
            Hindi AI reminder call. &quot;Dose Given&quot; confirms
            administration.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader className="bg-white">
              <TableRow>
                <TableHead className="pl-6 h-10 text-xs font-bold uppercase text-slate-400 w-[12%]">
                  Baby
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[10%]">
                  Parent
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[18%]">
                  Vaccine
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[8%]">
                  Due Age
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[10%]">
                  Due Date
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400 w-[10%]">
                  Status
                </TableHead>
                <TableHead className="text-right pr-6 h-10 text-xs font-bold uppercase text-slate-400 w-[22%]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actionableSchedules.map((vs) => {
                const baby = newbornMap.get(vs.newborn_id);
                const parentName = baby
                  ? parentMap.get(baby.parent_patient_id)
                  : null;
                return (
                  <TableRow
                    key={vs.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <TableCell className="pl-6 py-3 font-semibold text-slate-900 truncate">
                      {baby?.baby_name || "\u2014"}
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm truncate">
                      {parentName || "\u2014"}
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-800 truncate">
                        {vs.vaccine_name}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {vs.remarks}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 font-medium">
                      {vs.due_age}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-600">
                      {formatDate(vs.due_date)}
                    </TableCell>
                    <TableCell>{statusBadge(vs.status)}</TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={callingSchedule === vs.id}
                          onClick={() => setSelectedSchedule(vs)}
                          className="font-semibold text-xs gap-1.5"
                        >
                          <Phone className="w-3 h-3" />
                          {callingSchedule === vs.id
                            ? "Calling..."
                            : "Call Parent"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markingId === vs.id}
                          onClick={() => handleMarkDone(vs.id)}
                          className="font-semibold text-xs"
                        >
                          {markingId === vs.id ? "Saving..." : "Dose Given"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {actionableSchedules.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-slate-500 py-12 font-medium"
                  >
                    {loading
                      ? "Loading vaccination data..."
                      : "All vaccinations up to date."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Vaccination Call Sheet */}
      {selectedSchedule && selectedBaby && (
        <VaccinationCallSheet
          newborn={selectedBaby}
          parent={selectedParent || null}
          schedule={selectedSchedule}
          allSchedules={schedules}
          onClose={() => setSelectedSchedule(null)}
          calling={callingSchedule === selectedSchedule.id}
          onCall={(phoneNumber) => {
            handleVaccinationCall(selectedSchedule, phoneNumber);
          }}
        />
      )}
    </div>
  );
}
