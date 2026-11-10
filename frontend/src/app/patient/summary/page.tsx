"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  FileText,
  Printer,
  Download,
  Share2,
  CheckCircle2,
  Activity,
  Pill,
  Clock,
  PhoneCall,
  ClipboardList,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function PatientDoctorSummaryPage() {
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [copiedLink, setCopiedLink] = useState(false);

  const patient = {
    name: "रमेश कुमार (Ramesh Kumar)",
    age: 58,
    gender: "Male",
    abhaId: "91-4820-1945-8821",
    date: new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  };

  const currentMeds = [
    { name: "Telma 40 (Telmisartan)", dose: "40mg", timing: "Morning · After Food", purpose: "Hypertension", taken: true },
    { name: "Glycomet 500 (Metformin)", dose: "500mg", timing: "Morning · After Food", purpose: "Diabetes T2", taken: true },
    { name: "Amlodipine 5mg", dose: "5mg", timing: "Night · After Dinner", purpose: "Cardiovascular", taken: false },
  ];

  const recentVitals = [
    { type: "Blood Pressure", value: "128/84 mmHg", time: "Today, 8:00 AM", status: "Normal", band: "GREEN" },
    { type: "Pulse Rate", value: "76 bpm", time: "Today, 8:00 AM", status: "Normal", band: "GREEN" },
    { type: "SpO2 Saturation", value: "98%", time: "Today, 8:00 AM", status: "Normal", band: "GREEN" },
    { type: "Blood Sugar (Fasting)", value: "110 mg/dL", time: "Today, 7:30 AM", status: "Optimal", band: "GREEN" },
  ];

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: "Sahara Doctor Summary — Ramesh Kumar",
        text: `Doctor Summary for Ramesh Kumar (${patient.abhaId}). Vitals & Medications export.`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(window.location.href);
      setCopiedLink(true);
      toast.success(lang === "hi" ? "सारांश लिंक कॉपी हो गया!" : "Summary link copied to clipboard!");
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "डॉक्टर विज़िट सारांश" : "Doctor Visit Clinical Summary"}
              </h1>
              <Badge variant="outline" className="bg-teal-500/10 text-teal-400 border-teal-500/30 text-[10px]">
                FHIR R4 / SBAR Format
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "क्लीनिक या अस्पताल विज़िट के दौरान डॉक्टर को दिखाने हेतु 1-क्लिक संरचित रिपोर्ट"
                : "One-click structured clinical briefing note for hospital outpatient visits"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button size="sm" onClick={handlePrint} className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white">
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            {lang === "hi" ? "प्रिंट / PDF" : "Print PDF"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleShare} className="h-8 text-xs">
            <Share2 className="h-3.5 w-3.5 mr-1" />
            {copiedLink ? "Copied ✓" : lang === "hi" ? "शेयर" : "Share"}
          </Button>

          <div className="flex rounded-lg border border-border p-0.5 bg-muted/40">
            <button
              type="button"
              onClick={() => setLang("hi")}
              className={`px-2 py-1 text-xs rounded-md font-medium transition-all ${
                lang === "hi" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              हिन्दी
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2 py-1 text-xs rounded-md font-medium transition-all ${
                lang === "en" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      {/* Tabs: Clinical Summary vs Follow-up Calls vs Past Records */}
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="bg-muted/60 p-1 border border-border print:hidden">
          <TabsTrigger value="summary" className="text-xs font-semibold">
            <FileText className="h-3.5 w-3.5 mr-1.5 text-teal-400" />
            {lang === "hi" ? "क्लीनिकल सारांश" : "Clinical Summary"}
          </TabsTrigger>
          <TabsTrigger value="calls" className="text-xs font-semibold">
            <PhoneCall className="h-3.5 w-3.5 mr-1.5 text-cyan-400" />
            {lang === "hi" ? "अस्पताल फॉलो-अप कॉल्स" : "Follow-up Calls"}
          </TabsTrigger>
          <TabsTrigger value="records" className="text-xs font-semibold">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
            {lang === "hi" ? "अतीत रिकॉर्ड्स" : "Past Records"}
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: STRUCTURED CLINICAL SBAR SUMMARY */}
        <TabsContent value="summary" className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 space-y-6 shadow-md print:border-none print:shadow-none print:p-0">
            {/* Report Header */}
            <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] text-teal-400 uppercase tracking-widest font-black block">
                  SAHĀRĀ HEALTH · CLINICAL HANDOFF
                </span>
                <h2 className="text-xl font-bold text-foreground mt-0.5">
                  {lang === "hi" ? "डॉक्टर परामर्श व स्वास्थ्य सारांश" : "Outpatient Consultation Brief"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {patient.name} · {patient.age} Yrs / {patient.gender} · ABHA ID:{" "}
                  <strong className="font-mono text-foreground">{patient.abhaId}</strong>
                </p>
              </div>

              <div className="text-right">
                <span className="text-xs text-muted-foreground block font-mono">{patient.date}</span>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                  NEWS2: 0 · STABLE
                </Badge>
              </div>
            </div>

            {/* Adherence Banner */}
            <div className="p-3.5 rounded-xl bg-teal-950/20 border border-teal-500/20 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {lang === "hi"
                  ? "दवा अनुपालन: 3 में से 2 खुराकें ली गईं (67% अनुपालन दर)"
                  : "Medication Adherence: 2 of 3 doses taken today (67% adherence rate)"}
              </span>
              <span className="text-teal-400 font-bold font-mono">ADHERENCE: GOOD</span>
            </div>

            {/* Section 1: Recent Vitals Table */}
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-foreground uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 border-b border-border/50 pb-1.5">
                <Activity className="h-4 w-4 text-teal-400" />
                {lang === "hi" ? "रक्तचाप व वाइटल्स इतिहास" : "Recent Physiological Vitals"}
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border font-semibold">
                    <tr>
                      <th className="p-2.5">{lang === "hi" ? "पैरामीटर" : "Parameter"}</th>
                      <th className="p-2.5">{lang === "hi" ? "मापा गया मान" : "Recorded Value"}</th>
                      <th className="p-2.5">{lang === "hi" ? "समय" : "Timestamp"}</th>
                      <th className="p-2.5">{lang === "hi" ? "स्थिति" : "Clinical Status"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {recentVitals.map((v, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="p-2.5 font-medium text-foreground">{v.type}</td>
                        <td className="p-2.5 font-mono font-bold text-foreground">{v.value}</td>
                        <td className="p-2.5 text-muted-foreground">{v.time}</td>
                        <td className="p-2.5">
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                            {v.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 2: Current Prescribed Medications */}
            <div className="space-y-3">
              <h3 className="font-bold text-sm text-foreground uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 border-b border-border/50 pb-1.5">
                <Pill className="h-4 w-4 text-teal-400" />
                {lang === "hi" ? "वर्तमान सक्रिय दवाइयाँ" : "Active Medications"}
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border font-semibold">
                    <tr>
                      <th className="p-2.5">{lang === "hi" ? "दवा का नाम" : "Medicine"}</th>
                      <th className="p-2.5">{lang === "hi" ? "खुराक" : "Dose"}</th>
                      <th className="p-2.5">{lang === "hi" ? "समय व निर्देश" : "Timing"}</th>
                      <th className="p-2.5">{lang === "hi" ? "रोग / प्रयोजन" : "Indication"}</th>
                      <th className="p-2.5 text-center">{lang === "hi" ? "आज ली गई" : "Taken Today"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {currentMeds.map((m, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="p-2.5 font-bold text-foreground">{m.name}</td>
                        <td className="p-2.5 font-mono">{m.dose}</td>
                        <td className="p-2.5 text-muted-foreground">{m.timing}</td>
                        <td className="p-2.5 text-muted-foreground">{m.purpose}</td>
                        <td className="p-2.5 text-center font-bold">
                          {m.taken ? (
                            <span className="text-emerald-400 font-mono">✓ Yes</span>
                          ) : (
                            <span className="text-amber-400 font-mono">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Disclaimer Footer */}
            <div className="pt-4 border-t border-border/60 text-[10px] text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-2">
              <span>
                {lang === "hi"
                  ? "सहारा AI द्वारा स्वचालित सारांश · यह चिकित्सा सलाह नहीं है। केवल चिकित्सक समीक्षा हेतु मान्य।"
                  : "Generated by Sahara AI Health Companion · Automated brief for clinical reference only."}
              </span>
              <span className="font-mono text-teal-400">ABDM-COMPLIANT</span>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: HOSPITAL FOLLOW-UP CALLS */}
        <TabsContent value="calls" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-cyan-400" />
                {lang === "hi" ? "अस्पताल स्वचालित डिस्चार्ज कॉल्स" : "Post-Discharge Follow-Up Voice Calls"}
              </CardTitle>
              <CardDescription className="text-xs">
                {lang === "hi"
                  ? "अस्पताल से डिस्चार्ज के बाद सहारा AI द्वारा किए गए स्वचालित फॉलो-अप फोन कॉल्स के ट्रांसक्रिप्ट्स:"
                  : "Recorded transcripts and clinical responses from automated post-discharge voice calls:"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground">Call #1: 7-Day Chronic BP Check</span>
                  <Badge variant="outline" className="text-[10px] text-teal-400 border-teal-500/30">
                    Completed · 2m 14s
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  Sahara AI called patient. Patient confirmed taking Telma 40 regularly without dizziness. Recorded SBP 128 mmHg.
                </p>
                <div className="text-[11px] text-muted-foreground font-mono">Nov 07, 2026 · 11:30 AM</div>
              </div>

              <div className="flex justify-end">
                <Link
                  href="/patient/calls"
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "text-xs")}
                >
                  View Full Call Log <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: PAST HEALTH RECORDS */}
        <TabsContent value="records" className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-indigo-400" />
                {lang === "hi" ? "अतीत स्वास्थ्य रिकॉर्ड्स व टेस्ट रिपोर्ट्स" : "Historical Medical Records & Lab Reports"}
              </CardTitle>
              <CardDescription className="text-xs">
                {lang === "hi"
                  ? "आयुष्मान भारत डिजिटल मिशन (ABDM) से लिंक किए गए लैब टेस्ट व डिस्चार्ज सारांश:"
                  : "ABDM-linked health records, past discharge summaries, and blood test reports:"}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="p-3.5 rounded-xl border border-border bg-muted/20 flex items-center justify-between text-xs">
                <div>
                  <h4 className="font-bold text-foreground">Discharge Summary — Civil Hospital</h4>
                  <p className="text-muted-foreground">Hypertension & Mild Angina Evaluation</p>
                  <span className="text-[10px] text-muted-foreground font-mono">Oct 28, 2026</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  View PDF
                </Button>
              </div>

              <div className="flex justify-end">
                <Link
                  href="/patient/records"
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "text-xs")}
                >
                  Open Records Repository <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

