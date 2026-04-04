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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDoctors, usePatients, useEscalations, useCallLogs } from "@/hooks/use-supabase";

const escalationRules = [
  {
    severity: "CRITICAL (Level 1)",
    response: "< 5 minutes",
    action: "Immediate doctor notification via Supabase Realtime push",
    channel: "In-app + SMS",
    auto: true,
  },
  {
    severity: "HIGH (Level 2)",
    response: "< 1 hour",
    action: "Alert assigned doctor, add to review queue",
    channel: "In-app",
    auto: true,
  },
  {
    severity: "MODERATE (Level 3)",
    response: "< 24 hours",
    action: "Schedule routine follow-up call within 24 hours",
    channel: "Queue",
    auto: false,
  },
  {
    severity: "LOW",
    response: "Next cycle",
    action: "Log and include in next scheduled workflow call",
    channel: "Queue",
    auto: false,
  },
];

export default function AdminCoordinationPage() {
  const { data: rawDoctors } = useDoctors();
  const { data: rawPatients } = usePatients();
  const { data: rawEscalations } = useEscalations();
  const { data: rawCalls } = useCallLogs();

  // Build escalation counts per doctor (via patient assignment)
  const escByDoctor = new Map<string, number>();
  const patientDoctorMap = new Map(rawPatients.map((p) => [p.id, p.assigned_doctor_id]));
  for (const esc of rawEscalations) {
    if (esc.status !== "open" && esc.status !== "Open") continue;
    const docId = patientDoctorMap.get(esc.patient_id);
    if (docId) escByDoctor.set(docId, (escByDoctor.get(docId) || 0) + 1);
  }

  const doctors = rawDoctors.map((doc) => {
    const assigned = rawPatients.filter((p) => p.assigned_doctor_id === doc.id);
    const highRisk = assigned.filter(
      (p) => p.risk_level === "High" || p.overall_risk_score >= 50
    ).length;
    const camps = Array.from(new Set(assigned.map((p) => p.health_camp).filter(Boolean)));
    return {
      name: doc.name,
      id: doc.id,
      specialty: doc.specialization ?? "General Medicine",
      patients: assigned.length,
      highRisk,
      camps,
      availability: "Available",
      escalationsOpen: escByDoctor.get(doc.id) || 0,
    };
  });

  // Compute camp distribution from live data when available
  const campDistribution = rawPatients.length > 0
    ? (() => {
        const campMap = new Map<
          string,
          { camp: string; type: string; total: number; high: number; moderate: number; low: number; primaryDoctor: string }
        >();
        for (const p of rawPatients) {
          const campName = p.health_camp ?? "Unknown";
          if (!campMap.has(campName)) {
            campMap.set(campName, {
              camp: campName,
              type: p.camp_type ?? "General",
              total: 0,
              high: 0,
              moderate: 0,
              low: 0,
              primaryDoctor: "",
            });
          }
          const entry = campMap.get(campName)!;
          entry.total += 1;
          const rl = (p.risk_level ?? "").toLowerCase();
          const score = p.overall_risk_score ?? 0;
          if (rl === "high" || score >= 70) entry.high += 1;
          else if (rl === "moderate" || score >= 40) entry.moderate += 1;
          else entry.low += 1;
        }
        // Assign primary doctor per camp: the doctor with the most patients there
        for (const [campName, entry] of campMap.entries()) {
          const campPatients = rawPatients.filter((p) => p.health_camp === campName && p.assigned_doctor_id);
          const doctorCount = new Map<string, number>();
          for (const p of campPatients) {
            doctorCount.set(p.assigned_doctor_id!, (doctorCount.get(p.assigned_doctor_id!) ?? 0) + 1);
          }
          let topId = "";
          let topCount = 0;
          for (const [did, count] of doctorCount.entries()) {
            if (count > topCount) { topCount = count; topId = did; }
          }
          const docRecord = rawDoctors.find((d) => d.id === topId);
          entry.primaryDoctor = docRecord ? docRecord.name : "";
        }
        return Array.from(campMap.values()).map((e) => {
          // Compute response rate: completed calls / total calls for patients in this camp
          const campPatientIds = new Set(
            rawPatients.filter((p) => p.health_camp === e.camp).map((p) => p.id)
          );
          const campCalls = rawCalls.filter((c) => campPatientIds.has(c.patient_id));
          const campCompleted = campCalls.filter((c) => c.status === "completed").length;
          const rate = campCalls.length > 0
            ? `${Math.round((campCompleted / campCalls.length) * 100)}%`
            : "—";
          return {
            ...e,
            responseRate: rate,
          };
        });
      })()
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Care Coordination</h1>
        <p className="text-sm text-slate-500">
          Doctor assignment matrix, camp-wise distribution, and escalation routing rules
        </p>
      </div>

      {/* Doctor Assignment Matrix */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Doctor Assignment Matrix</CardTitle>
              <CardDescription>Patient load and camp coverage per doctor</CardDescription>
            </div>
            <Button size="sm" variant="outline">Reassign Patients</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Specialty</TableHead>
                <TableHead>Patients</TableHead>
                <TableHead>High Risk</TableHead>
                <TableHead>Open Escalations</TableHead>
                <TableHead>Camps</TableHead>
                <TableHead>Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doctors.map((d, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="font-medium text-sm">{d.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{d.id}</div>
                  </TableCell>
                  <TableCell className="text-sm">{d.specialty}</TableCell>
                  <TableCell className="font-mono text-sm">{d.patients}</TableCell>
                  <TableCell>
                    <span
                      className={`font-mono text-sm font-semibold ${
                        d.highRisk >= 10 ? "text-slate-900" : d.highRisk >= 5 ? "text-slate-600" : "text-slate-400"
                      }`}
                    >
                      {d.highRisk}
                    </span>
                  </TableCell>
                  <TableCell>
                    {d.escalationsOpen > 0 ? (
                      <Badge variant="destructive" className="text-xs">{d.escalationsOpen}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {d.camps.map((c, j) => (
                        <Badge key={j} variant="outline" className="text-xs">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        d.availability === "Available"
                          ? "text-slate-800 border-slate-300 bg-slate-100"
                          : "text-slate-500 border-slate-300"
                      }
                    >
                      {d.availability}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Camp-wise Patient Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Camp-wise Patient Distribution</CardTitle>
          <CardDescription>Risk breakdown and voice call response rates per camp</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Camp</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>High Risk</TableHead>
                <TableHead>Moderate</TableHead>
                <TableHead>Low</TableHead>
                <TableHead>Primary Doctor</TableHead>
                <TableHead>Response Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campDistribution.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{c.camp}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{c.type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{c.total}</TableCell>
                  <TableCell className="text-slate-900 font-mono text-sm font-semibold">{c.high}</TableCell>
                  <TableCell className="text-slate-600 font-mono text-sm">{c.moderate}</TableCell>
                  <TableCell className="text-slate-400 font-mono text-sm">{c.low}</TableCell>
                  <TableCell className="text-xs text-slate-600">{c.primaryDoctor}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5">
                        <div
                          className="bg-slate-500 h-1.5 rounded-full"
                          style={{ width: c.responseRate }}
                        />
                      </div>
                      <span className="text-xs font-mono">{c.responseRate}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Escalation Routing Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escalation Routing Rules</CardTitle>
          <CardDescription>
            Multi-layer triage configuration — AI determines severity, system routes accordingly
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Response Target</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Auto-route</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escalationRules.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge
                      variant={i <= 1 ? "destructive" : i === 2 ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-semibold">{r.response}</TableCell>
                  <TableCell className="text-sm text-slate-600">{r.action}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{r.channel}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={r.auto ? "secondary" : "outline"}
                      className={r.auto ? "text-slate-800 bg-slate-100 border-slate-300" : ""}
                    >
                      {r.auto ? "Automatic" : "Manual"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
