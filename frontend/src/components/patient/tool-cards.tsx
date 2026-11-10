"use client";

import React from "react";
import Link from "next/link";
import {
  Hospital,
  Pill,
  TrendingDown,
  ShieldCheck,
  Activity,
  AlertTriangle,
  PhoneCall,
  Clock,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Siren,
  Sparkles,
  MapPin,
  HeartPulse,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HospitalCardData {
  name: string;
  distance: string;
  bedsAvailable: number;
  phone: string;
  pmjayEmpanelled: boolean;
  address: string;
}

export function HospitalCard({
  hospital = {
    name: "Civil Hospital & Trauma Centre",
    distance: "2.4 km away",
    bedsAvailable: 14,
    phone: "108",
    pmjayEmpanelled: true,
    address: "Station Road, Sector 4",
  },
}: {
  hospital?: HospitalCardData;
}) {
  return (
    <Card className="border-teal-500/30 bg-gradient-to-br from-teal-950/40 via-card to-background shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-teal-500/20 text-teal-400 border border-teal-500/30">
              <Hospital className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground">{hospital.name}</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3 text-teal-400" />
                {hospital.distance} · {hospital.address}
              </p>
            </div>
          </div>
          {hospital.pmjayEmpanelled && (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
              PM-JAY Free
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
          <span className="text-muted-foreground">
            Emergency Beds: <strong className="text-emerald-400 font-mono">{hospital.bedsAvailable} available</strong>
          </span>
          <div className="flex gap-2">
            <Link
              href={`tel:${hospital.phone}`}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-xs border-teal-500/30")}
            >
              <PhoneCall className="h-3 w-3 mr-1 text-teal-400" /> Call
            </Link>
            <Link
              href="/patient/pmjay"
              className={cn(buttonVariants({ size: "sm" }), "h-7 text-xs bg-teal-600 hover:bg-teal-700 text-white")}
            >
              View Coverage <ChevronRight className="h-3 w-3 ml-1" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export interface MedicationCardData {
  name: string;
  dosage: string;
  timing: string;
  purpose: string;
  taken: boolean;
}

export function MedicationCard({
  medication,
  onMarkTaken,
}: {
  medication: MedicationCardData;
  onMarkTaken?: (name: string) => void;
}) {
  return (
    <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-950/30 via-card to-background shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Pill className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground">{medication.name}</h4>
              <p className="text-xs text-muted-foreground">{medication.dosage} · {medication.purpose}</p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={
              medication.taken
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]"
            }
          >
            {medication.taken ? "Taken ✓" : "Pending"}
          </Badge>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3 text-cyan-400" />
            {medication.timing}
          </span>
          <Button
            size="sm"
            variant={medication.taken ? "secondary" : "default"}
            disabled={medication.taken}
            onClick={() => onMarkTaken && onMarkTaken(medication.name)}
            className="h-7 text-xs bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {medication.taken ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-400" /> Taken Today
              </>
            ) : (
              "✓ Mark as Taken"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export interface SavingsCardData {
  brandedName: string;
  brandedPrice: number;
  genericName: string;
  genericPrice: number;
  savingsPct: number;
}

export function SavingsCard({
  data = {
    brandedName: "Telma 40 (Telmisartan)",
    brandedPrice: 285,
    genericName: "PM Jan Aushadhi Telmisartan 40mg",
    genericPrice: 32,
    savingsPct: 88,
  },
}: {
  data?: SavingsCardData;
}) {
  return (
    <Card className="border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-card to-background shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-sm text-foreground">Jan Aushadhi Generic Savings</h4>
                <Badge className="bg-emerald-500 text-black text-[10px] font-bold">
                  Save {data.savingsPct}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Same Active Salt · Tested High Quality</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50">
          <div>
            <span className="text-muted-foreground block">Branded MRP:</span>
            <span className="line-through text-muted-foreground font-mono">₹{data.brandedPrice}</span>
          </div>
          <div className="border-l border-border/50 pl-3">
            <span className="text-emerald-400 block font-medium">Jan Aushadhi Price:</span>
            <span className="text-emerald-400 font-bold font-mono text-sm">₹{data.genericPrice}</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs">
          <span className="text-muted-foreground">
            You save <strong className="text-emerald-400">₹{data.brandedPrice - data.genericPrice} per strip</strong>
          </span>
          <Link
            href="/patient/scan"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10")}
          >
            Scan Prescription <ChevronRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export interface SchemeCardData {
  schemeName: string;
  coverage: string;
  status: string;
  actionUrl: string;
}

export function SchemeCard({
  scheme = {
    schemeName: "Ayushman Bharat PM-JAY",
    coverage: "₹5,00,000 / year Cashless Treatment",
    status: "Active · Card Linked",
    actionUrl: "/patient/pmjay",
  },
}: {
  scheme?: SchemeCardData;
}) {
  return (
    <Card className="border-indigo-500/30 bg-gradient-to-br from-indigo-950/30 via-card to-background shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground">{scheme.schemeName}</h4>
              <p className="text-xs text-muted-foreground">{scheme.coverage}</p>
            </div>
          </div>
          <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 text-[10px]">
            {scheme.status}
          </Badge>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
          <span className="text-muted-foreground">Valid at 28,000+ empanelled hospitals</span>
          <Link
            href={scheme.actionUrl}
            className={cn(buttonVariants({ size: "sm" }), "h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white")}
          >
            Search Hospitals <ChevronRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export interface VitalsCardData {
  bp?: string;
  pulse?: string;
  spo2?: string;
  news2Score: number;
  riskBand: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  advice: string;
}

export function VitalsCard({
  vitals = {
    bp: "128/84 mmHg",
    pulse: "76 bpm",
    spo2: "98%",
    news2Score: 0,
    riskBand: "GREEN",
    advice: "Vitals are stable and in normal target range.",
  },
}: {
  vitals?: VitalsCardData;
}) {
  const bandColor =
    vitals.riskBand === "RED"
      ? "text-red-400 bg-red-500/10 border-red-500/30"
      : vitals.riskBand === "ORANGE"
      ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
      : vitals.riskBand === "YELLOW"
      ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
      : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";

  return (
    <Card className="border-border bg-card shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-sm text-foreground">Recorded Vitals & Triage</h4>
              <p className="text-xs text-muted-foreground">NEWS2 Score: {vitals.news2Score}</p>
            </div>
          </div>
          <Badge variant="outline" className={`text-[10px] font-bold ${bandColor}`}>
            {vitals.riskBand} ALERT
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs bg-muted/40 p-2 rounded-lg">
          <div>
            <span className="text-muted-foreground block text-[10px]">Blood Pressure</span>
            <span className="font-mono font-bold text-foreground">{vitals.bp || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Pulse Rate</span>
            <span className="font-mono font-bold text-foreground">{vitals.pulse || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">SpO2 Level</span>
            <span className="font-mono font-bold text-foreground">{vitals.spo2 || "—"}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{vitals.advice}</p>

        <div className="flex justify-end pt-1">
          <Link
            href="/patient/vitals"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-xs")}
          >
            Log Fresh Vitals <ChevronRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmergencyCard({
  details = {
    title: "Acute Emergency Lifeline Activated",
    sbar: "S: Chest Pain / Dyspnea. B: Known Hypertension. A: SBP 175. R: Immediate 108 CAD ambulance dispatch.",
  },
}: {
  details?: { title: string; sbar: string };
}) {
  return (
    <Card className="border-red-500/50 bg-gradient-to-br from-red-950/50 via-card to-background shadow-lg animate-pulse">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">
              <Siren className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-red-400">{details.title}</h4>
              <p className="text-xs text-muted-foreground">108 CAD Dispatch Signal Active</p>
            </div>
          </div>
          <Badge className="bg-red-600 text-white font-mono text-[10px]">CRITICAL</Badge>
        </div>

        <div className="p-2.5 rounded bg-red-950/30 border border-red-500/30 text-xs font-mono text-red-200">
          {details.sbar}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Link
            href="/patient/sos"
            className={cn(buttonVariants({ size: "sm", variant: "destructive" }), "h-8 text-xs font-bold w-full")}
          >
            <Siren className="h-3.5 w-3.5 mr-1" /> Open Emergency HUD & CPR Guide
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function CaregiverEscalationCard({
  caregiverName = "Ramesh Kumar (Son)",
  phone = "+91 98765 43210",
  message = "Alerted via WhatsApp with real-time GPS location and SBAR handoff note.",
}: {
  caregiverName?: string;
  phone?: string;
  message?: string;
}) {
  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-950/20 via-card to-background shadow-md">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <PhoneCall className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Caregiver Notified</h4>
            <p className="text-xs text-muted-foreground">{caregiverName} ({phone})</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground pl-1">{message}</p>
        <div className="flex justify-end pt-1">
          <Link
            href="/patient/caregiver"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-xs border-amber-500/30 text-amber-400")}
          >
            Caregiver Settings <ChevronRight className="h-3 w-3 ml-1" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function ReminderCard({
  title = "Evening Dose Reminder",
  time = "8:30 PM",
  detail = "Amlodipine 5mg with a full glass of water after dinner.",
}: {
  title?: string;
  time?: string;
  detail?: string;
}) {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardContent className="p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h5 className="font-semibold text-xs text-foreground">{title} · <span className="text-primary font-mono">{time}</span></h5>
            <p className="text-[11px] text-muted-foreground">{detail}</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" className="h-7 text-xs">
          Acknowledge
        </Button>
      </CardContent>
    </Card>
  );
}

