"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Camera,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  X,
  Activity,
  ScanLine,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { MedicationScheduleReview, type ReviewedMedication } from "./medication-schedule";
import { scheduleToCanonicalFrequency } from "@/lib/clinical/frequency";

export interface DocumentCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDocumentProcessed: (result: any) => void;
  sessionId?: string | null;
  patientId?: string | null;
  lang?: "en" | "hi";
}

export default function DocumentCaptureModal({
  isOpen,
  onClose,
  onDocumentProcessed,
  sessionId,
  patientId,
  lang = "hi",
}: DocumentCaptureModalProps) {
  const [tab, setTab] = useState<"camera" | "upload" | "presets">("presets");
  const [isProcessing, setIsProcessing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<any | null>(null);
  const [verifiedMeds, setVerifiedMeds] = useState<ReviewedMedication[]>([]);
  const [scanSeq, setScanSeq] = useState(0);

  // Camera stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start/Stop Camera
  useEffect(() => {
    if (isOpen && tab === "camera") {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, tab]);

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 1280, height: 720 },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }
    } catch (err: any) {
      console.warn("Camera access failed:", err);
      toast.error(
        lang === "hi"
          ? "कैमरा शुरू नहीं हो सका। कृपया फ़ाइल अपलोड या प्रीसेट चुनें।"
          : "Could not access camera. Please use file upload or demo presets."
      );
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Capture frame from video stream
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(dataUrl);
      stopCamera();
      processOcr({ image_base64: dataUrl });
    }
  };

  // File Upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setCapturedImage(dataUrl);
      processOcr({ image_base64: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  // Preset Selection handler
  const handlePresetSelect = (presetId: string) => {
    setCapturedImage(null);
    processOcr({ sample_preset: presetId });
  };

  // Call /api/ocr
  const processOcr = async (payload: { image_base64?: string; sample_preset?: string }) => {
    setIsProcessing(true);
    setOcrResult(null);
    setScanSeq((n) => n + 1);
    try {
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          session_id: sessionId,
          patient_id: patientId,
        }),
      });
      const data = await res.json();
      if (data.success && data.parsed) {
        setOcrResult(data);
        toast.success(
          lang === "hi"
            ? `ओसीआर संपन्न: ${data.extracted_medications_count || 0} दवाइयाँ व ${data.extracted_lab_results_count || 0} लैब परिणाम पहचाने गए!`
            : `OCR complete: ${data.extracted_medications_count || 0} meds & ${data.extracted_lab_results_count || 0} lab tests extracted!`
        );
      } else {
        toast.error(data.error || "OCR processing failed");
      }
    } catch (err: any) {
      toast.error("OCR API error: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAndAttach = () => {
    if (!ocrResult?.parsed) return;
    onDocumentProcessed({
      name:
        ocrResult.parsed.document_type === "lab_report"
          ? "Blood_Panel_Report.jpg"
          : "Prescription_AIIA_2026.jpg",
      type: ocrResult.parsed.document_type || "prescription",
      status: "Processed",
      entities:
        (ocrResult.parsed.medications?.length || 0) +
        (ocrResult.parsed.lab_results?.length || 0),
      medications: verifiedMeds.length ? verifiedMeds : ocrResult.parsed.medications,
      labResults: ocrResult.parsed.lab_results,
      interactions: ocrResult.interactions,
    });
    // Persist the verified schedule so patient/records reflects the correction later.
    if (ocrResult.document_id && verifiedMeds.length) {
      fetch("/api/verify-medications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: ocrResult.document_id,
          medications: verifiedMeds.map((m) => ({
            match_name: m.originalName,
            name: m.name,
            dosage: m.dosage,
            frequency: scheduleToCanonicalFrequency(m.schedule),
          })),
        }),
      }).catch(() => {});
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-sky-600 text-white font-bold">
              <ScanLine className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {lang === "hi"
                  ? "कागज़ी पर्चा व लैब रिपोर्ट ओसीआर स्कैनर"
                  : "Prescription & Lab Report Vision OCR Scanner"}
              </h2>
              <p className="text-[11px] text-slate-400">
                Powered by Google Gemini 2.5 Flash Vision AI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Method Tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-800/80 p-1">
            <button
              onClick={() => {
                setTab("presets");
                setCapturedImage(null);
                setOcrResult(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                tab === "presets"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {lang === "hi" ? "त्वरित नमूना पर्चे (Presets)" : "Clinical Presets"}
            </button>
            <button
              onClick={() => {
                setTab("upload");
                setCapturedImage(null);
                setOcrResult(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                tab === "upload"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {lang === "hi" ? "फ़ाइल अपलोड करें" : "Upload File"}
            </button>
            <button
              onClick={() => {
                setTab("camera");
                setCapturedImage(null);
                setOcrResult(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                tab === "camera"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {lang === "hi" ? "कियोस्क कैमरा (Live Cam)" : "Live Camera"}
            </button>
          </div>

          {/* Preset Selector */}
          {tab === "presets" && !isProcessing && !ocrResult && (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-300">
                {lang === "hi"
                  ? "परीक्षण हेतु नीचे दिए गए आधिकारिक पर्चों में से किसी एक पर क्लिक करें:"
                  : "Select an official clinical prescription sample to test real Vision AI extraction:"}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  onClick={() => handlePresetSelect("ayush_prescription")}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-left hover:border-slate-500 transition-all hover:bg-slate-800"
                >
                  <Sparkles className="w-5 h-5 text-slate-300 mb-1.5" />
                  <div className="font-bold text-xs text-slate-200">Ayush Prescription</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    AIIA: Ashwagandha 3g BD, Kaishore Guggulu 2 tabs BD, Giloy Kwath
                  </div>
                </button>

                <button
                  onClick={() => handlePresetSelect("allopathic_cardiology")}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-left hover:border-slate-500 transition-all hover:bg-slate-800"
                >
                  <Stethoscope className="w-5 h-5 text-slate-300 mb-1.5" />
                  <div className="font-bold text-xs text-slate-200">Cardiology Allopathy</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    GMCH: Metoprolol 50mg OD, Ramipril 5mg, Aspirin 75mg OD
                  </div>
                </button>

                <button
                  onClick={() => handlePresetSelect("diabetic_lab_report")}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-left hover:border-slate-500 transition-all hover:bg-slate-800"
                >
                  <Activity className="w-5 h-5 text-slate-300 mb-1.5" />
                  <div className="font-bold text-xs text-slate-200">NABL Lab Report</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    HbA1c 8.6%, Fasting Glucose 174 mg/dL, Serum Creatinine 1.4
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Upload Zone */}
          {tab === "upload" && !isProcessing && !ocrResult && (
            <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-800/40 p-8 cursor-pointer hover:border-sky-500 transition-colors">
              <UploadCloud className="size-10 text-sky-400 mb-2" />
              <div className="font-bold text-xs text-slate-200">
                {lang === "hi" ? "पर्चे की फोटो खींचकर यहाँ लाएँ या चुनें" : "Drag & Drop prescription photo or click to browse"}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Supports JPG, PNG, WEBP, PDF up to 10MB</p>
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
          )}

          {/* Live Camera Feed */}
          {tab === "camera" && !isProcessing && !ocrResult && (
            <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black aspect-video flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
              {/* Document Alignment Frame */}
              <div className="absolute inset-8 border-2 border-dashed border-sky-400/80 rounded-lg pointer-events-none flex items-center justify-center">
                <span className="bg-black/60 px-3 py-1 rounded text-[11px] text-sky-200">
                  {lang === "hi" ? "पर्चे को इस चौखट में सीधा रखें" : "Align prescription within frame"}
                </span>
              </div>
              <div className="absolute bottom-4">
                <Button
                  onClick={capturePhoto}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs gap-2 px-5 py-2 shadow-lg"
                >
                  <Camera className="size-4" />
                  {lang === "hi" ? "फोटो खींचें और ओसीआर करें" : "Capture & Run Vision OCR"}
                </Button>
              </div>
            </div>
          )}

          {/* Scanning Animation & Progress */}
          {isProcessing && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-8 flex flex-col items-center justify-center space-y-3">
              <div className="relative size-16">
                <RefreshCw className="size-16 text-sky-500 animate-spin" />
                <Sparkles className="size-6 text-amber-400 absolute inset-0 m-auto animate-pulse" />
              </div>
              <div className="text-sm font-bold text-slate-100">
                {lang === "hi" ? "जेमिनी विज़न एआई दस्तावेज़ पढ़ रहा है…" : "Gemini Vision AI analyzing medical text…"}
              </div>
              <p className="text-xs text-slate-400">
                Extracting medications, strengths, dosages &amp; running an advisory drug-interaction check
              </p>
            </div>
          )}

          {/* OCR Result Display */}
          {ocrResult && (
            <div className="space-y-4 animate-in fade-in">
              {/* Metadata Banner */}
              <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-sky-300">
                    {ocrResult.parsed.doctor_name || "Physician"} · {ocrResult.parsed.facility}
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Date: {ocrResult.parsed.prescription_date} · Type: {ocrResult.parsed.document_type}
                  </div>
                </div>
                <Badge variant="outline" className="border-emerald-500 text-emerald-300 text-[10px] gap-1">
                  <CheckCircle2 className="size-3 text-emerald-400" />
                  <span>AI-extracted · verify below</span>
                </Badge>
              </div>

              {/* Drug-Drug Interaction Alert if any */}
              {ocrResult.interactions && ocrResult.interactions.length > 0 && (
                <div className="rounded-lg border border-amber-500/80 bg-amber-950/50 p-3.5 text-xs text-amber-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-400">
                    <AlertTriangle className="size-4" />
                    <span>Possible drug interaction — review with your doctor/pharmacist</span>
                  </div>
                  {ocrResult.interactions.map((inter: any, idx: number) => (
                    <div key={idx} className="text-[11px] leading-relaxed">
                      • <strong>{inter.drugA.toUpperCase()} + {inter.drugB.toUpperCase()}:</strong> {inter.warning}
                    </div>
                  ))}
                </div>
              )}

              {/* Extracted Medications — editable schedule + human verification */}
              {ocrResult.parsed.medications && ocrResult.parsed.medications.length > 0 && (
                <MedicationScheduleReview
                  key={scanSeq}
                  medications={ocrResult.parsed.medications}
                  lang={lang}
                  onChange={setVerifiedMeds}
                />
              )}

              {/* Extracted Lab Analytes */}
              {ocrResult.parsed.lab_results && ocrResult.parsed.lab_results.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Activity className="size-3.5 text-amber-400" />
                    <span>Extracted Lab Analytes ({ocrResult.parsed.lab_results.length})</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ocrResult.parsed.lab_results.map((lab: any, i: number) => (
                      <div
                        key={i}
                        className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-100">{lab.test_name}</span>
                          <Badge
                            variant="outline"
                            className={
                              lab.flag === "HIGH"
                                ? "border-red-500 text-red-400 text-[9px]"
                                : "border-emerald-500 text-emerald-400 text-[9px]"
                            }
                          >
                            {lab.flag}
                          </Badge>
                        </div>
                        <div className="font-mono text-amber-300 text-[11px]">
                          {lab.value} {lab.unit}
                        </div>
                        <div className="text-slate-400 text-[10px]">Ref: {lab.reference_range}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOcrResult(null);
                    setCapturedImage(null);
                  }}
                  className="text-xs border-slate-700 text-slate-300"
                >
                  {lang === "hi" ? "पुनः स्कैन करें" : "Scan Another"}
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmAndAttach}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
                >
                  <CheckCircle2 className="size-3.5" />
                  {lang === "hi" ? "स्वीकार करें व रिकॉर्ड से जोड़ें" : "Confirm & Attach to Consultation"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
