"use client";

import { useState, useCallback, useEffect } from "react";
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
  useEscalations,
  useRealtimeEscalations,
  usePatientNames,
  updateEscalationStatus,
  type Escalation,
} from "@/hooks/use-supabase";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------
type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

const severityOrder: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function normaliseSeverity(raw: string): Severity {
  const up = raw.toUpperCase();
  if (up === "CRITICAL") return "CRITICAL";
  if (up === "HIGH") return "HIGH";
  if (up === "MODERATE") return "MODERATE";
  return "LOW";
}

function isResolved(status: string): boolean {
  return status === "resolved" || status === "Resolved";
}

function isInProgress(status: string): boolean {
  return status === "in_progress" || status === "In Progress";
}

// ---------------------------------------------------------------------------
// Realtime alert banner
// ---------------------------------------------------------------------------
interface AlertBannerProps {
  escalation: Escalation;
  patientName: string;
  onDismiss: () => void;
}

function AlertBanner({ escalation, patientName, onDismiss }: AlertBannerProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500" />
        </span>
        <span className="font-semibold text-slate-900">New Escalation</span>
        <Badge variant="outline" className="text-xs font-bold">
          {escalation.severity}
        </Badge>
        <span className="text-slate-600">{patientName}</span>
        <span className="text-slate-400 hidden sm:inline">&mdash; {escalation.reason.slice(0, 60)}</span>
      </div>
      <button
        onClick={onDismiss}
        className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Dismiss alert"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity badge component
// ---------------------------------------------------------------------------
function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = {
    CRITICAL: "bg-slate-900 text-white border-slate-900",
    HIGH: "bg-slate-700 text-white border-slate-700",
    MODERATE: "bg-slate-200 text-slate-700 border-slate-300",
    LOW: "bg-white text-slate-400 border-slate-200",
  };

  return (
    <Badge variant="outline" className={`text-[10px] font-bold tracking-wider uppercase ${styles[severity]}`}>
      {severity}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Status badge component
// ---------------------------------------------------------------------------
function StatusBadge({ status, selfAssigned }: { status: string; selfAssigned?: boolean }) {
  if (isResolved(status)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        Resolved
      </span>
    );
  }
  if (isInProgress(status) || selfAssigned) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-900">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
      Open
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function DoctorEscalationsPage() {
  // ---- Supabase hooks ----
  const { data: fetchedEscalations, loading, refetch } = useEscalations();
  const { data: patientNames } = usePatientNames();

  // Build name lookup map
  const nameMap = new Map(patientNames.map((p) => [p.id, p.name]));

  // ---- Realtime alerts ----
  const [alertQueue, setAlertQueue] = useState<Escalation[]>([]);

  const handleNewEscalation = useCallback((esc: Escalation) => {
    setAlertQueue((prev) => [esc, ...prev]);
    refetch();
  }, [refetch]);

  const liveEscalations = useRealtimeEscalations(handleNewEscalation);

  const dismissAlert = useCallback(() => {
    setAlertQueue((prev) => prev.slice(1));
  }, []);

  // ---- Optimistic local status map (id → status) ----
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});
  const [selfAssigned, setSelfAssigned] = useState<Record<string, boolean>>({});
  const [mutating, setMutating] = useState<Record<string, boolean>>({});

  // ---- Filter state ----
  const [severityFilter, setSeverityFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  // Merge: live (realtime inserts) + fetched, deduped
  const liveIds = new Set(liveEscalations.map((e) => e.id));
  const allEscalations: Escalation[] = [
    ...liveEscalations,
    ...fetchedEscalations.filter((e) => !liveIds.has(e.id)),
  ].map((e) =>
    localStatus[e.id] !== undefined ? { ...e, status: localStatus[e.id] } : e
  );

  // ---- Filter + sort ----
  const filtered = allEscalations
    .filter(
      (e) =>
        severityFilter === "All" ||
        normaliseSeverity(e.severity) === severityFilter
    )
    .filter((e) => {
      if (search === "") return true;
      const patientLabel = (nameMap.get(e.patient_id) ?? e.patient_id).toLowerCase();
      return (
        patientLabel.includes(search.toLowerCase()) ||
        e.reason.toLowerCase().includes(search.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        severityOrder[normaliseSeverity(a.severity)] -
        severityOrder[normaliseSeverity(b.severity)]
    );

  // ---- Stats ----
  const stats = {
    open: allEscalations.filter((e) => e.status === "open" || e.status === "Open").length,
    inProgress: allEscalations.filter((e) => isInProgress(e.status)).length,
    resolvedToday: allEscalations.filter((e) => isResolved(e.status)).length,
    critical: allEscalations.filter((e) => normaliseSeverity(e.severity) === "CRITICAL" && !isResolved(e.status)).length,
  };

  // ---- Mutation handlers ----
  async function handleResolve(id: string) {
    setMutating((prev) => ({ ...prev, [id]: true }));
    setLocalStatus((prev) => ({ ...prev, [id]: "resolved" }));
    const { error } = await updateEscalationStatus(id, "resolved");
    if (error) {
      setLocalStatus((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      refetch();
    }
    setMutating((prev) => ({ ...prev, [id]: false }));
  }

  async function handleAssignToMe(id: string) {
    setSelfAssigned((prev) => ({ ...prev, [id]: true }));
    setMutating((prev) => ({ ...prev, [id]: true }));
    const { error } = await updateEscalationStatus(id, "in_progress");
    if (error) {
      setSelfAssigned((prev) => ({ ...prev, [id]: false }));
    } else {
      refetch();
    }
    setMutating((prev) => ({ ...prev, [id]: false }));
  }

  async function handleReopen(id: string) {
    setMutating((prev) => ({ ...prev, [id]: true }));
    setLocalStatus((prev) => ({ ...prev, [id]: "open" }));
    setSelfAssigned((prev) => ({ ...prev, [id]: false }));
    const { error } = await updateEscalationStatus(id, "open");
    if (error) {
      setLocalStatus((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      refetch();
    }
    setMutating((prev) => ({ ...prev, [id]: false }));
  }

  return (
    <div className="space-y-6">
      {/* Realtime alert banners */}
      {alertQueue.length > 0 && (
        <div className="space-y-2">
          <AlertBanner
            key={alertQueue[0].id}
            escalation={alertQueue[0]}
            patientName={nameMap.get(alertQueue[0].patient_id) ?? "Unknown Patient"}
            onDismiss={dismissAlert}
          />
        </div>
      )}

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Escalation Queue</h1>
        <p className="text-sm text-slate-500">
          Patients flagged by Voice AI during automated calls. Review the concern, take action, or escalate to a doctor.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-900/20 bg-slate-50">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium">Critical Open</CardDescription>
            <CardTitle className="text-3xl font-black text-slate-900">
              {stats.critical}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium">Open</CardDescription>
            <CardTitle className="text-3xl font-bold">{stats.open}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium">In Progress</CardDescription>
            <CardTitle className="text-3xl font-bold text-slate-600">
              {stats.inProgress}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs font-medium">Resolved</CardDescription>
            <CardTitle className="text-3xl font-bold text-slate-400">
              {stats.resolvedToday}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search patient or reason..."
          className="max-w-xs h-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1.5 flex-wrap">
          {["All", "CRITICAL", "HIGH", "MODERATE", "LOW"].map((sev) => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(sev)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                severityFilter === sev
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {sev === "All" ? "All" : sev.charAt(0) + sev.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {loading && (
          <span className="text-xs text-slate-400 ml-2 animate-pulse">Loading…</span>
        )}
      </div>

      {/* Escalation Table */}
      <Card>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-b border-slate-200">
                <TableHead className="w-[14%] pl-5 h-11 text-xs font-semibold uppercase tracking-wider text-slate-500">Patient</TableHead>
                <TableHead className="w-[8%] h-11 text-xs font-semibold uppercase tracking-wider text-slate-500">Severity</TableHead>
                <TableHead className="w-[8%] h-11 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</TableHead>
                <TableHead className="h-11 text-xs font-semibold uppercase tracking-wider text-slate-500">Reason</TableHead>
                <TableHead className="w-[7%] h-11 text-xs font-semibold uppercase tracking-wider text-slate-500">Time</TableHead>
                <TableHead className="w-[16%] h-11 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right pr-5">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-400 py-16 text-sm">
                    {loading ? "Loading escalations…" : "No escalations match your filters."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((esc) => {
                const severity = normaliseSeverity(esc.severity);
                const resolved = isResolved(esc.status);
                const isMutating = mutating[esc.id] ?? false;
                const patientName = nameMap.get(esc.patient_id) ?? "Unknown";

                return (
                  <TableRow
                    key={esc.id}
                    className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Patient */}
                    <TableCell className="pl-5 py-3.5">
                      <div className={`font-semibold text-sm truncate ${resolved ? "text-slate-400" : "text-slate-900"}`}>{patientName}</div>
                      <div className="text-[10px] text-slate-300 font-mono mt-0.5 tracking-wide">
                        {esc.patient_id.slice(0, 8).toUpperCase()}
                      </div>
                    </TableCell>

                    {/* Severity */}
                    <TableCell className="py-3.5">
                      {resolved ? (
                        <Badge variant="outline" className="text-[10px] font-bold tracking-wider uppercase text-slate-300 border-slate-200 bg-white">
                          {severity}
                        </Badge>
                      ) : (
                        <SeverityBadge severity={severity} />
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="py-3.5">
                      <StatusBadge status={esc.status} selfAssigned={selfAssigned[esc.id]} />
                    </TableCell>

                    {/* Reason */}
                    <TableCell className="py-3.5 overflow-hidden">
                      <span className={`text-sm leading-relaxed line-clamp-2 ${resolved ? "text-slate-300" : "text-slate-600"}`}>
                        {esc.reason}
                      </span>
                    </TableCell>

                    {/* Time */}
                    <TableCell className={`py-3.5 text-xs tabular-nums ${resolved ? "text-slate-300" : "text-slate-400"}`}>
                      {timeAgo(esc.created_at)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="py-3.5 text-right pr-5">
                      {!resolved ? (
                        <div className="flex gap-1.5 justify-end">
                          {!selfAssigned[esc.id] && !esc.assigned_to && (
                            <Button
                              size="sm"
                              className="text-xs h-7 px-2.5 font-medium bg-slate-900 hover:bg-slate-800 text-white"
                              disabled={isMutating}
                              onClick={() => handleAssignToMe(esc.id)}
                            >
                              {isMutating ? "…" : "Own"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2.5 font-medium text-slate-600 border-slate-200 hover:bg-slate-50"
                            disabled={isMutating}
                            onClick={() => handleResolve(esc.id)}
                          >
                            {isMutating ? "…" : "Resolved"}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2.5 font-medium text-slate-400 border-slate-200 hover:text-slate-700 hover:bg-slate-50"
                          disabled={isMutating}
                          onClick={() => handleReopen(esc.id)}
                        >
                          {isMutating ? "…" : "Reopen"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
