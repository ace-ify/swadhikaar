"use client";

import { useState, useMemo } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePatients, type Patient, createAuditLog } from "@/hooks/use-supabase";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Display shape
// ---------------------------------------------------------------------------

interface DisplayPatient {
  id: string;
  name: string;
  abha: string;
  camp: string;
  campType: string;
  risk: string;
  riskScore: number;
  consent: string;
  doctor: string;
}

const RISK_LEVELS = ["All", "High", "Moderate", "Low"];

// ---------------------------------------------------------------------------
// Normalisation: map a Supabase Patient to the display shape
// ---------------------------------------------------------------------------

function toDisplayPatient(p: Patient): DisplayPatient {
  const cap = (s: string | null | undefined) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "—";

  // camp_type is nullable — patients who arrived via an acute incident were never
  // at a health camp (see migration acute_care_seam).
  const campTypeMap: Record<string, string> = {
    elderly: "Elderly",
    slum: "Slum",
    deaddiction: "Deaddiction",
    general: "General",
  };
  const campType = p.camp_type
    ? campTypeMap[p.camp_type.toLowerCase()] ?? p.camp_type
    : "—";

  return {
    id: p.id,
    name: p.name,
    abha: p.abha_id ?? "—",
    camp: p.health_camp ?? "—",
    campType,
    risk: cap(p.risk_level),
    riskScore:
      p.overall_risk_score == null
        ? 0
        : Math.round(p.overall_risk_score * 10) / 10,
    consent: cap(p.consent_status),
    doctor: p.assigned_doctor_id ?? "Unassigned",
  };
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function TableRowSkeleton() {
  return (
    <TableRow>
      {Array.from({ length: 10 }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminPatientsPage() {
  const { data: supabasePatients, loading, error } = usePatients();

  const [search, setSearch] = useState("");
  const [campFilter, setCampFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  // Use real Supabase data — no fallbacks
  const allPatients: DisplayPatient[] = useMemo(
    () => supabasePatients.map(toDisplayPatient),
    [supabasePatients]
  );

  // Derive dynamic camp types from actual data
  const campTypes = useMemo(() => {
    const types = Array.from(new Set(allPatients.map((p) => p.campType))).sort();
    return ["All", ...types];
  }, [allPatients]);

  const filtered = useMemo(
    () =>
      allPatients
        .filter((p) => campFilter === "All" || p.campType === campFilter)
        .filter((p) => riskFilter === "All" || p.risk === riskFilter)
        .filter(
          (p) =>
            search === "" ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.abha.includes(search) ||
            p.camp.toLowerCase().includes(search.toLowerCase())
        ),
    [allPatients, campFilter, riskFilter, search]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  }

  function exportPatientsCSV(rows: DisplayPatient[]) {
    const headers = [
      "id",
      "name",
      "abha",
      "camp",
      "campType",
      "risk",
      "riskScore",
      "consent",
      "doctor",
      "age",
    ];
    const csv = [
      headers.join(","),
      ...rows.map((p) =>
        headers
          .map((h) => {
            const v = String((p as unknown as Record<string, unknown>)[h] ?? "");
            return `"${v.replace(/"/g, '""')}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `patients-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportCSV() {
    exportPatientsCSV(filtered);
    await createAuditLog({
      user_role: "admin",
      action: "patients_exported_csv",
      resource_type: "patient",
      details: { count: filtered.length },
    });
    toast.success("Patients CSV exported");
  }

  async function handleBulkApply() {
    if (!bulkAction || selected.size === 0) return;
    await createAuditLog({
      user_role: "admin",
      action: `patients_bulk_${bulkAction}`,
      resource_type: "patient",
      details: { selected_ids: Array.from(selected), count: selected.size },
    });
    toast.success(`Bulk action applied: ${bulkAction}`);
    setSelected(new Set());
    setBulkAction("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Patients</h1>
          <div className="text-sm text-slate-500">
            {loading ? (
              <Skeleton className="h-3 w-48 mt-1" />
            ) : (
              `${allPatients.length} patients across ${
                new Set(allPatients.map((p) => p.camp)).size
              } health camps${error ? " (sample data)" : ""}`
            )}
          </div>
        </div>
        <Button variant="outline" onClick={handleExportCSV}>Export CSV</Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Total</CardDescription>
            <CardTitle className="text-2xl">
              {loading ? <Skeleton className="h-8 w-12" /> : allPatients.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">High Risk</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {loading ? (
                <Skeleton className="h-8 w-8" />
              ) : (
                allPatients.filter((p) => p.risk === "High").length
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Consent Granted</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {loading ? (
                <Skeleton className="h-8 w-8" />
              ) : (
                allPatients.filter((p) => p.consent === "Granted").length
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Consent Pending</CardDescription>
            <CardTitle className="text-2xl text-slate-600">
              {loading ? (
                <Skeleton className="h-8 w-8" />
              ) : (
                allPatients.filter((p) => p.consent === "Pending").length
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-slate-200">
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Consent Revoked</CardDescription>
            <CardTitle className="text-2xl text-slate-500">
              {loading ? (
                <Skeleton className="h-8 w-8" />
              ) : (
                allPatients.filter((p) => p.consent === "Revoked").length
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters + Bulk Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name, ABHA, camp..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="text-sm border border-input rounded-md px-3 py-2 text-muted-foreground bg-background"
          value={campFilter}
          onChange={(e) => setCampFilter(e.target.value)}
        >
           {campTypes.map(
             (c) => (
               <option key={c}>{c}</option>
             )
          )}
        </select>
        <select
          className="text-sm border border-input rounded-md px-3 py-2 text-muted-foreground bg-background"
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
        >
          {RISK_LEVELS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-slate-500">{selected.size} selected</span>
            <select
              className="text-sm border border-input rounded-md px-3 py-2 text-muted-foreground bg-background"
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
            >
              <option value="">Bulk Actions</option>
              <option value="schedule">Schedule Follow-up</option>
              <option value="export">Export Selected</option>
              <option value="reassign">Reassign Doctor</option>
            </select>
            {bulkAction && (
              <Button size="sm" onClick={handleBulkApply}>
                Apply
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    checked={
                      selected.size === filtered.length && filtered.length > 0
                    }
                    onChange={toggleAll}
                    className="rounded"
                  />
                </TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>ABHA ID</TableHead>
                <TableHead>Camp</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Consent</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRowSkeleton key={i} />
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-center text-sm text-slate-400 py-8"
                  >
                    No patients match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow
                    key={p.id}
                    className={selected.has(p.id) ? "bg-blue-50" : ""}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{p.name}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {p.abha}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {p.camp}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {p.campType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.risk === "High"
                            ? "destructive"
                            : p.risk === "Moderate"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {p.risk}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`font-mono text-sm font-semibold ${
                          p.riskScore >= 50
                            ? "text-slate-900"
                            : p.riskScore >= 35
                            ? "text-slate-600"
                            : "text-slate-400"
                        }`}
                      >
                        {p.riskScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.consent === "Granted"
                            ? "text-slate-800 border-slate-300 bg-slate-100"
                            : p.consent === "Pending"
                            ? "text-slate-500 border-slate-200 bg-slate-50"
                            : "text-slate-900 border-slate-400 bg-slate-200"
                        }
                      >
                        {p.consent}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {p.doctor}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs px-2 text-slate-600"
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
