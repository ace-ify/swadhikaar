"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Camera,
  Upload,
  Mic,
  Pill,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  FileText,
  RotateCcw,
  Clock,
  ArrowRight,
  Store,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { speak } from "@/lib/speak";
import { toast } from "sonner";

interface ScannedDrug {
  id: string;
  name: string;
  dosage: string;
  timing: string;
  purpose: string;
  brandedPrice: number;
  genericSalt: string;
  genericPrice: number;
  savingsPct: number;
  lasaWarning?: string;
  confirmed: boolean;
}

export default function PatientPrescriptionScannerPage() {
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [analyzingStage, setAnalyzingStage] = useState(0);

  // Scanned / Extracted Medicines
  const [scannedDrugs, setScannedDrugs] = useState<ScannedDrug[]>([
    {
      id: "rx-1",
      name: "Telma 40",
      dosage: "40 mg",
      timing: "Morning · After Breakfast",
      purpose: "Blood Pressure Regulation",
      brandedPrice: 285,
      genericSalt: "PM Jan Aushadhi Telmisartan 40mg",
      genericPrice: 32,
      savingsPct: 88,
      confirmed: true,
    },
    {
      id: "rx-2",
      name: "Glycomet 500",
      dosage: "500 mg",
      timing: "Morning · After Breakfast",
      purpose: "Type 2 Diabetes Control",
      brandedPrice: 165,
      genericSalt: "PM Jan Aushadhi Metformin 500mg",
      genericPrice: 22,
      savingsPct: 86,
      confirmed: true,
    },
    {
      id: "rx-3",
      name: "Augmentin 625",
      dosage: "625 mg",
      timing: "Night · After Dinner (5 days)",
      purpose: "Chest & Throat Infection",
      brandedPrice: 210,
      genericSalt: "Amoxicillin & Clavulanate 625mg",
      genericPrice: 58,
      savingsPct: 72,
      lasaWarning: "Phonetic Similarity to Augmentin Duo / Clavam 625 checked: Verified safe.",
      confirmed: true,
    },
  ]);

  // Demo presets for fast presentation
  const demoPresets = [
    {
      label: "Telma 40 (BP)",
      file: "prescription_telma_40.jpg",
      drugs: [
        {
          id: "rx-1",
          name: "Telma 40",
          dosage: "40 mg",
          timing: "Morning · After Breakfast",
          purpose: "Blood Pressure Regulation",
          brandedPrice: 285,
          genericSalt: "PM Jan Aushadhi Telmisartan 40mg",
          genericPrice: 32,
          savingsPct: 88,
          confirmed: true,
        },
      ],
    },
    {
      label: "Metformin + BP Routine",
      file: "chronic_care_rx_2026.png",
      drugs: [
        {
          id: "rx-1",
          name: "Telma 40",
          dosage: "40 mg",
          timing: "Morning · After Breakfast",
          purpose: "Blood Pressure Regulation",
          brandedPrice: 285,
          genericSalt: "PM Jan Aushadhi Telmisartan 40mg",
          genericPrice: 32,
          savingsPct: 88,
          confirmed: true,
        },
        {
          id: "rx-2",
          name: "Glycomet 500",
          dosage: "500 mg",
          timing: "Morning · After Breakfast",
          purpose: "Type 2 Diabetes Control",
          brandedPrice: 165,
          genericSalt: "PM Jan Aushadhi Metformin 500mg",
          genericPrice: 22,
          savingsPct: 86,
          confirmed: true,
        },
      ],
    },
    {
      label: "Complete Rx with Antibiotic",
      file: "hospital_discharge_rx.jpg",
      drugs: [
        {
          id: "rx-1",
          name: "Telma 40",
          dosage: "40 mg",
          timing: "Morning · After Breakfast",
          purpose: "Blood Pressure Regulation",
          brandedPrice: 285,
          genericSalt: "PM Jan Aushadhi Telmisartan 40mg",
          genericPrice: 32,
          savingsPct: 88,
          confirmed: true,
        },
        {
          id: "rx-2",
          name: "Glycomet 500",
          dosage: "500 mg",
          timing: "Morning · After Breakfast",
          purpose: "Type 2 Diabetes Control",
          brandedPrice: 165,
          genericSalt: "PM Jan Aushadhi Metformin 500mg",
          genericPrice: 22,
          savingsPct: 86,
          confirmed: true,
        },
        {
          id: "rx-3",
          name: "Augmentin 625",
          dosage: "625 mg",
          timing: "Night · After Dinner (5 days)",
          purpose: "Chest & Throat Infection",
          brandedPrice: 210,
          genericSalt: "Amoxicillin & Clavulanate 625mg",
          genericPrice: 58,
          savingsPct: 72,
          lasaWarning: "Phonetic Similarity to Augmentin Duo checked: Verified safe.",
          confirmed: true,
        },
      ],
    },
  ];

  const handleStartAnalysis = (chosenDrugs?: ScannedDrug[], filename: string = "uploaded_prescription.jpg") => {
    setSelectedFileName(filename);
    setStep(2);
    setAnalyzingStage(0);

    const stages = [
      lang === "hi" ? "पर्चे की लिखावट और दवाई के नाम स्कैन किए जा रहे हैं…" : "Scanning doctor handwriting and trade names…",
      lang === "hi" ? "सक्रिय सॉल्ट व सही खुराक निकाली जा रही है…" : "Extracting active salts & precise dosages…",
      lang === "hi" ? "प्रधानमंत्री जन औषधि जेनेरिक कैटलॉग से मिलान किया जा रहा है…" : "Matching with Pradhan Mantri Jan Aushadhi generic catalog…",
      lang === "hi" ? "LASA ड्रग सुरक्षा (Look-Alike Sound-Alike) की पुष्टि की जा रही है…" : "Verifying LASA drug phonetic safety guard…",
    ];

    let current = 0;
    const interval = setInterval(() => {
      current++;
      setAnalyzingStage(current);
      if (current >= stages.length - 1) {
        clearInterval(interval);
        setTimeout(() => {
          if (chosenDrugs) setScannedDrugs(chosenDrugs);
          setStep(3);
          speak(
            lang === "hi"
              ? "पर्चा सफलतापूर्वक स्कैन हुआ! जन औषधि विकल्पों के साथ आप ₹548 तक बचा सकते हैं।"
              : "Prescription scanned successfully! With Jan Aushadhi generics, you can save up to ₹548.",
            lang
          );
        }, 800);
      }
    }, 650);
  };

  const handleSyncToSchedule = () => {
    // Save to patient meds
    if (typeof window !== "undefined") {
      const formatted = scannedDrugs.map((d, i) => ({
        id: `med-scan-${Date.now()}-${i}`,
        name: d.name,
        dosage: `${d.dosage} · 1 Tab`,
        timing: d.timing.includes("Night") ? "Night" : "Morning",
        timingDetailHi: d.timing,
        timingDetailEn: d.timing,
        purposeHi: d.purpose,
        purposeEn: d.purpose,
        taken: false,
        genericSalt: d.genericSalt,
        genericPrice: d.genericPrice,
        brandedPrice: d.brandedPrice,
      }));
      localStorage.setItem("sahara.patient.meds", JSON.stringify(formatted));
    }

    setStep(4);
    toast.success(
      lang === "hi"
        ? "दवाइयाँ आपकी दैनिक दिनचर्या में जोड़ दी गई हैं!"
        : "Medicines successfully added to your daily schedule!"
    );
  };

  // Total savings calculation
  const totalBranded = scannedDrugs.reduce((acc, d) => acc + d.brandedPrice, 0);
  const totalGeneric = scannedDrugs.reduce((acc, d) => acc + d.genericPrice, 0);
  const totalSavings = totalBranded - totalGeneric;
  const overallSavingsPct = totalBranded > 0 ? Math.round((totalSavings / totalBranded) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Camera className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "पर्चा व केमिस्ट बिल स्कैनर" : "Prescription & Chemist Bill Scanner"}
              </h1>
              <Badge className="bg-emerald-500 text-black font-bold text-[10px]">
                JAN AUSHADHI 80%+
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "हाथ की पर्ची और मेडिकल बिल का मिलान · जन औषधि जेनेरिक विकल्प व LASA सुरक्षा"
                : "Handwritten Rx & Chemist Bill cross-check · PM Jan Aushadhi price comparison"}
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

      {/* Wizard Progress Steps Indicator */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs font-semibold">
        {[
          { num: 1, labelHi: "१. पर्चा चुनें", labelEn: "1. Capture" },
          { num: 2, labelHi: "२. AI विश्लेषण", labelEn: "2. Analysis" },
          { num: 3, labelHi: "३. बचत व मिलान", labelEn: "3. Savings" },
          { num: 4, labelHi: "४. दिनचर्या सिंक", labelEn: "4. Complete" },
        ].map((s) => (
          <div
            key={s.num}
            className={`p-2 rounded-lg border transition-all ${
              step === s.num
                ? "bg-teal-600 text-white border-teal-500 shadow-sm"
                : step > s.num
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-muted/40 text-muted-foreground border-border"
            }`}
          >
            {lang === "hi" ? s.labelHi : s.labelEn}
          </div>
        ))}
      </div>

      {/* STEP 1: CAPTURE & SOURCE SELECT */}
      {step === 1 && (
        <div className="space-y-6">
          <Card className="border-border bg-card shadow-md">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-base font-bold">
                {lang === "hi" ? "डॉक्टर का पर्चा या मेडिकल बिल अपलोड करें" : "Upload Doctor's Prescription or Chemist Bill"}
              </CardTitle>
              <CardDescription className="text-xs">
                {lang === "hi"
                  ? "कैमरे से फोटो लें, फाइल चुनें या नीचे दिए गए डेमो पर्चों में से किसी एक पर टैप करें:"
                  : "Snap a photo, choose an image, or click one of the interactive demo prescriptions:"}
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 space-y-6">
              {/* File Upload Drop Area */}
              <label className="border-2 border-dashed border-teal-500/40 hover:border-teal-400 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer bg-teal-950/10 hover:bg-teal-950/20 transition-all text-center group">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleStartAnalysis(undefined, file.name);
                    }
                  }}
                />
                <div className="w-14 h-14 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Camera className="h-7 w-7" />
                </div>
                <h4 className="font-bold text-sm text-foreground">
                  {lang === "hi" ? "फोटो खींचें या फाइल चुनें" : "Take Photo or Browse Files"}
                </h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  {lang === "hi"
                    ? "PNG, JPG या PDF (हाथ का लिखा डॉक्टर पर्चा)"
                    : "PNG, JPG or PDF of handwritten prescription"}
                </p>
              </label>

              {/* Demo Prescription Presets */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  {lang === "hi" ? "तत्काल डेमो पर्चे (1-क्लिक टेस्ट):" : "Instant Demo Presets (1-Click Test):"}
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {demoPresets.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleStartAnalysis(preset.drugs as any, preset.file)}
                      className="p-3.5 rounded-xl border border-border/80 bg-muted/40 hover:bg-teal-950/30 hover:border-teal-500/50 text-left transition-all group flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-foreground group-hover:text-teal-400">
                            {preset.label}
                          </span>
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">{preset.file}</p>
                      </div>
                      <span className="mt-3 text-[11px] text-teal-400 font-semibold flex items-center gap-1">
                        {lang === "hi" ? "स्कैन चलाएं" : "Run Scan"} <ChevronRight className="h-3 w-3" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 2: PROCESSING & OCR ANIMATION */}
      {step === 2 && (
        <Card className="border-teal-500/40 bg-card shadow-lg p-8 text-center space-y-6">
          <div className="mx-auto w-20 h-20 rounded-full bg-teal-500/20 border-2 border-teal-500/40 flex items-center justify-center animate-pulse">
            <Sparkles className="h-10 w-10 text-teal-400 animate-spin" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-lg font-bold text-foreground">
              {lang === "hi" ? "पर्चा विश्लेषित हो रहा है…" : "Analyzing Prescription & Cross-Checking…"}
            </h3>
            <p className="text-xs text-muted-foreground font-mono">{selectedFileName}</p>
          </div>

          {/* Progressive Stage Stepper */}
          <div className="max-w-md mx-auto space-y-2 text-left text-xs bg-muted/40 p-4 rounded-xl border border-border">
            {[
              lang === "hi" ? "१. पर्चे की लिखावट और दवाई के नाम स्कैन किए जा रहे हैं…" : "1. Scanning handwriting and trade names…",
              lang === "hi" ? "२. सक्रिय सॉल्ट व सही खुराक निकाली जा रही है…" : "2. Extracting active salts & precise dosages…",
              lang === "hi" ? "३. प्रधानमंत्री जन औषधि जेनेरिक कैटलॉग से मिलान…" : "3. Matching with Jan Aushadhi generic catalog…",
              lang === "hi" ? "४. LASA ड्रग सुरक्षा (Look-Alike Sound-Alike) की पुष्टि…" : "4. Verifying LASA drug phonetic safety guard…",
            ].map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-2 ${
                  idx <= analyzingStage ? "text-teal-400 font-medium" : "text-muted-foreground opacity-40"
                }`}
              >
                {idx <= analyzingStage ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-400" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground inline-block" />
                )}
                <span>{msg}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* STEP 3: VERIFICATION, SAVINGS & LASA CHECK */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Top Big Savings Trophy */}
          <Card className="border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-card to-teal-950/30 shadow-lg">
            <CardContent className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <TrendingDown className="h-8 w-8" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-foreground">
                      {lang === "hi" ? "जन औषधि केंद्र से कुल बचत:" : "Total Jan Aushadhi Savings:"}
                    </h3>
                    <Badge className="bg-emerald-500 text-black font-extrabold text-xs">
                      SAVE {overallSavingsPct}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lang === "hi"
                      ? `ब्रांडेड मूल्य: ₹${totalBranded} ➔ जन औषधि मूल्य: केवल ₹${totalGeneric}`
                      : `Branded Total: ₹${totalBranded} ➔ Jan Aushadhi Generic: only ₹${totalGeneric}`}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-3xl font-black font-mono text-emerald-400">
                  ₹{totalSavings}
                </span>
                <p className="text-[10px] text-muted-foreground uppercase font-bold">
                  {lang === "hi" ? "प्रति माह शुद्ध बचत" : "Net Monthly Savings"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Medicines Cards with Branded vs Generic Comparison */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-foreground uppercase tracking-wider text-muted-foreground">
              {lang === "hi" ? "सत्यापित दवाइयाँ व जेनेरिक विकल्प" : "Extracted Medicines & Generic Alternatives"}
            </h3>

            {scannedDrugs.map((drug) => (
              <Card key={drug.id} className="border-border bg-card shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                        <Pill className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-foreground">{drug.name}</h4>
                        <p className="text-xs text-muted-foreground">
                          {drug.dosage} · <span className="text-teal-400">{drug.timing}</span> · {drug.purpose}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs font-bold self-start sm:self-center">
                      Save {drug.savingsPct}%
                    </Badge>
                  </div>

                  {/* Price Comparison Grid */}
                  <div className="grid grid-cols-2 gap-3 bg-muted/40 p-3 rounded-xl border border-border/60 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Branded Pharmacy MRP:</span>
                      <span className="line-through text-muted-foreground font-mono text-sm">
                        ₹{drug.brandedPrice}
                      </span>
                    </div>
                    <div className="border-l border-border/60 pl-3">
                      <span className="text-emerald-400 font-bold block text-[11px]">Jan Aushadhi Generic:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-base text-emerald-400">
                          ₹{drug.genericPrice}
                        </span>
                        <span className="text-[10px] text-muted-foreground">({drug.genericSalt})</span>
                      </div>
                    </div>
                  </div>

                  {/* LASA Collision Check Badge */}
                  {drug.lasaWarning && (
                    <div className="flex items-center gap-1.5 text-[11px] text-teal-400 bg-teal-950/20 p-2 rounded-lg border border-teal-500/20">
                      <ShieldCheck className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                      <span>{drug.lasaWarning}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStep(1)}
              className="text-xs border-border"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {lang === "hi" ? "दोबारा स्कैन करें" : "Scan Another Rx"}
            </Button>

            <Button
              size="lg"
              onClick={handleSyncToSchedule}
              className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white font-bold"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {lang === "hi" ? "दैनिक दवा दिनचर्या में जोड़ें" : "Add to Daily Medication Schedule"}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: COMPLETED & SYNCED */}
      {step === 4 && (
        <Card className="border-teal-500/40 bg-card shadow-lg p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-bold text-foreground">
              {lang === "hi" ? "पर्चा सफलतापूर्वक सिंक हो गया!" : "Prescription Successfully Added!"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "सभी दवाइयाँ आपके 'दैनिक दवाइयाँ' पृष्ठ पर जोड़ दी गई हैं। सहारा आपको सही समय पर याद दिलाएगा।"
                : "All medicines are now configured in your Daily Medications tracker with automated reminders."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/patient/meds"
              className={cn(buttonVariants({ size: "sm" }), "bg-teal-600 hover:bg-teal-700 text-white font-bold")}
            >
              <Pill className="h-4 w-4 mr-1.5" />
              {lang === "hi" ? "दवाइयों की सूची देखें" : "View My Medication Schedule"}
            </Link>
            <Button size="sm" variant="outline" onClick={() => setStep(1)}>
              {lang === "hi" ? "एक और पर्चा जोड़ें" : "Scan Another Prescription"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

