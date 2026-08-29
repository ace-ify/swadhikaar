"use client";

import { useAuth } from "@/context/auth-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { usePatients, useCallLogs } from "@/hooks/use-supabase";
import type { VoiceCall } from "@/hooks/use-supabase";

const CALL_TYPES = ["All", "Follow-up", "Medication Check", "Health Reminder", "Screening"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusVariant(status: string): "secondary" | "outline" {
  return status === "completed" || status === "Completed" ? "secondary" : "outline";
}

function callTypeFromUseCase(useCase: string) {
  const map: Record<string, string> = {
    follow_up: "Follow-up",
    medication_check: "Medication Check",
    health_reminder: "Health Reminder",
    screening: "Screening",
  };
  return map[useCase] ?? useCase;
}

// ---------------------------------------------------------------------------
// Stats computed from data
// ---------------------------------------------------------------------------
function computeStats(calls: VoiceCall[]) {
  const total = calls.length;
  const completed = calls.filter(
    (c) => c.status === "completed" || c.status === "Completed"
  ).length;
  const noAnswer = calls.filter(
    (c) => c.status === "no_answer" || c.status === "No Answer"
  ).length;
  const durTotal = calls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
  const avgDur = total > 0 ? Math.round(durTotal / total) : 0;
  return { total, completed, noAnswer, avgDur };
}

export default function PatientCallsPage() {
  const router = useRouter();
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

  const { data: callData, loading } = useCallLogs(primaryPatientId);

  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Compute stats
  const stats = computeStats(callData);

  // Build a normalized view for the table
  const normalizedCalls = callData.map((c) => ({
    id: c.id,
    date: formatDate(c.started_at),
    time: formatTime(c.started_at),
    type: callTypeFromUseCase(c.use_case),
    duration: formatDuration(c.duration_seconds),
    language: c.language,
    status: c.status,
    summary: String((c.extracted_data as Record<string, unknown>)?.summary ?? c.transcript?.slice(0, 120) ?? "Call completed."),
    rawTranscript: c.transcript,
  }));

  const filtered =
    filter === "All"
      ? normalizedCalls
      : normalizedCalls.filter((c) => c.type === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Call History</h1>
        <p className="text-sm text-slate-500">
          Every call this system has placed to you.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Total Calls", value: loading ? "—" : String(stats.total) },
          { label: "Completed", value: loading ? "—" : String(stats.completed) },
          { label: "No Answer", value: loading ? "—" : String(stats.noAnswer) },
          {
            label: "Avg Duration",
            value: loading ? "—" : formatDuration(stats.avgDur),
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1">
              <CardDescription className="text-xs">{s.label}</CardDescription>
              <CardTitle
                className={`text-2xl ${loading ? "text-slate-300 animate-pulse" : ""}`}
              >
                {s.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-500">Filter by type:</span>
        {CALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              filter === t
                ? "bg-slate-800 text-white border-slate-800"
                : "border-slate-300 text-slate-600 hover:border-slate-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Calls Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice Call Log</CardTitle>
          <CardDescription>Click any row to expand transcript</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Call ID</TableHead>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((call) => (
                  <>
                    <TableRow
                      key={call.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() =>
                        setExpanded(expanded === call.id ? null : call.id)
                      }
                    >
                      <TableCell className="font-mono text-xs text-slate-400">
                        {call.id.slice(0, 8).toUpperCase()}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{call.date}</div>
                        <div className="text-xs text-slate-400">{call.time}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{call.type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{call.language}</TableCell>
                      <TableCell className="text-sm font-mono">{call.duration}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(call.status)} className="capitalize">
                          {call.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                        {call.summary}
                      </TableCell>
                    </TableRow>

                    {/* Expanded Row */}
                    {expanded === call.id && (
                      <TableRow key={`${call.id}-expanded`}>
                        <TableCell colSpan={7} className="bg-slate-50 p-4">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                              Transcript
                            </p>

                            {/* Show raw transcript text */}
                            {call.rawTranscript ? (
                              <div className="bg-white border rounded-xl p-3 text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                {call.rawTranscript}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic">
                                No transcript available.
                              </p>
                            )}

                            <div className="flex gap-2 mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const content = call.rawTranscript || "No transcript available.";
                                  downloadTextFile(
                                    `transcript-${call.id.slice(0, 8)}.txt`,
                                    content
                                  );
                                  toast.success("Transcript downloaded");
                                }}
                              >
                                Download Transcript
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push("/patient/records");
                                  toast.info("Opened records view");
                                }}
                              >
                                View FHIR Record
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
