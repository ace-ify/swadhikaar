"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Pill,
  Clock,
  CheckCircle2,
  Camera,
  Plus,
  AlertCircle,
  TrendingDown,
  Sparkles,
  ChevronRight,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { speak } from "@/lib/speak";
import { toast } from "sonner";

interface MedicationItem {
  id: string;
  name: string;
  dosage: string;
  timing: "Morning" | "Afternoon" | "Night";
  timingDetailHi: string;
  timingDetailEn: string;
  purposeHi: string;
  purposeEn: string;
  taken: boolean;
  genericSalt: string;
  genericPrice: number;
  brandedPrice: number;
}

export default function PatientMedicationsPage() {
  const [lang, setLang] = useState<"hi" | "en">("hi");

  const [meds, setMeds] = useState<MedicationItem[]>([
    {
      id: "med-1",
      name: "Telma 40 (Telmisartan)",
      dosage: "40 mg · 1 Tablet",
      timing: "Morning",
      timingDetailHi: "सुबह · नाश्ते के बाद (8:30 AM)",
      timingDetailEn: "Morning · After Breakfast (8:30 AM)",
      purposeHi: "ब्लड प्रेशर (BP) नियंत्रण",
      purposeEn: "Blood Pressure Regulation",
      taken: true,
      genericSalt: "Telmisartan 40mg",
      genericPrice: 32,
      brandedPrice: 285,
    },
    {
      id: "med-2",
      name: "Glycomet 500 (Metformin)",
      dosage: "500 mg · 1 Tablet",
      timing: "Morning",
      timingDetailHi: "सुबह · नाश्ते के बाद (8:30 AM)",
      timingDetailEn: "Morning · After Breakfast (8:30 AM)",
      purposeHi: "ब्लड शुगर / डायबिटीज",
      purposeEn: "Type 2 Diabetes Control",
      taken: true,
      genericSalt: "Metformin Hydrochloride 500mg",
      genericPrice: 22,
      brandedPrice: 165,
    },
    {
      id: "med-3",
      name: "Amlodipine 5mg",
      dosage: "5 mg · 1 Tablet",
      timing: "Night",
      timingDetailHi: "रात · खाने के बाद (9:00 PM)",
      timingDetailEn: "Night · After Dinner (9:00 PM)",
      purposeHi: "हृदय व बीपी सुरक्षा",
      purposeEn: "Cardiovascular Protection",
      taken: false,
      genericSalt: "Amlodipine Besylate 5mg",
      genericPrice: 18,
      brandedPrice: 140,
    },
  ]);

  // Load from LocalStorage if available
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sahara.patient.meds");
      if (saved) {
        try {
          setMeds(JSON.parse(saved));
        } catch {}
      }
    }
  }, []);

  const saveMeds = (updated: MedicationItem[]) => {
    setMeds(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("sahara.patient.meds", JSON.stringify(updated));
    }
  };

  const handleToggleTaken = (id: string) => {
    const target = meds.find((m) => m.id === id);
    if (!target) return;

    const nextState = !target.taken;
    const updated = meds.map((m) => (m.id === id ? { ...m, taken: nextState } : m));
    saveMeds(updated);

    if (nextState) {
      toast.success(
        lang === "hi"
          ? `${target.name} ली गई दर्ज की गई!`
          : `Marked ${target.name} as taken!`
      );
      speak(
        lang === "hi"
          ? `शाबाश! आपने ${target.name} ले ली है।`
          : `Great job! You have taken ${target.name}.`,
        lang
      );
    }
  };

  const takenCount = meds.filter((m) => m.taken).length;
  const progressPct = meds.length > 0 ? Math.round((takenCount / meds.length) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Pill className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "दैनिक दवाइयाँ व अनुपालन" : "Daily Medications & Adherence"}
              </h1>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                {takenCount}/{meds.length} Taken
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "समय पर खुराक लें और जन औषधि केंद्र से 70-90% तक की बचत करें"
                : "Never miss a dose and discover affordable generic equivalents"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/patient/scan"
            className={cn(buttonVariants({ size: "sm" }), "h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white")}
          >
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            {lang === "hi" ? "नया पर्चा स्कैन करें" : "Scan Prescription"}
          </Link>
          <div className="flex rounded-lg border border-border p-0.5 bg-muted/40">
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
      </div>

      {/* Adherence Score Card */}
      <Card className="border-teal-500/30 bg-gradient-to-br from-teal-950/30 via-card to-background shadow-md">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base text-foreground">
                {lang === "hi" ? "आज का दवा अनुपालन" : "Today's Adherence Rate"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {lang === "hi"
                  ? `${meds.length} में से ${takenCount} खुराकें ली गईं`
                  : `${takenCount} of ${meds.length} scheduled doses completed`}
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black font-mono text-teal-400">{progressPct}%</span>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                {progressPct === 100 ? (lang === "hi" ? "पूर्ण सुरक्षित" : "Fully Protected") : (lang === "hi" ? "प्रगति पर" : "In Progress")}
              </p>
            </div>
          </div>

          <Progress value={progressPct} className="h-3 bg-muted" />
        </CardContent>
      </Card>

      {/* Scanner & Savings Callout Banner */}
      <Link href="/patient/scan">
        <Card className="border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-card to-teal-950/30 shadow-md hover:border-emerald-400 transition-all cursor-pointer group">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 group-hover:scale-105 transition-transform">
                <Camera className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-foreground">
                    {lang === "hi" ? "📸 पर्चा व केमिस्ट बिल स्कैनर" : "📸 Scan Prescription & Chemist Bill"}
                  </h4>
                  <Badge className="bg-emerald-500 text-black font-bold text-[10px]">
                    SAVE 70-90%
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lang === "hi"
                    ? "डॉक्टर का पर्चा अपलोड करें · जन औषधि जेनेरिक विकल्प व बचत जानें"
                    : "Upload prescription · Discover Pradhan Mantri Jan Aushadhi generic savings"}
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-emerald-400 group-hover:translate-x-1 transition-transform" />
          </CardContent>
        </Card>
      </Link>

      {/* Scheduled Medicines List */}
      <div className="space-y-4">
        <h3 className="font-bold text-sm text-foreground uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-teal-400" />
          {lang === "hi" ? "आज की निर्धारित खुराक" : "Today's Medication Routine"}
        </h3>

        <div className="grid gap-3">
          {meds.map((med) => (
            <Card
              key={med.id}
              className={`transition-all shadow-sm ${
                med.taken
                  ? "border-emerald-500/30 bg-card/60 opacity-90"
                  : "border-border hover:border-teal-500/40 bg-card"
              }`}
            >
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      med.taken
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-teal-500/10 text-teal-400 border-teal-500/20"
                    }`}
                  >
                    <Pill className="h-5 w-5" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-base text-foreground">{med.name}</h4>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {med.dosage}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-teal-400" />
                      {lang === "hi" ? med.timingDetailHi : med.timingDetailEn}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lang === "hi" ? `उद्देश्य: ${med.purposeHi}` : `Purpose: ${med.purposeEn}`}
                    </p>

                    {/* Jan Aushadhi generic tag */}
                    <div className="pt-1 flex items-center gap-2 text-xs">
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" />
                        {lang === "hi" ? "जन औषधि विकल्प उपलब्ध:" : "Jan Aushadhi Generic:"}{" "}
                        <strong className="font-mono">₹{med.genericPrice}</strong> (Branded: ₹{med.brandedPrice})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Button
                    size="sm"
                    variant={med.taken ? "outline" : "default"}
                    onClick={() => handleToggleTaken(med.id)}
                    className={
                      med.taken
                        ? "h-9 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                        : "h-9 bg-teal-600 hover:bg-teal-700 text-white font-semibold"
                    }
                  >
                    {med.taken ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-400" />
                        {lang === "hi" ? "ली गई ✓" : "Taken ✓"}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        {lang === "hi" ? "खुराक लें" : "Mark as Taken"}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

