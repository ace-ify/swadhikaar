"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Heart,
  Pill,
  Search,
  Shield,
  Stethoscope,
  Users,
  Volume2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DualPartyMedicalBridge from "@/components/clinical/dual-party-bridge";
import { checkLasaCollision, type LasaMatch } from "@/lib/clinical/lasa-guard";
import { clinicalEventBus } from "@/lib/event-bus";
import { toast } from "sonner";

/**
 * Door 3: /ops — Hospital & Clinical Operations (Desktop Dashboard)
 * Core home for provider copilot, clinical triage review, T6 dual-party bridge, and T8 LASA safety guard.
 */
export default function Door3Ops() {
  const [lasaInput, setLasaInput] = useState("");
  const [lasaAlert, setLasaAlert] = useState<LasaMatch | null>(null);
  const [liveEncounters, setLiveEncounters] = useState<any[]>([
    {
      id: "enc-101",
      name: "Rameshwar Prasad (58M)",
      time: "10 mins ago",
      complaint: "Chest heaviness radiating to left shoulder",
      triage: "red",
      vitals: "BP 164/98 • HR 94",
    },
    {
      id: "enc-102",
      name: "Sunita Devi (44F)",
      time: "24 mins ago",
      complaint: "Persistent dry cough, low-grade fever",
      triage: "yellow",
      vitals: "SpO2 97% • Temp 100.2°F",
    },
  ]);

  // Listen to cross-door events from Door 1 (/patient)
  useEffect(() => {
    const unsub = clinicalEventBus.subscribe((event) => {
      if (event.type === "PATIENT_INTAKE_COMPLETED") {
        setLiveEncounters((prev) => [
          {
            id: event.payload.patientId,
            name: `${event.payload.name} (${event.payload.age || "Adult"})`,
            time: "Just now",
            complaint: event.payload.chiefComplaint,
            triage: event.payload.triageColor,
            vitals: "Walk-in triage recorded via Kiosk",
          },
          ...prev,
        ]);
        toast.info(`📋 New Encounter from Door 1: ${event.payload.name}`);
      }
    });
    return unsub;
  }, []);

  const handleLasaCheck = (val: string) => {
    setLasaInput(val);
    const match = checkLasaCollision(val);
    setLasaAlert(match);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 font-sans">
      {/* Door Header */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-slate-500">
              Door 3: Clinical & Hospital Operations Console
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            Clinical Cockpit & AI Copilot
            <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300">
              One Brain • 8 Topologies
            </Badge>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/doctor/kiosk-queue">
            <Button variant="outline" size="sm" className="text-xs">
              <Clock className="size-3.5 mr-1 text-slate-500" />
              Kiosk Queue
            </Button>
          </Link>
          <Link href="/dispatch">
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md">
              <Shield className="size-3.5 mr-1" />
              Switch to Door 4 (Dispatch)
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (8 cols): Clinical Queue & Dual-Party Bridge */}
        <div className="lg:col-span-8 space-y-6">
          {/* T6: Bedside Dual-Party Bridge */}
          <DualPartyMedicalBridge />

          {/* Clinical Review Queue */}
          <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Activity className="size-4 text-emerald-600" />
                    Live Encounter Triage & Review Queue
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Realtime intake cards arriving from Door 1 (/patient) & Door 2 (/asha)
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="font-mono text-xs">
                  {liveEncounters.length} Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {liveEncounters.map((enc) => (
                <div
                  key={enc.id}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {enc.name}
                      </span>
                      <Badge
                        className={`text-[10px] uppercase font-bold px-1.5 py-0 ${
                          enc.triage === "red"
                            ? "bg-rose-500 text-white"
                            : enc.triage === "orange"
                            ? "bg-amber-500 text-white"
                            : "bg-emerald-500 text-white"
                        }`}
                      >
                        {enc.triage}
                      </Badge>
                      <span className="text-[11px] text-slate-400 font-mono">{enc.time}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{enc.complaint}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{enc.vitals}</p>
                  </div>
                  <Link href="/doctor/review">
                    <Button size="sm" variant="ghost" className="text-xs text-sky-600 hover:text-sky-700">
                      Open Chart
                      <ArrowRight className="size-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column (4 cols): T8 LASA Guard & System Health */}
        <div className="lg:col-span-4 space-y-6">
          {/* T8: LASA Drug Safety Guard Card */}
          <Card className="border-amber-200/80 bg-amber-50/30 dark:border-amber-900/50 dark:bg-amber-950/10 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Pill className="size-4 text-amber-600" />
                T8: LASA Drug Sound-Alike Guard
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Phonetic distance engine catches high-risk prescription collisions during voice dictation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Test Spoken / Dictated Drug:
                </label>
                <Input
                  value={lasaInput}
                  onChange={(e) => handleLasaCheck(e.target.value)}
                  placeholder="e.g. Metformin, Cetirizine, Dopamine"
                  className="bg-white dark:bg-slate-900 text-xs"
                />
              </div>

              {/* Collison Alert Banner */}
              {lasaAlert ? (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200 text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="size-4 text-rose-600 animate-bounce" />
                    <span>PHONETIC COLLISION ({lasaAlert.similarity}% MATCH)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{lasaAlert.warning}</p>
                </div>
              ) : lasaInput.length >= 3 ? (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  No high-risk LASA sound-alike collisions detected.
                </div>
              ) : null}

              <div className="text-[11px] text-slate-400 font-mono pt-1">
                Monitored pairs: Metformin/Metronidazole • Dopamine/Dobutamine • Amlodipine/Amitriptyline
              </div>
            </CardContent>
          </Card>

          {/* System Topology Status */}
          <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Shield className="size-4 text-sky-600" />
                Four Doors Topology Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                <span className="font-medium text-slate-700 dark:text-slate-300">Door 1: /patient</span>
                <Badge className="bg-emerald-500 text-white text-[10px]">ACTIVE PWA</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                <span className="font-medium text-slate-700 dark:text-slate-300">Door 2: /asha</span>
                <Badge className="bg-emerald-500 text-white text-[10px]">OFFLINE OUTBOX</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                <span className="font-medium text-slate-700 dark:text-slate-300">Door 3: /ops</span>
                <Badge className="bg-emerald-500 text-white text-[10px]">COGNITIVE CORE</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                <span className="font-medium text-slate-700 dark:text-slate-300">Door 4: /dispatch</span>
                <Badge className="bg-emerald-500 text-white text-[10px]">108 CAD SYNC</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

