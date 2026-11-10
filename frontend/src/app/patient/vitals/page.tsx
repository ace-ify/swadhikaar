"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  HeartPulse,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Plus,
  Clock,
  Siren,
  Sparkles,
  Droplets,
  Thermometer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clinicalEventBus } from "@/lib/event-bus";
import { speak } from "@/lib/speak";
import { toast } from "sonner";

type RiskBand = "GREEN" | "YELLOW" | "ORANGE" | "RED";

interface News2ScoreResult {
  score: number;
  band: RiskBand;
  reasons: string[];
}

interface VitalLogEntry {
  id: string;
  timestamp: string;
  bp: string;
  pulse: string;
  spo2: string;
  sugar?: string;
  temp?: string;
  news2Score: number;
  band: RiskBand;
  statusTextHi: string;
  statusTextEn: string;
}

export default function PatientVitalsPage() {
  const [lang, setLang] = useState<"hi" | "en">("hi");

  // Input states
  const [bpSys, setBpSys] = useState("128");
  const [bpDia, setBpDia] = useState("84");
  const [pulse, setPulse] = useState("76");
  const [spo2, setSpo2] = useState("98");
  const [sugar, setSugar] = useState("110");
  const [temp, setTemp] = useState("98.4");

  const [currentResult, setCurrentResult] = useState<News2ScoreResult>({
    score: 0,
    band: "GREEN",
    reasons: [],
  });

  const [history, setHistory] = useState<VitalLogEntry[]>([
    {
      id: "vit-1",
      timestamp: "Today, 8:00 AM",
      bp: "128/84",
      pulse: "76",
      spo2: "98",
      sugar: "110",
      temp: "98.4",
      news2Score: 0,
      band: "GREEN",
      statusTextHi: "सामान्य व स्थिर",
      statusTextEn: "Normal & Stable",
    },
    {
      id: "vit-2",
      timestamp: "Yesterday, 7:30 PM",
      bp: "135/88",
      pulse: "82",
      spo2: "97",
      sugar: "142",
      temp: "98.6",
      news2Score: 1,
      band: "YELLOW",
      statusTextHi: "हल्का बढ़ा हुआ BP",
      statusTextEn: "Mild BP Elevation",
    },
    {
      id: "vit-3",
      timestamp: "Nov 08, 9:15 AM",
      bp: "124/80",
      pulse: "74",
      spo2: "99",
      sugar: "105",
      temp: "98.2",
      news2Score: 0,
      band: "GREEN",
      statusTextHi: "सामान्य",
      statusTextEn: "Normal",
    },
  ]);

  // Load from local storage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sahara.patient.vitals");
      if (saved) {
        try {
          setHistory(JSON.parse(saved));
        } catch {}
      }
    }
  }, []);

  // Compute NEWS2 Score dynamically whenever input changes
  const calculateNews2 = (): News2ScoreResult => {
    let score = 0;
    const reasons: string[] = [];
    let singleParamRed = false;

    // Blood Pressure
    const sys = parseInt(bpSys, 10);
    const dia = parseInt(bpDia, 10);
    if (!isNaN(sys)) {
      if (sys >= 180 || (dia && dia >= 110)) {
        score += 3;
        singleParamRed = true;
        reasons.push(lang === "hi" ? `अत्यधिक उच्च रक्तचाप (SBP ${sys})` : `Severe Hypertension (SBP ${sys})`);
      } else if (sys <= 90) {
        score += 3;
        singleParamRed = true;
        reasons.push(lang === "hi" ? `गंभीर निम्न रक्तचाप (SBP ${sys})` : `Severe Hypotension (SBP ${sys})`);
      } else if (sys <= 100) {
        score += 2;
        reasons.push(lang === "hi" ? `निम्न BP (SBP ${sys})` : `Low BP (SBP ${sys})`);
      } else if (sys >= 160) {
        score += 2;
        reasons.push(lang === "hi" ? `उच्च BP स्टेज 2 (SBP ${sys})` : `Stage 2 High BP (SBP ${sys})`);
      } else if (sys >= 140) {
        score += 1;
        reasons.push(lang === "hi" ? `हल्का उच्च BP (SBP ${sys})` : `Mild Elevated BP (SBP ${sys})`);
      }
    }

    // Pulse
    const p = parseInt(pulse, 10);
    if (!isNaN(p)) {
      if (p >= 131 || p <= 40) {
        score += 3;
        singleParamRed = true;
        reasons.push(lang === "hi" ? `गंभीर नाड़ी गति (${p} bpm)` : `Critical Heart Rate (${p} bpm)`);
      } else if (p >= 111) {
        score += 2;
        reasons.push(lang === "hi" ? `तीव्र धड़कन / Tachycardia (${p} bpm)` : `Tachycardia (${p} bpm)`);
      } else if (p <= 50) {
        score += 1;
        reasons.push(lang === "hi" ? `धीमी धड़कन (${p} bpm)` : `Bradycardia (${p} bpm)`);
      }
    }

    // SpO2
    const s = parseInt(spo2, 10);
    if (!isNaN(s)) {
      if (s <= 85) {
        score += 3;
        singleParamRed = true;
        reasons.push(lang === "hi" ? `अत्यधिक कम ऑक्सीजन (SpO2 ${s}%)` : `Critical Hypoxia (SpO2 ${s}%)`);
      } else if (s <= 91) {
        score += 2;
        reasons.push(lang === "hi" ? `कम ऑक्सीजन स्तर (SpO2 ${s}%)` : `Low Oxygen (SpO2 ${s}%)`);
      } else if (s <= 93) {
        score += 1;
        reasons.push(lang === "hi" ? `हल्की ऑक्सीजन कमी (SpO2 ${s}%)` : `Mild Hypoxia (SpO2 ${s}%)`);
      }
    }

    // Blood Sugar
    const glu = parseInt(sugar, 10);
    if (!isNaN(glu)) {
      if (glu >= 400 || glu <= 50) {
        score += 3;
        singleParamRed = true;
        reasons.push(lang === "hi" ? `खतरनाक शुगर स्तर (${glu} mg/dL)` : `Critical Glucose (${glu} mg/dL)`);
      } else if (glu >= 250) {
        score += 2;
        reasons.push(lang === "hi" ? `उच्च शुगर (${glu} mg/dL)` : `High Glucose (${glu} mg/dL)`);
      }
    }

    const band: RiskBand =
      score >= 7 || singleParamRed ? "RED" : score >= 5 ? "ORANGE" : score >= 1 ? "YELLOW" : "GREEN";

    return { score, band, reasons };
  };

  useEffect(() => {
    setCurrentResult(calculateNews2());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpSys, bpDia, pulse, spo2, sugar, temp, lang]);

  const handleLogVitals = () => {
    const res = calculateNews2();
    const newEntry: VitalLogEntry = {
      id: `vit-${Date.now()}`,
      timestamp: new Date().toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      bp: `${bpSys}/${bpDia}`,
      pulse,
      spo2,
      sugar,
      temp,
      news2Score: res.score,
      band: res.band,
      statusTextHi: res.reasons.length > 0 ? res.reasons.join(", ") : "सामान्य व स्थिर",
      statusTextEn: res.reasons.length > 0 ? res.reasons.join(", ") : "Normal & Stable",
    };

    const updated = [newEntry, ...history];
    setHistory(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("sahara.patient.vitals", JSON.stringify(updated));
    }

    toast.success(lang === "hi" ? "वाइटल्स सफलतापूर्वक दर्ज किए गए!" : "Vitals logged successfully!");

    // If RED risk band: immediately sound alarm, notify ops & dispatch
    if (res.band === "RED") {
      speak(
        lang === "hi"
          ? "चेतावनी! आपके वाइटल्स क्रिटिकल रेंज में हैं। आपातकालीन सहायता भेजी जा रही है।"
          : "Warning! Your vitals indicate a critical emergency. Emergency response alerted.",
        lang
      );

      clinicalEventBus.publish({
        type: "EMERGENCY_SOS_TRIGGERED",
        payload: {
          incidentId: `vital-alert-${Date.now()}`,
          type: "Critical Physiological Deterioration",
          victimName: "रमेश कुमार (Ramesh Kumar)",
          coords: { lat: 28.6139, lng: 77.2090 },
          triage: "red",
          sbar: {
            situation: `Critical NEWS2 Score: ${res.score} (${res.reasons.join("; ")})`,
            background: "Male, 58Y, hypertensive elderly patient",
            assessment: `Severe vital abnormality: BP ${bpSys}/${bpDia}, SpO2 ${spo2}%, Pulse ${pulse}`,
            recommendation: "Immediate 108 EMS CAD dispatch and hospital notification",
          },
          timestamp: Date.now(),
        },
      });
    }
  };

  const getBandBadge = (band: RiskBand) => {
    switch (band) {
      case "RED":
        return <Badge className="bg-red-600 text-white font-bold">RED · CRITICAL</Badge>;
      case "ORANGE":
        return <Badge className="bg-amber-500 text-black font-bold">ORANGE · HIGH RISK</Badge>;
      case "YELLOW":
        return <Badge className="bg-yellow-400 text-black font-bold">YELLOW · MILD RISK</Badge>;
      case "GREEN":
      default:
        return <Badge className="bg-emerald-500 text-black font-bold">GREEN · NORMAL</Badge>;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <HeartPulse className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "वाइटल्स व NEWS2 ट्रायज" : "Vitals & NEWS2 Clinical Triage"}
              </h1>
              {getBandBadge(currentResult.band)}
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "राष्ट्रीय नैदानिक अर्ली वार्निंग स्कोर (NEWS2) प्रणाली द्वारा वास्तविक समय में मूल्यांकन"
                : "Continuous physiological surveillance using National Early Warning Score (NEWS2)"}
            </p>
          </div>
        </div>

        <div className="flex rounded-lg border border-border p-0.5 bg-muted/40 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setLang("hi")}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === "hi" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            हिन्दी
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === "en" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Critical Red Alert Banner (if RED) */}
      {currentResult.band === "RED" && (
        <Card className="border-red-500/60 bg-gradient-to-r from-red-950/60 via-card to-background shadow-lg animate-pulse">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/40">
                <Siren className="h-6 w-6 text-red-500 animate-bounce" />
              </div>
              <div>
                <h4 className="font-black text-sm text-red-400">
                  {lang === "hi" ? "🚨 तत्काल चिकित्सा चेतावनी (क्रिटिकल अलर्ट)" : "🚨 Immediate Medical Alert (Critical Risk)"}
                </h4>
                <p className="text-xs text-zinc-300">
                  {currentResult.reasons.join(" · ")}
                </p>
              </div>
            </div>
            <Link
              href="/patient/sos"
              className={cn(buttonVariants({ size: "sm", variant: "destructive" }), "h-9 px-4 font-bold bg-red-600 hover:bg-red-700")}
            >
              <Siren className="h-4 w-4 mr-1.5" />
              {lang === "hi" ? "108 SOS भेजें" : "Dispatch 108 SOS"}
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Quick Input Form */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Activity className="h-4 w-4 text-teal-400" />
            {lang === "hi" ? "नवीनतम वाइटल्स रीडिंग दर्ज करें" : "Enter Latest Vital Readings"}
          </CardTitle>
          <CardDescription className="text-xs">
            {lang === "hi"
              ? "डिजिटल बीपी मशीन, ऑक्सीमीटर या थर्मामीटर की रीडिंग भरें:"
              : "Input values from your home BP monitor, pulse oximeter, or thermometer:"}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Blood Pressure Systolic */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                {lang === "hi" ? "BP सिस्टोलिक (SBP)" : "BP Systolic (SBP)"}
              </label>
              <div className="relative">
                <Input
                  value={bpSys}
                  onChange={(e) => setBpSys(e.target.value)}
                  type="number"
                  className="font-mono text-sm pr-12 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">mmHg</span>
              </div>
            </div>

            {/* Blood Pressure Diastolic */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                {lang === "hi" ? "BP डायस्टोलिक (DBP)" : "BP Diastolic (DBP)"}
              </label>
              <div className="relative">
                <Input
                  value={bpDia}
                  onChange={(e) => setBpDia(e.target.value)}
                  type="number"
                  className="font-mono text-sm pr-12 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">mmHg</span>
              </div>
            </div>

            {/* Heart Rate / Pulse */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <HeartPulse className="h-3 w-3 text-red-400" />
                {lang === "hi" ? "नाड़ी गति (Pulse)" : "Pulse Rate"}
              </label>
              <div className="relative">
                <Input
                  value={pulse}
                  onChange={(e) => setPulse(e.target.value)}
                  type="number"
                  className="font-mono text-sm pr-12 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">bpm</span>
              </div>
            </div>

            {/* SpO2 Oxygen */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <Droplets className="h-3 w-3 text-teal-400" />
                {lang === "hi" ? "ऑक्सीजन (SpO2)" : "SpO2 Saturation"}
              </label>
              <div className="relative">
                <Input
                  value={spo2}
                  onChange={(e) => setSpo2(e.target.value)}
                  type="number"
                  className="font-mono text-sm pr-12 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">%</span>
              </div>
            </div>

            {/* Blood Sugar */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                {lang === "hi" ? "ब्लड शुगर (Glucose)" : "Blood Glucose"}
              </label>
              <div className="relative">
                <Input
                  value={sugar}
                  onChange={(e) => setSugar(e.target.value)}
                  type="number"
                  className="font-mono text-sm pr-14 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">mg/dL</span>
              </div>
            </div>

            {/* Temperature */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <Thermometer className="h-3 w-3 text-amber-400" />
                {lang === "hi" ? "तापमान (Temp)" : "Body Temp"}
              </label>
              <div className="relative">
                <Input
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  type="number"
                  step="0.1"
                  className="font-mono text-sm pr-10 font-bold"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] text-muted-foreground">°F</span>
              </div>
            </div>
          </div>

          {/* Live NEWS2 Analysis Box */}
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-center justify-between text-xs">
            <div className="space-y-0.5">
              <span className="text-muted-foreground">
                {lang === "hi" ? "गणना किया गया स्कोर:" : "Calculated NEWS2:"}{" "}
                <strong className="text-foreground font-mono font-bold text-sm">{currentResult.score}</strong>
              </span>
              <p className="text-[11px] text-muted-foreground">
                {currentResult.reasons.length > 0
                  ? currentResult.reasons.join(" · ")
                  : (lang === "hi" ? "कोई जोखिम नहीं, सामान्य सीमा में।" : "All vital signs within safe target ranges.")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleLogVitals}
              className="h-9 px-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {lang === "hi" ? "वाइटल्स सहेजें" : "Log Vitals"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Historical Logs Table */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="py-3 px-4 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-teal-400" />
            {lang === "hi" ? "हालिया वाइटल्स इतिहास" : "Recent Vitals History"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {history.map((item) => (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-foreground">
                      BP: {item.bp} mmHg
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono font-bold text-foreground">
                      Pulse: {item.pulse} bpm
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono font-bold text-teal-400">
                      SpO2: {item.spo2}%
                    </span>
                  </div>
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    <span>{item.timestamp}</span>
                    <span>·</span>
                    <span>{lang === "hi" ? item.statusTextHi : item.statusTextEn}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    NEWS2: {item.news2Score}
                  </Badge>
                  {getBandBadge(item.band)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

