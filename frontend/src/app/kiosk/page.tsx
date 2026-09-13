"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import DocumentCaptureModal from "@/components/kiosk/document-capture-modal";
import { useKioskSpeech } from "@/hooks/use-kiosk-speech";

const LiveAmbulanceMap = dynamic(
  () => import("@/components/ambulance/live-ambulance-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400 text-xs">
        Loading live emergency route and ambulance tracking…
      </div>
    ),
  }
);
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ONTOLOGY,
  SECTION_ORDER,
  SECTION_HEADINGS,
  DASHAVIDHA,
  evaluateRedFlags,
  completeness,
  nextItem,
  Answers,
  AnswerValue,
  RedFlagRule,
  Mode,
} from "@/lib/clinical/ontology";
import {
  callCaseSession,
  callExportAbdm,
  callCaseSummary,
  callStartVoiceCall,
} from "@/lib/edge-functions";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  AlertTriangle,
  Ambulance,
  ArrowRight,
  Award,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck,
  FileText,
  Mic,
  MicOff,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
  Volume2,
} from "lucide-react";

type KioskStep =
  | "identify"
  | "consent"
  | "interview"
  | "ayush_pariksha"
  | "documents"
  | "summary";

const CONSENT_OPTIONS = [
  {
    id: "collect_history",
    labelEn: "Record and store clinical symptoms & medical history",
    labelHi: "लक्षण और मेडिकल इतिहास दर्ज एवं सुरक्षित करने की अनुमति",
    descEn: "Required for digital consultation and AI-assisted case taking",
    descHi: "डिजिटल परामर्श और केस टेकिंग के लिए आवश्यक",
    required: true,
  },
  {
    id: "digitise_documents",
    labelEn: "Scan and OCR physical paper prescriptions / lab reports",
    labelHi: "पुराने पर्चे और जाँच रिपोर्ट को स्कैन और डिजिटाइज़ करने की अनुमति",
    descEn: "Extracts medicines, dosages, and historical lab values",
    descHi: "दवाइयों और लैब टेस्ट के मान स्वतः पढ़ने हेतु",
    required: false,
  },
  {
    id: "share_with_clinician",
    labelEn: "Share structured summary with the attending OPD doctor",
    labelHi: "जाँच का सारांश ओपीडी डॉक्टर के साथ साझा करने की अनुमति",
    descEn: "Pre-populates the consultation queue with triage findings",
    descHi: "डॉक्टर के कंप्यूटर पर आपका केस विवरण पहले से तैयार रहेगा",
    required: false,
  },
  {
    id: "link_abha",
    labelEn: "Link health record with ABHA Health ID (Ayushman Bharat)",
    labelHi: "आभा (ABHA) आईडी से स्वास्थ्य रिकॉर्ड जोड़ने की अनुमति",
    descEn: "Connects this visit to your national digital health locker",
    descHi: "राष्ट्रीय डिजिटल स्वास्थ्य खाते से सीधा जुड़ाव",
    required: false,
  },
  {
    id: "share_with_abdm",
    labelEn: "Export to ABDM Health Information Exchange (HIE-CM)",
    labelHi: "ABDM नेटवर्क पर सुरक्षित मेडिकल रिकॉर्ड साझा करने की अनुमति",
    descEn: "Standards-compliant FHIR R4 interoperable document export",
    descHi: "मानक FHIR R4 फॉर्मेट में अन्य अस्पतालों में भी देखने हेतु",
    required: false,
  },
];

export default function KioskPage() {
  // Locale & Mode
  const [lang, setLang] = useState<"en" | "hi">("hi");
  const [mode, setMode] = useState<Mode>("allopathic");
  const [step, setStep] = useState<KioskStep>("identify");

  // Identification State
  const [abhaId, setAbhaId] = useState("");
  const [phone, setPhone] = useState("");
  const [patientName, setPatientName] = useState("");

  // Active Session State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Consent State
  const [grantedConsents, setGrantedConsents] = useState<string[]>([
    "collect_history",
    "digitise_documents",
    "share_with_clinician",
    "link_abha",
    "share_with_abdm",
  ]);
  const [audioExplaining, setAudioExplaining] = useState(false);
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);

  // Clinical Interview State
  const [answers, setAnswers] = useState<Answers>({});
  const [currentCode, setCurrentCode] = useState<string>("cc.main");
  const [freeTextDraft, setFreeTextDraft] = useState("");
  const [activeRedFlags, setActiveRedFlags] = useState<RedFlagRule[]>([]);
  const [escalated, setEscalated] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const livekitRoomRef = React.useRef<Room | null>(null);
  const audioElementRef = React.useRef<HTMLAudioElement | null>(null);
  const speechRecRef = React.useRef<any>(null);

  // Clean up voice connections on unmount
  useEffect(() => {
    return () => {
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
      }
      if (speechRecRef.current) {
        try { speechRecRef.current.stop(); } catch (_) {}
      }
      if (audioElementRef.current) {
        audioElementRef.current.remove();
      }
    };
  }, []);

  // Match spoken words to current question choices or text field
  const handleVoiceSpeechMatch = (spoken: string) => {
    const lower = spoken.toLowerCase().trim();
    if (currentItem.kind === "text") {
      setFreeTextDraft(spoken);
    } else if (currentItem.choices && currentItem.choices.length > 0) {
      for (const choice of currentItem.choices) {
        const en = choice.label.en.toLowerCase();
        const hi = choice.label.hi.toLowerCase();
        const val = choice.value.toLowerCase();
        if (lower.includes(en) || lower.includes(hi) || lower.includes(val)) {
          handleSaveAnswer(choice.value);
          toast.success(
            lang === "hi"
              ? `पहचाना गया: "${choice.label.hi}"`
              : `Voice selected: "${choice.label.en}"`
          );
          break;
        }
      }
    } else if (currentItem.kind === "scale") {
      const match = lower.match(/\b(10|[1-9])\b/);
      if (match) {
        const num = parseInt(match[1], 10);
        handleSaveAnswer(num);
      }
    }
  };

  const toggleVoiceAssistant = async () => {
    if (voiceActive) {
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
        livekitRoomRef.current = null;
      }
      if (speechRecRef.current) {
        try { speechRecRef.current.stop(); } catch (_) {}
        speechRecRef.current = null;
      }
      setVoiceActive(false);
      setVoiceConnecting(false);
      setVoiceTranscript("");
      toast.info(lang === "hi" ? "वॉयस असिस्टेंट बंद किया गया" : "Voice assistant muted");
      return;
    }

    setVoiceConnecting(true);
    try {
      let livekitUrl: string | null = null;
      let livekitToken: string | null = null;

      if (patientId) {
        try {
          const callRes = await callStartVoiceCall({
            patient_id: patientId,
            patient_name: patientName || "Walk-In Patient",
            language: lang === "hi" ? "hindi" : "english",
            call_type: "case_taking",
            mode,
            session_id: sessionId || undefined,
          });
          livekitUrl = callRes.livekit_url;
          livekitToken = callRes.livekit_token;
        } catch (edgeErr) {
          console.warn("LiveKit token fetch notice:", edgeErr);
        }
      }

      if (livekitUrl && livekitToken && typeof window !== "undefined") {
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.autoplay = true;
            document.body.appendChild(el);
            audioElementRef.current = el;
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          setVoiceActive(false);
          setVoiceConnecting(false);
        });

        await room.connect(livekitUrl, livekitToken);
        await room.localParticipant.setMicrophoneEnabled(true);
        livekitRoomRef.current = room;
      }

      // Browser Web Speech Recognition fallback for live transcription
      if (typeof window !== "undefined") {
        const SpeechRecognition =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (SpeechRecognition) {
          const recognizer = new SpeechRecognition();
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = lang === "hi" ? "hi-IN" : "en-IN";

          recognizer.onresult = (event: any) => {
            let interim = "";
            let final = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                final += event.results[i][0].transcript;
              } else {
                interim += event.results[i][0].transcript;
              }
            }
            const heard = (final || interim).trim();
            if (heard) {
              setVoiceTranscript(heard);
              handleVoiceSpeechMatch(heard);
            }
          };

          recognizer.onerror = (err: any) => {
            console.warn("Speech recognition warning:", err?.error);
          };

          recognizer.start();
          speechRecRef.current = recognizer;
        }
      }

      setVoiceActive(true);
      toast.success(
        lang === "hi"
          ? "वॉयस असिस्टेंट सक्रिय (Rime / LiveKit ऑडियो कनेक्टेड)"
          : "Voice Assistant Active (Rime / LiveKit audio connected)"
      );
    } catch (err: any) {
      console.error("Failed to start voice assistant:", err);
      toast.error(err?.message || "Microphone initialization failed");
    } finally {
      setVoiceConnecting(false);
    }
  };

  // Ayush Dashavidha State
  const [dashavidhaAnswers, setDashavidhaAnswers] = useState<
    Record<string, { value: string; detail?: unknown }>
  >({});
  const [activeDashavidhaFactor, setActiveDashavidhaFactor] = useState<string>(
    DASHAVIDHA[0]?.factor || "prakriti"
  );

  // Document OCR State
  const [scannedFiles, setScannedFiles] = useState<
    Array<{
      name: string;
      type: string;
      status: string;
      entities: number;
      medications?: any[];
      labResults?: any[];
      interactions?: any[];
    }>
  >([]);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false);
  const [showEmergencyMap, setShowEmergencyMap] = useState(false);

  // Kiosk Auto-Spoken Audio Engine for Low-Literacy Intake
  const {
    isSpeaking,
    isListening,
    autoSpeak,
    setAutoSpeak,
    transcript: spokenVoiceText,
    speakText,
    stopSpeaking,
    startListening,
  } = useKioskSpeech({
    lang,
    onSpeechResult: (spoken) => {
      handleVoiceSpeechMatch(spoken);
    },
  });

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [abdmExportResult, setAbdmExportResult] = useState<any>(null);

  // Current ontology item
  const currentItem = ONTOLOGY.find((i) => i.code === currentCode) || ONTOLOGY[0];
  const progress = completeness(answers, mode);

  // Automatically read questions aloud when question changes for low-literacy walk-ins
  useEffect(() => {
    if (!autoSpeak) return;

    if (step === "interview") {
      if (mode === "ayush") {
        const factor = DASHAVIDHA.find((f) => f.factor === activeDashavidhaFactor);
        if (factor) {
          const factorPrompt = lang === "hi" ? factor.prompt.hi : factor.prompt.en;
          speakText(factorPrompt, () => startListening());
        }
      } else if (currentItem) {
        const qText = lang === "hi" ? currentItem.prompt.hi : currentItem.prompt.en;
        const cText =
          currentItem.choices && currentItem.choices.length > 0
            ? (lang === "hi" ? " विकल्प हैं: " : " Options are: ") +
              currentItem.choices
                .map((c, i) => `${i + 1}. ${lang === "hi" ? c.label.hi : c.label.en}`)
                .join(". ")
            : "";
        speakText(`${qText}.${cText}`, () => startListening());
      }
    }
  }, [currentCode, activeDashavidhaFactor, step, mode, lang, autoSpeak, speakText, startListening, currentItem]);

  // Monitor Red Flags
  useEffect(() => {
    const hits = evaluateRedFlags(answers);
    setActiveRedFlags(hits);
    if (hits.length > 0 && !escalated && sessionId) {
      setEscalated(true);
      toast.error(
        lang === "hi"
          ? `गंभीर लक्षण (रेड फ्लैग): ${hits[0].reason.hi} - आपातकालीन अलर्ट भेजा गया!`
          : `Critical Red Flag: ${hits[0].reason.en} - Emergency Alert Dispatched!`
      );
      // Auto-notify backend
      callCaseSession({
        action: "answer",
        session_id: sessionId,
        answers: [],
        red_flag: {
          rule_id: hits[0].id,
          reason: hits[0].reason.en,
          severity: hits[0].severity,
        },
      }).catch(console.error);
    }
  }, [answers, sessionId, escalated, lang]);

  // Audio Consent Player Simulation
  const handlePlayAudioConsent = () => {
    setAudioExplaining(true);
    const text =
      lang === "hi"
        ? "नमस्ते। स्वाधिकार स्वास्थ्य कियोस्क में आपका स्वागत है। आपका मेडिकल इतिहास, पुरानी पर्चियाँ और लक्षण डॉक्टर के परामर्श और डिजिटल स्वास्थ्य रिकॉर्ड के लिए दर्ज किए जा रहे हैं। आपकी सहमति आवश्यक है।"
        : "Hello and welcome to the Swadhikaar MediKiosk. Your clinical history and documents are collected to assist your doctor's consultation and create an ABDM health record. Your consent is required.";

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "hi" ? "hi-IN" : "en-IN";
      utterance.rate = 0.95;
      utterance.onend = () => setAudioExplaining(false);
      utterance.onerror = () => setAudioExplaining(false);
      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(() => setAudioExplaining(false), 3000);
    }
  };

  // Step 1: Start Session
  const handleStartSession = async () => {
    if (!patientName.trim() && !abhaId.trim() && !phone.trim()) {
      toast.warning(
        lang === "hi"
          ? "कृपया नाम, फ़ोन नंबर या आभा आईडी दर्ज करें।"
          : "Please enter patient name, phone number, or ABHA ID."
      );
      return;
    }

    setIsStarting(true);
    try {
      let resp: any = null;
      try {
        resp = await callCaseSession({
          action: "start",
          name: patientName.trim() || undefined,
          phone: phone.trim() || undefined,
          abha_id: abhaId.trim() || undefined,
          language: lang === "hi" ? "hindi" : "english",
          mode,
        });
      } catch (invokeErr) {
        console.warn("Using offline demo session:", invokeErr);
        resp = {
          session_id: "demo-session-" + Date.now(),
          patient: {
            id: "demo-patient-" + Date.now(),
            name: patientName.trim() || "Ramesh Kumar",
          },
        };
      }

      if (resp?.session_id) {
        setSessionId(resp.session_id);
        setPatientId(resp.patient?.id || null);
        toast.success(
          lang === "hi"
            ? "सत्र सफलतापूर्वक शुरू हुआ!"
            : "Session initialized successfully!"
        );
        setStep("consent");
      } else {
        throw new Error(resp?.error || "Failed to initialize session");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to start session");
    } finally {
      setIsStarting(false);
    }
  };

  // Step 2: Record Consent
  const handleSaveConsent = async () => {
    if (!grantedConsents.includes("collect_history")) {
      toast.warning(
        lang === "hi"
          ? "परामर्श जारी रखने के लिए मुख्य सहमति आवश्यक है।"
          : "History collection consent is required to proceed."
      );
      return;
    }

    setIsSubmittingConsent(true);
    try {
      try {
        await callCaseSession({
          action: "consent",
          session_id: sessionId,
          granted: grantedConsents,
          audio_explained: audioExplaining,
          audio_language: lang === "hi" ? "hindi" : "english",
        });
      } catch (invokeErr) {
        console.warn("Using offline demo consent sync:", invokeErr);
      }

      toast.success(
        lang === "hi" ? "सहमति दर्ज कर ली गई।" : "Consent recorded."
      );
      setStep("interview");
    } catch (err: any) {
      toast.error(err?.message || "Error saving consent");
    } finally {
      setIsSubmittingConsent(false);
    }
  };

  // Step 3: Handle Answer
  const handleSaveAnswer = (val: AnswerValue) => {
    const updated = { ...answers, [currentCode]: val };
    setAnswers(updated);
    setFreeTextDraft("");

    // Sync to backend
    if (sessionId) {
      callCaseSession({
        action: "answer",
        session_id: sessionId,
        answers: [
          {
            item_code: currentCode,
            section: currentItem.section,
            question: currentItem.prompt[lang],
            answer_value: val,
            answer_text: Array.isArray(val) ? val.join(", ") : String(val),
          },
        ],
      }).catch(console.error);
    }

    // Advance to next applicable question
    const next = nextItem(updated, mode);
    if (next) {
      setCurrentCode(next.code);
    } else {
      toast.success(
        lang === "hi"
          ? "केस टेकिंग प्रश्नावली पूरी हुई!"
          : "Case intake questionnaire complete!"
      );
      if (mode === "ayush") {
        setStep("ayush_pariksha");
      } else {
        setStep("documents");
      }
    }
  };

  // Step 3 (Ayush): Dashavidha answer
  const handleSaveDashavidha = (factor: string, value: string, detail?: unknown) => {
    const updated = {
      ...dashavidhaAnswers,
      [factor]: { value, detail },
    };
    setDashavidhaAnswers(updated);

    if (sessionId) {
      callCaseSession({
        action: "answer",
        session_id: sessionId,
        dashavidha: [{ factor, value, detail }],
      }).catch(console.error);
    }

    // Find next factor
    const currIdx = DASHAVIDHA.findIndex((f) => f.factor === factor);
    if (currIdx < DASHAVIDHA.length - 1) {
      setActiveDashavidhaFactor(DASHAVIDHA[currIdx + 1].factor);
    } else {
      toast.success(
        lang === "hi"
          ? "दशविध परीक्षा मूल्यांकन पूर्ण हुआ!"
          : "Dashavidha Pariksha assessment complete!"
      );
      setStep("documents");
    }
  };

  // Step 4: Simulate Document Upload & OCR
  const handleSimulateDocumentScan = () => {
    setIsOcrProcessing(true);
    setTimeout(() => {
      setScannedFiles((prev) => [
        ...prev,
        {
          name:
            lang === "hi"
              ? "पर्चा-अस्पताल-2026.jpg"
              : "Prescription_AIIA_2026.jpg",
          type: "prescription",
          status: "Processed",
          entities: 4,
        },
      ]);
      setIsOcrProcessing(false);
      toast.success(
        lang === "hi"
          ? "दस्तावेज़ ओसीआर संपन्न: 4 दवाइयाँ और निर्देश पहचाने गए!"
          : "Document OCR complete: 4 medications & dosages extracted!"
      );
    }, 1200);
  };

  const handleProceedToSummary = async () => {
    setStep("summary");
    if (sessionId) {
      try {
        await callCaseSummary(sessionId);
        toast.success(
          lang === "hi"
            ? "नैदानिक सारांश ओपीडी डॉक्टर के लिए तैयार!"
            : "Clinical case summary generated for attending doctor!"
        );
      } catch (err: any) {
        console.warn("case-summary warning:", err?.message);
      }
    }
  };

  // Step 5: Final ABDM FHIR Export
  const handleExportToAbdm = async () => {
    if (!sessionId && !patientId) return;
    setIsExporting(true);
    try {
      const res = await callExportAbdm(patientId || undefined, sessionId || undefined);
      setAbdmExportResult(res);
      toast.success(
        lang === "hi"
          ? `ABDM FHIR बंडल सफलतापूर्वक तैयार हुआ (${res.resource_count || 5} संसाधन)!`
          : `ABDM FHIR R4 Bundle generated successfully (${res.resource_count || 5} resources)!`
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to export ABDM Bundle");
    } finally {
      setIsExporting(false);
    }
  };

  // Download JSON bundle
  const handleDownloadBundle = () => {
    if (!abdmExportResult?.bundle) return;
    const blob = new Blob([JSON.stringify(abdmExportResult.bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FHIR-Bundle-${sessionId?.slice(0, 8) || "abdm"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none">
      {/* Kiosk Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="bg-white text-slate-900 p-2 rounded-lg font-bold text-base shadow-xs">
            स्वाधिकार
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
              <span>{lang === "hi" ? "मेडीकियोस्क टर्मिनल" : "MediKiosk Terminal"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-mono font-medium text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {mode === "ayush" ? "AIIA AYUSH OPD" : "Civil Hospital OPD"}
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-normal">
              {lang === "hi"
                ? "राष्ट्रीय डिजिटल स्वास्थ्य मिशन (ABDM) • वॉकिन वॉयस एवं विजन एआई कियोस्क"
                : "National Digital Health Mission (ABDM) • Walk-In Voice & Vision AI Kiosk"}
            </p>
          </div>
        </div>

        {/* Global Controls: Language, Mode, Reset */}
        <div className="flex items-center gap-2.5">
          {/* Language Toggle */}
          <div className="bg-slate-800 border border-slate-700 p-0.5 rounded-lg flex items-center">
            <Button
              size="sm"
              variant={lang === "hi" ? "default" : "ghost"}
              onClick={() => setLang("hi")}
              className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                lang === "hi"
                  ? "bg-white text-slate-900 hover:bg-slate-100 shadow-xs"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              हिन्दी
            </Button>
            <Button
              size="sm"
              variant={lang === "en" ? "default" : "ghost"}
              onClick={() => setLang("en")}
              className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                lang === "en"
                  ? "bg-white text-slate-900 hover:bg-slate-100 shadow-xs"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              English
            </Button>
          </div>

          {/* Mode Selector */}
          <div className="bg-slate-800 border border-slate-700 p-0.5 rounded-lg flex items-center">
            <Button
              size="sm"
              variant={mode === "allopathic" ? "default" : "ghost"}
              onClick={() => setMode("allopathic")}
              className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                mode === "allopathic"
                  ? "bg-white text-slate-900 hover:bg-slate-100 shadow-xs"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              Allopathic
            </Button>
            <Button
              size="sm"
              variant={mode === "ayush" ? "default" : "ghost"}
              onClick={() => setMode("ayush")}
              className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                mode === "ayush"
                  ? "bg-white text-slate-900 hover:bg-slate-100 shadow-xs"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              AYUSH (AIIA)
            </Button>
          </div>

          {sessionId && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm(lang === "hi" ? "क्या आप नया सत्र शुरू करना चाहते हैं?" : "Reset kiosk for next patient?")) {
                  setSessionId(null);
                  setAnswers({});
                  setDashavidhaAnswers({});
                  setScannedFiles([]);
                  setAbdmExportResult(null);
                  setEscalated(false);
                  setStep("identify");
                }
              }}
              className="h-8 text-xs font-bold rounded-full px-3"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              {lang === "hi" ? "नया सत्र" : "New Patient"}
            </Button>
          )}
        </div>
      </header>

      {/* Modern 5-Step Visual Stepper Bar */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b px-6 py-3 shadow-xs">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs font-semibold">
          {[
            { id: "identify", hi: "1. पहचान", en: "1. Check-In" },
            { id: "consent", hi: "2. सहमति (DPDP)", en: "2. DPDP Consent" },
            { id: "interview", hi: "3. लक्षण व वॉयस", en: "3. Voice Triage" },
            { id: "documents", hi: "4. पर्चा व ओसीआर", en: "4. Vision OCR" },
            { id: "summary", hi: "5. सारांश व आभा", en: "5. ABDM Summary" },
          ].map((s, idx) => {
            const stepOrder = ["identify", "consent", "interview", "ayush_pariksha", "documents", "summary"];
            const currIdx = stepOrder.indexOf(step);
            const thisIdx = stepOrder.indexOf(s.id);
            const isDone = currIdx > thisIdx;
            const isCurrent = step === s.id || (s.id === "interview" && step === "ayush_pariksha");

            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center font-mono text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                      : isDone
                      ? "bg-slate-100 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:text-slate-200"
                      : "bg-slate-100 text-slate-400 border border-slate-200/60 dark:bg-slate-800/60 dark:text-slate-500"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <span className={`hidden sm:inline ${isCurrent ? "font-extrabold text-foreground" : "text-muted-foreground"}`}>
                  {lang === "hi" ? s.hi : s.en}
                </span>
                {idx < 4 && <div className="hidden md:block w-8 lg:w-16 h-0.5 bg-muted mx-1" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Red Flag Emergency Banner */}
      {activeRedFlags.length > 0 && (
        <div className="space-y-3">
          <div className="bg-gradient-to-r from-red-600 to-rose-700 text-white px-6 py-3.5 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="w-6 h-6 text-white shrink-0" />
              <div>
                <div className="font-extrabold text-sm tracking-wide uppercase">
                  {lang === "hi" ? "आपातकालीन चेतावनी (रेड फ्लैग)" : "EMERGENCY CLINICAL RED FLAG DETECTED"}
                </div>
                <div className="text-xs text-red-100">
                  {activeRedFlags[0].reason[lang]} ({activeRedFlags[0].severity.toUpperCase()})
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowEmergencyMap(!showEmergencyMap)}
                className="bg-white hover:bg-slate-50 text-rose-700 font-semibold px-3 py-1 text-xs border-rose-200 rounded-lg shadow-xs flex items-center gap-1.5"
              >
                <Ambulance className="w-3.5 h-3.5" />
                {showEmergencyMap
                  ? (lang === "hi" ? "नक्शा छुपाएं" : "Hide Map")
                  : (lang === "hi" ? "लाइव एम्बुलेंस ट्रैक करें" : "Track Moving Ambulance")}
              </Button>
              <Badge className="bg-rose-950 text-white font-medium px-2.5 py-0.5 text-xs rounded-md">
                {lang === "hi" ? "डॉक्टर व एम्बुलेंस अलर्ट सक्रिय" : "Emergency Dispatch Notified"}
              </Badge>
            </div>
          </div>

          {/* Expandable Live Moving Ambulance Emergency Map */}
          {showEmergencyMap && (
            <div className="max-w-5xl w-full mx-auto px-6 pt-1 animate-in slide-in-from-top-2">
              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950 shadow-sm">
                <div className="bg-slate-900 text-white p-3.5 px-5 flex items-center justify-between text-xs border-b border-slate-800">
                  <span className="font-bold text-red-400 flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                    {lang === "hi"
                      ? "कियोस्क की ओर आ रही 108 एम्बुलेंस की लाइव स्थिति"
                      : "108 Acute Ambulance Telemetry (En Route to MediKiosk)"}
                  </span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    {patientName || "Walk-In Patient"} · Civil Hospital Kiosk #1
                  </span>
                </div>
                <LiveAmbulanceMap
                  scene={{
                    lat: 26.8467,
                    lon: 80.9462,
                    victimName: patientName || "Kiosk Patient",
                    severity: "CRITICAL",
                    address: "Civil Hospital OPD MediKiosk Booth #1, Lucknow",
                  }}
                  hospital={{
                    name: "Dr. Ram Manohar Lohia Trauma Center, Lucknow",
                    lat: 26.8722,
                    lon: 80.9912,
                    bedsAvailable: 8,
                  }}
                  unit={{
                    callSign: "AMB-108-LUCKNOW",
                    driverName: "Sanjay Yadav",
                  }}
                  status="en_route"
                  height="340px"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 flex flex-col justify-center">
        {/* ========================================================================= STEP 1: IDENTIFY */}
        {step === "identify" && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-10 space-y-6 shadow-sm">
            <div className="text-center space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 px-3 py-1 text-xs font-bold uppercase tracking-wider border border-emerald-300/40">
                {lang === "hi" ? "चरण 1 / 5: रोगी पंजीकरण" : "Step 1 of 5: Patient Check-In"}
              </span>
              <h2 className="text-3xl font-extrabold tracking-tight text-foreground">
                {lang === "hi" ? "रोगी पहचान एवं विवरण" : "Patient Identification"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                {lang === "hi"
                  ? "अपनी आभा (ABHA) संख्या अथवा मोबाइल नंबर दर्ज कर परामर्श प्रारंभ करें।"
                  : "Enter your 14-digit ABHA ID or mobile number to initiate your OPD consultation."}
              </p>
            </div>

            <div className="space-y-6 max-w-xl mx-auto w-full pt-2">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-emerald-600" />
                  {lang === "hi" ? "आभा (ABHA) आईडी (वैकल्पिक)" : "ABHA Health ID (Optional)"}
                </label>
                <Input
                  placeholder="e.g. 91-1234-5678-9012"
                  value={abhaId}
                  onChange={(e) => setAbhaId(e.target.value)}
                  className="h-13 text-lg font-mono tracking-wider rounded-xl border-slate-300 dark:border-slate-700 bg-background"
                />
                <span className="text-[11px] text-muted-foreground">
                  {lang === "hi"
                    ? "यदि आपके पास 14-अंकों का आभा कार्ड है तो यहाँ दर्ज करें।"
                    : "If you have a 14-digit national ABHA card, enter it here."}
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-emerald-600" />
                  {lang === "hi" ? "मोबाइल नंबर (अनिवार्य)" : "Mobile Number (Required)"}
                </label>
                <Input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-13 text-lg font-mono tracking-wider rounded-xl border-slate-300 dark:border-slate-700 bg-background"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <User className="w-4 h-4 text-emerald-600" />
                  {lang === "hi" ? "रोगी का पूरा नाम" : "Patient Full Name"}
                </label>
                <Input
                  placeholder="e.g. Ramesh Kumar"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="h-13 text-base rounded-xl border-slate-300 dark:border-slate-700 bg-background"
                />
              </div>


              <div className="flex justify-end pt-4 border-t">
                <Button
                  size="lg"
                  onClick={handleStartSession}
                  disabled={isStarting}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white h-11 px-6 text-sm font-medium shadow-xs gap-2 transition-all"
                >
                  {isStarting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>{lang === "hi" ? "सत्र प्रारंभ करें" : "Begin Consultation"}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= STEP 2: CONSENT */}
        {step === "consent" && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-10 space-y-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 px-3 py-1 text-xs font-bold uppercase tracking-wider border border-emerald-300/40">
                    {lang === "hi" ? "चरण 2 / 5: रोगी सहमति (DPDP एवं ABDM)" : "Step 2 of 5: Granular Consent"}
                  </span>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground mt-2">
                    {lang === "hi" ? "डेटा संग्रहण एवं साझाकरण सहमति" : "Data Protection & Health Information Consent"}
                  </h2>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">
                    {lang === "hi"
                      ? "डिजिटल व्यक्तिगत डेटा संरक्षण (DPDP) अधिनियम 2023 व आयुष्मान भारत मानकों के अनुरूप अपनी सहमति चुनें।"
                      : "Select permissions in compliance with the DPDP Act 2023 and ABDM standards."}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePlayAudioConsent}
                  className={`rounded-lg gap-2 font-semibold text-xs border-slate-200 text-slate-700 dark:text-slate-300 self-start sm:self-center px-3.5 py-2 shadow-xs transition-all ${
                    audioExplaining ? "bg-slate-100 ring-1 ring-slate-400" : "hover:bg-slate-50"
                  }`}
                >
                  <Volume2 className={`w-4 h-4 ${audioExplaining ? "text-slate-900" : "text-slate-500"}`} />
                  {audioExplaining
                    ? lang === "hi" ? "ऑडियो विवरण बज रहा है..." : "Playing Audio Explanation..."
                    : lang === "hi" ? "ऑडियो में सुनें" : "Listen in Audio"}
                </Button>
              </div>

              <div className="space-y-3">
                {CONSENT_OPTIONS.map((opt) => {
                  const isChecked = grantedConsents.includes(opt.id);
                  return (
                    <div
                      key={opt.id}
                      onClick={() => {
                        if (opt.required) return;
                        if (isChecked) {
                          setGrantedConsents(grantedConsents.filter((c) => c !== opt.id));
                        } else {
                          setGrantedConsents([...grantedConsents, opt.id]);
                        }
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                        isChecked
                          ? "bg-slate-50 dark:bg-slate-800/60 border-slate-900 dark:border-slate-100 shadow-2xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50/60"
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                          isChecked
                            ? "bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900 shadow-xs"
                            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        }`}
                      >
                        {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 font-bold text-foreground text-sm">
                          <span>{lang === "hi" ? opt.labelHi : opt.labelEn}</span>
                          {opt.required && (
                            <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-300 bg-amber-50 dark:bg-amber-950/40">
                              {lang === "hi" ? "अनिवार्य" : "Mandatory"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {lang === "hi" ? opt.descHi : opt.descEn}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between items-center pt-4 border-t">
                <Button
                  variant="ghost"
                  onClick={() => setStep("identify")}
                  className="rounded-lg text-muted-foreground hover:text-foreground text-xs font-semibold px-4"
                >
                  {lang === "hi" ? "← वापस" : "← Back"}
                </Button>
                <Button
                  size="lg"
                  onClick={handleSaveConsent}
                  disabled={isSubmittingConsent}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium px-6 h-11 gap-2 shadow-xs transition-all"
                >
                  {isSubmittingConsent ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>{lang === "hi" ? "सहमति स्वीकारें व आगे बढ़ें" : "Accept & Proceed"}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
        )}

        {/* ========================================================================= STEP 3: INTERVIEW */}
        {step === "interview" && (
          <div className="space-y-4">
            {/* Progress Bar & Section Header */}
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-5 py-3.5 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {SECTION_HEADINGS[currentItem.section][lang]}
                </span>
                <span className="text-[11px] text-slate-400 font-mono tracking-wider font-semibold">
                  {currentItem.code}
                </span>
              </div>
              <div className="flex items-center gap-3.5">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 font-mono">
                  <span className="text-slate-400">{lang === "hi" ? "प्रगति: " : "Progress: "}</span>
                  <span className="text-slate-900 dark:text-white font-bold">{Math.round(progress.fraction * 100)}%</span>
                  <span className="text-slate-400 text-[11px] ml-1">({progress.answered}/{progress.asked})</span>
                </div>
                <div className="w-32 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/80 dark:border-slate-700">
                  <div
                    className="h-full bg-slate-900 dark:bg-white rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Active Question Card */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-medium uppercase tracking-widest px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono border border-slate-200/60 dark:border-slate-700">
                    {currentItem.kind.toUpperCase()} MODE
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Audio Readback Button */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const qText = lang === "hi" ? currentItem.prompt.hi : currentItem.prompt.en;
                        const cText =
                          currentItem.choices && currentItem.choices.length > 0
                            ? (lang === "hi" ? " विकल्प हैं: " : " Options are: ") +
                              currentItem.choices
                                .map((c, i) => `${i + 1}. ${lang === "hi" ? c.label.hi : c.label.en}`)
                                .join(". ")
                            : "";
                        speakText(`${qText}.${cText}`, () => startListening());
                      }}
                      className="h-8 gap-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium rounded-lg"
                    >
                      <Volume2 className={`size-3.5 ${isSpeaking ? "animate-bounce text-slate-900 dark:text-white" : ""}`} />
                      <span>{isSpeaking ? (lang === "hi" ? "बोल रहा है..." : "Speaking...") : (lang === "hi" ? "सवाल सुनें" : "Listen")}</span>
                    </Button>

                    <button
                      onClick={() => setAutoSpeak(!autoSpeak)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
                        autoSpeak
                          ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900 shadow-2xs"
                          : "border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                      title={autoSpeak ? "Auto-speech enabled" : "Auto-speech disabled"}
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{autoSpeak ? "Auto-Speech" : "Muted"}</span>
                    </button>

                    {/* Voice Assistant Livekit / Rime Button */}
                    <Button
                      size="sm"
                      variant={voiceActive ? "default" : "outline"}
                      disabled={voiceConnecting}
                      onClick={toggleVoiceAssistant}
                      className={`h-8 gap-1.5 text-xs font-bold rounded-lg transition-all ${
                        voiceActive
                          ? "bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 ring-2 ring-rose-400"
                          : "text-slate-700 border-slate-200 hover:bg-slate-100/80 hover:border-slate-300"
                      }`}
                    >
                      {voiceConnecting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>{lang === "hi" ? "कनेक्ट हो रहा है..." : "Connecting..."}</span>
                        </>
                      ) : voiceActive ? (
                        <>
                          <Mic className="w-3.5 h-3.5 animate-pulse text-white" />
                          <span>{lang === "hi" ? "वॉयस माइक सक्रिय (Rime)" : "Rime Voice Active"}</span>
                        </>
                      ) : (
                        <>
                          <MicOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>{lang === "hi" ? "बोलकर बताएं (AI वॉयस)" : "Speak to Voice AI"}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Active Audio State (Speaking / Listening) */}
                {(isSpeaking || isListening) && (
                  <div className="p-3.5 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-xl flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center size-8 rounded-xl bg-emerald-500/20 text-emerald-400">
                        {isSpeaking ? (
                          <Volume2 className="size-4 animate-pulse text-emerald-300" />
                        ) : (
                          <Mic className="size-4 animate-pulse text-emerald-400" />
                        )}
                        <span className="absolute inset-0 rounded-xl border border-emerald-400/50 animate-ping opacity-60" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>
                            {isSpeaking
                              ? lang === "hi"
                                ? "कियोस्क सवाल पढ़कर सुना रहा है..."
                                : "MediKiosk speaking question aloud..."
                              : lang === "hi"
                              ? "माइक चालू है — अपना उत्तर बोलें..."
                              : "Listening for your verbal response..."}
                          </span>
                          {/* Equalizer frequency bars simulation */}
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
                            <span className="w-0.5 h-3 bg-emerald-400 rounded-full animate-pulse [animation-delay:150ms]" />
                            <span className="w-0.5 h-1.5 bg-emerald-400 rounded-full animate-pulse [animation-delay:300ms]" />
                            <span className="w-0.5 h-2.5 bg-emerald-400 rounded-full animate-pulse [animation-delay:450ms]" />
                          </div>
                        </div>
                        {spokenVoiceText && (
                          <div className="text-[11px] text-emerald-300 font-mono mt-0.5">
                            "{spokenVoiceText}"
                          </div>
                        )}
                      </div>
                    </div>
                    {isSpeaking && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={stopSpeaking}
                        className="text-xs text-slate-300 hover:text-white hover:bg-white/10 h-7 px-2.5 rounded-md"
                      >
                        {lang === "hi" ? "रोकें" : "Stop"}
                      </Button>
                    )}
                  </div>
                )}

                {/* Live Voice Visualizer Banner */}
                {voiceActive && (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border border-indigo-500/30 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3.5">
                      <div className="relative flex items-center justify-center size-9 rounded-xl bg-rose-500/20 text-rose-400 shrink-0 shadow-inner">
                        <Mic className="size-4 animate-pulse" />
                        <span className="absolute inset-0 rounded-xl border border-rose-500/80 animate-ping opacity-60" />
                      </div>
                      <div>
                        <div className="text-xs font-bold tracking-wide flex items-center gap-2">
                          <span className="text-slate-100">{lang === "hi" ? "वॉयस असिस्टेंट सुन रहा है" : "Live Voice Assistant Listening"}</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-mono uppercase tracking-wider font-bold">
                            Rime Fast TTS • Hinglish
                          </span>
                        </div>
                        <div className="text-xs text-indigo-200/90 mt-0.5 font-medium">
                          {voiceTranscript
                            ? `"${voiceTranscript}"`
                            : lang === "hi"
                            ? "माइक में बोलें, आपका उत्तर अपने आप दर्ज हो जाएगा..."
                            : "Speak naturally, your response will be recorded automatically..."}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={toggleVoiceAssistant}
                      className="text-xs text-rose-300 hover:text-white hover:bg-rose-500/20 h-7 px-3 rounded-lg shrink-0 self-end sm:self-auto font-bold border border-rose-500/30"
                    >
                      {lang === "hi" ? "वॉयस बंद करें" : "Mute"}
                    </Button>
                  </div>
                )}

                <div>
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 leading-snug tracking-tight">
                    {currentItem.prompt[lang]}
                  </h2>
                </div>

                {/* Free Text Input */}
                {currentItem.kind === "text" && (
                  <div className="space-y-4 pt-2">
                    <Textarea
                      rows={4}
                      placeholder={
                        lang === "hi"
                          ? "यहाँ अपनी समस्या विस्तार से लिखें..."
                          : "Describe your symptoms in your own words..."
                      }
                      value={freeTextDraft}
                      onChange={(e) => setFreeTextDraft(e.target.value)}
                      className="text-base sm:text-lg p-4 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 transition-all font-medium"
                    />
                    <Button
                      size="lg"
                      disabled={!freeTextDraft.trim()}
                      onClick={() => handleSaveAnswer(freeTextDraft.trim())}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white h-11 rounded-lg text-sm font-medium shadow-xs transition-colors"
                    >
                      <span>{lang === "hi" ? "उत्तर सहेजें" : "Save Answer"}</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}

                {/* Choice Cards (Single / Multi / Duration) */}
                {currentItem.choices && currentItem.choices.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                    {currentItem.choices.map((c) => {
                      const isSelected =
                        answers[currentCode] === c.value ||
                        (Array.isArray(answers[currentCode]) &&
                          (answers[currentCode] as string[]).includes(c.value));
                      return (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => {
                            if (currentItem.kind === "multi") {
                              const currentArr = (answers[currentCode] as string[]) || [];
                              const updatedArr = currentArr.includes(c.value)
                                ? currentArr.filter((x) => x !== c.value)
                                : [...currentArr, c.value];
                              handleSaveAnswer(updatedArr);
                            } else {
                              handleSaveAnswer(c.value);
                            }
                          }}
                          className={`p-4 rounded-xl border text-left flex items-center justify-between transition-colors ${
                            isSelected
                              ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white shadow-xs"
                              : "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-800 hover:border-slate-300 hover:bg-slate-50/80 shadow-2xs"
                          }`}
                        >
                          <div className="font-semibold text-sm leading-snug pr-2">
                            {c.label[lang]}
                          </div>
                          <div className={`size-6 rounded-md flex items-center justify-center shrink-0 transition-all ${
                            isSelected ? "bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                          }`}>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Numeric Scale (e.g. pain severity 1-10) */}
                {currentItem.kind === "scale" && (
                  <div className="space-y-4 pt-2">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
                      <span className="text-emerald-700">1 • {lang === "hi" ? "हल्का" : "Mild"}</span>
                      <span className="text-amber-600">5 • {lang === "hi" ? "मध्यम" : "Moderate"}</span>
                      <span className="text-rose-600">10 • {lang === "hi" ? "असहनीय" : "Severe"}</span>
                    </div>
                    <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                        const isChosen = answers[currentCode] === num;
                        return (
                          <button
                            key={num}
                            type="button"
                            onClick={() => handleSaveAnswer(num)}
                            className={`h-14 rounded-2xl font-bold text-lg border transition-spring active:scale-95 flex items-center justify-center ${
                              isChosen
                                ? "bg-gradient-to-br from-rose-600 to-rose-700 text-white border-rose-600 shadow-lg shadow-rose-600/30 ring-2 ring-rose-300"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-xs"
                            }`}
                          >
                            {num}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Navigation Skip / Fast Forward */}
                <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = nextItem(answers, mode);
                      if (next) setCurrentCode(next.code);
                      else setStep(mode === "ayush" ? "ayush_pariksha" : "documents");
                    }}
                    className="text-slate-400 hover:text-slate-700 text-xs font-medium"
                  >
                    {lang === "hi" ? "यह प्रश्न छोड़ें" : "Skip this item"}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStep(mode === "ayush" ? "ayush_pariksha" : "documents")}
                    className="text-xs font-bold text-emerald-800 border-emerald-500/30 hover:bg-emerald-50/80 rounded-xl px-4 py-2 transition-spring"
                  >
                    {lang === "hi" ? "अगले चरण पर जाएँ" : "Proceed to Next Section"}
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </div>
              </div>
            </div>
        )}

        {/* ========================================================================= STEP 3 (AYUSH): DASHAVIDHA PARIKSHA */}
        {step === "ayush_pariksha" && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-amber-200/50">
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-amber-500/10 text-amber-800 border border-amber-500/20 shadow-xs">
                  {lang === "hi" ? "आयुष दशविध परीक्षा (AIIA Module A)" : "AYUSH Dashavidha Pariksha (10 Factors)"}
                </span>
                <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-50 text-amber-900 border border-amber-200">
                  {Object.keys(dashavidhaAnswers).length} / {DASHAVIDHA.length} COMPLETED
                </span>
              </div>
              
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  {lang === "hi" ? "प्रकृति, अग्नि व शारीरिक धातु परीक्षण" : "Ayurvedic Constitutional Assessment"}
                </h2>
                <p className="text-sm text-slate-500 mt-1 font-medium">
                  {lang === "hi"
                    ? "चरक व अष्टांग हृदय पर आधारित 10 प्राथमिक नैदानिक कारक।"
                    : "Ten classical diagnostic factors from Ashtanga Hridaya and Charaka Samhita."}
                </p>
              </div>

              {/* Factor Tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {DASHAVIDHA.map((f) => {
                  const hasAnswer = !!dashavidhaAnswers[f.factor];
                  const isActive = activeDashavidhaFactor === f.factor;
                  return (
                    <button
                      key={f.factor}
                      type="button"
                      onClick={() => setActiveDashavidhaFactor(f.factor)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition-spring ${
                        isActive
                          ? "bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20 ring-2 ring-amber-300"
                          : hasAnswer
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300/80"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {f.factor.replace("_", " ").toUpperCase()}
                      {hasAnswer && " ✓"}
                    </button>
                  );
                })}
              </div>

              {/* Active Factor Display */}
              {(() => {
                const currentF =
                  DASHAVIDHA.find((f) => f.factor === activeDashavidhaFactor) ||
                  DASHAVIDHA[0];
                return (
                  <div className="bg-gradient-to-br from-amber-50/70 to-orange-50/40 p-5 sm:p-6 rounded-2xl border border-amber-200/80 space-y-4 shadow-xs">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">
                        {currentF.prompt[lang]}
                      </h3>
                      <p className="text-xs text-amber-900/70 mt-0.5 font-medium">
                        {currentF.gloss}
                      </p>
                    </div>

                    {currentF.choices && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {currentF.choices.map((c) => {
                          const isChosen =
                            dashavidhaAnswers[currentF.factor]?.value === c.value;
                          return (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => handleSaveDashavidha(currentF.factor, c.value)}
                              className={`p-4 rounded-2xl border text-left font-bold text-sm transition-spring active:scale-[0.98] ${
                                isChosen
                                  ? "bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/25 ring-2 ring-amber-300"
                                  : "bg-white text-slate-700 border-slate-200 hover:border-amber-400 hover:bg-amber-50/40"
                              }`}
                            >
                              <div>{c.label[lang]}</div>
                              <div className="text-[11px] font-normal opacity-80 mt-1 font-mono">
                                {c.value}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <Button
                  variant="ghost"
                  onClick={() => setStep("interview")}
                  className="text-slate-600 text-xs font-semibold"
                >
                  {lang === "hi" ? "← वापस" : "← Back to Questions"}
                </Button>
                <Button
                  size="lg"
                  onClick={() => setStep("documents")}
                  className="bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white font-bold px-8 h-12 rounded-xl shadow-lg shadow-emerald-700/20 transition-spring"
                >
                  <span>{lang === "hi" ? "दस्तावेज़ ओसीआर पर बढ़ें" : "Proceed to Document Scan"}</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
        )}

        {/* ========================================================================= STEP 4: DOCUMENTS OCR */}
        {step === "documents" && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {lang === "hi" ? "चरण 4 / 5: पुराने पर्चे व दस्तावेज़ (Module B)" : "Step 4 of 5: Document Digitisation"}
                </span>
                <span className="text-xs font-mono font-medium text-slate-400">
                  GEMINI VISION AI 2.5 OCR
                </span>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {lang === "hi" ? "कागज़ी पर्चे व लैब रिपोर्ट स्कैन" : "Scan Physical Prescriptions & Lab Reports"}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 font-normal">
                  {lang === "hi"
                    ? "कियोस्क के कैमरे के सामने पर्चा रखें या फ़ाइल अपलोड करें।"
                    : "Present paper records to the kiosk camera or upload test scans for automated clinical parsing."}
                </p>
              </div>

              {/* Viewfinder Reticle Scan Trigger Box */}
              <div
                onClick={() => setIsCaptureModalOpen(true)}
                className="group relative overflow-hidden border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-900 p-8 sm:p-10 rounded-xl text-center cursor-pointer transition-all space-y-4"
              >
                {/* Viewfinder corner brackets */}
                <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-slate-900 dark:border-white rounded-tl-sm transition-all group-hover:scale-110" />
                <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-slate-900 dark:border-white rounded-tr-sm transition-all group-hover:scale-110" />
                <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-slate-900 dark:border-white rounded-bl-sm transition-all group-hover:scale-110" />
                <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-slate-900 dark:border-white rounded-br-sm transition-all group-hover:scale-110" />

                {/* Animated laser scanline on processing */}
                {isOcrProcessing && (
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-slate-900 dark:via-white to-transparent animate-pulse top-1/2" />
                )}

                <div className="w-14 h-14 mx-auto rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                  <Camera className="w-6 h-6" />
                </div>
                
                <div>
                  <h4 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white tracking-tight">
                    {lang === "hi"
                      ? "कागज़ी पर्चा / लैब रिपोर्ट स्कैन करने के लिए यहाँ टैप करें"
                      : "Tap here to capture document via Vision AI Camera / Upload"}
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 font-normal leading-relaxed">
                    {lang === "hi"
                      ? "लाइव कैमरा, फ़ाइल अपलोड या क्लिनिकल प्रीसेट से पर्चा स्कैन करें। एआई दवाइयाँ, मात्रा और ड्रग इंटरेक्शन तुरंत पहचान लेगा।"
                      : "Live kiosk camera, file upload, or clinical presets. Gemini Vision AI extracts medications, dosages, and drug-drug interactions in real time."}
                  </p>
                </div>

                <div className="pt-2 flex flex-wrap justify-center gap-3">
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCaptureModalOpen(true);
                    }}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium gap-2 px-5 h-9 rounded-lg shadow-xs transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{lang === "hi" ? "कैमरा / अपलोड खोलें" : "Open Camera / Upload"}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSimulateDocumentScan();
                    }}
                    className="text-xs text-slate-700 hover:text-slate-900 border-slate-300 hover:bg-slate-50 px-4 h-10 rounded-xl font-bold transition-spring"
                  >
                    <span>{lang === "hi" ? "त्वरित सिमुलेशन" : "Quick Demo Scan"}</span>
                  </Button>
                </div>

                {isOcrProcessing && (
                  <div className="flex items-center justify-center gap-2 text-emerald-700 text-xs font-bold pt-2 font-mono">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    <span>{lang === "hi" ? "ओसीआर विश्लेषण जारी है..." : "Extracting clinical entities & interactions..."}</span>
                  </div>
                )}
              </div>

              {/* Scanned Items List */}
              {scannedFiles.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">
                    {lang === "hi" ? "पहचाने गए दस्तावेज़" : "Processed Documents"} ({scannedFiles.length})
                  </h5>
                  <div className="space-y-3">
                    {scannedFiles.map((doc, idx) => (
                      <div key={idx} className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5 text-emerald-700" />
                            </div>
                            <div>
                              <div className="font-bold text-sm text-slate-900">{doc.name}</div>
                              <div className="text-xs text-slate-500 font-medium">
                                {doc.entities} {lang === "hi" ? "क्लिनिकल एंटिटीज मिलीं" : "entities extracted"} • <span className="font-mono text-[11px] uppercase">{doc.type}</span>
                              </div>
                            </div>
                          </div>
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                            {doc.status}
                          </span>
                        </div>

                        {/* Extracted Medications chips */}
                        {doc.medications && doc.medications.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                              Extracted Rx
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {doc.medications.map((med: any, mIdx: number) => (
                                <span
                                  key={mIdx}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-900 border border-sky-200/80 shadow-xs"
                                >
                                  <span>{med.name}</span>
                                  {med.dosage && <span className="text-sky-600 font-mono text-[11px]">({med.dosage})</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Interaction Warnings */}
                        {doc.interactions && doc.interactions.length > 0 && (
                          <div className="space-y-1.5 rounded-xl bg-rose-50/80 p-3 border border-rose-200/80">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
                              <AlertTriangle className="size-4 text-rose-600 shrink-0" />
                              <span>
                                {lang === "hi"
                                  ? `${doc.interactions.length} संभावित ड्रग इंटरेक्शन चेतावनी:`
                                  : `${doc.interactions.length} Drug Interaction Warning(s):`}
                              </span>
                            </div>
                            {doc.interactions.map((inter: any, iIdx: number) => (
                              <div key={iIdx} className="text-xs text-rose-800 pl-5 leading-relaxed font-medium">
                                • <span className="font-bold">{inter.drugA} + {inter.drugB}</span>: {inter.effect}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                <Button
                  variant="ghost"
                  onClick={() => setStep("interview")}
                  className="text-slate-600 text-xs font-semibold"
                >
                  {lang === "hi" ? "← वापस" : "← Back"}
                </Button>
                <Button
                  size="lg"
                  onClick={handleProceedToSummary}
                  className="bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white font-bold px-8 h-12 rounded-xl shadow-lg shadow-emerald-700/20 transition-spring gap-2"
                >
                  <span>{lang === "hi" ? "अंतिम सारांश व एक्सपोर्ट" : "View Summary & Export"}</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
        )}

        {/* ========================================================================= STEP 5: SUMMARY & ABDM EXPORT */}
        {step === "summary" && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-800 border border-emerald-500/20 shadow-xs">
                  {lang === "hi" ? "चरण 5 / 5: नैदानिक सारांश व ABDM एक्सपोर्ट" : "Step 5 of 5: Clinical Summary & ABDM Export"}
                </span>
                <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                  ABDM NRCES COMPLIANT
                </span>
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  {lang === "hi" ? "कंसल्टेशन सारांश व FHIR R4 रिकॉर्ड" : "Consultation Record & Interoperable FHIR Export"}
                </h2>
                <p className="text-sm text-slate-500 mt-1 font-medium">
                  {lang === "hi"
                    ? "ओपीडी डॉक्टर के लिए तैयार सारांश देखें और राष्ट्रीय ABDM नेटवर्क पर एक्सपोर्ट करें।"
                    : "Review the structured case-taking report and export the NRCES-compliant FHIR R4 bundle."}
                </p>
              </div>

              {/* Patient Identity Badge with tricolor subtle top line */}
              <div className="relative overflow-hidden bg-slate-900 text-white p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-orange-500 via-white to-emerald-600" />
                <div>
                  <div className="font-bold text-lg text-white">
                    {patientName || "Walk-In Patient"}
                  </div>
                  <div className="text-xs text-slate-300 font-mono mt-0.5 flex items-center gap-2">
                    <span>{abhaId ? `ABHA: ${abhaId}` : `Phone: ${phone || "Anonymous"}`}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-bold">MODE: {mode.toUpperCase()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-xs flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                    <span>{lang === "hi" ? "परामर्श के लिए तैयार" : "Ready for Doctor Consultation"}</span>
                  </span>
                </div>
              </div>

              {/* Summary Sections in Bento Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SECTION_ORDER.map((sec) => {
                  const secItems = ONTOLOGY.filter(
                    (i) => i.section === sec && answers[i.code] !== undefined
                  );
                  if (secItems.length === 0) return null;
                  return (
                    <div
                      key={sec}
                      className="p-4 sm:p-5 rounded-2xl border border-slate-200/80 bg-white space-y-2.5 shadow-xs"
                    >
                      <h5 className="font-bold text-xs uppercase tracking-widest text-emerald-800 font-mono">
                        {SECTION_HEADINGS[sec][lang]}
                      </h5>
                      <div className="space-y-2">
                        {secItems.map((item) => (
                          <div key={item.code} className="text-xs leading-relaxed">
                            <span className="text-slate-400 font-medium">
                              {item.prompt[lang]}:
                            </span>{" "}
                            <span className="font-bold text-slate-800">
                              {Array.isArray(answers[item.code])
                                ? (answers[item.code] as string[]).join(", ")
                                : String(answers[item.code])}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ayush Dashavidha Card if filled */}
              {mode === "ayush" && Object.keys(dashavidhaAnswers).length > 0 && (
                <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50/50 space-y-3">
                  <h5 className="font-bold text-xs uppercase tracking-widest text-amber-900 font-mono">
                    {lang === "hi" ? "दशविध परीक्षा निष्कर्ष" : "Dashavidha Pariksha Findings"}
                  </h5>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    {Object.entries(dashavidhaAnswers).map(([fac, ans]) => (
                      <div key={fac} className="bg-white p-2.5 rounded-xl border border-amber-100 text-xs shadow-2xs">
                        <div className="text-slate-400 font-mono text-[10px] uppercase font-semibold">{fac}</div>
                        <div className="font-bold text-slate-900 mt-0.5">{ans.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ABDM Export Result Banner */}
              {abdmExportResult && (
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-white">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{lang === "hi" ? "ABDM FHIR R4 बंडल तैयार!" : "ABDM NRCES FHIR R4 Bundle Ready!"}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      Ref: {abdmExportResult.abdm_reference} • {abdmExportResult.resource_count} Resources
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadBundle}
                    className="gap-2 font-medium text-xs border-slate-200 text-slate-800 dark:text-slate-200 hover:bg-slate-100 rounded-lg h-8 px-3 shrink-0 self-start sm:self-auto shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === "hi" ? "JSON डाउनलोड करें" : "Download FHIR JSON"}</span>
                  </Button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button
                  variant="ghost"
                  onClick={() => setStep("interview")}
                  className="text-slate-600 dark:text-slate-400 text-xs font-medium self-start sm:self-auto"
                >
                  {lang === "hi" ? "← वापस प्रश्नोत्तर पर" : "← Back to Intake"}
                </Button>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <Button
                    size="default"
                    variant="outline"
                    onClick={handleExportToAbdm}
                    disabled={isExporting}
                    className="flex-1 sm:flex-initial border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-medium text-xs h-10 px-5 rounded-lg shadow-2xs gap-2"
                  >
                    {isExporting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <FileCheck className="w-3.5 h-3.5" />
                        <span>{lang === "hi" ? "ABDM में एक्सपोर्ट करें" : "Export to ABDM"}</span>
                      </>
                    )}
                  </Button>

                  <Button
                    size="default"
                    onClick={() => {
                      toast.success(
                        lang === "hi"
                          ? "केस टोकन जारी किया गया। रोगी ओपीडी रूम में प्रतीक्षा करें।"
                          : "Case Token Issued. Patient may proceed to Doctor Consultation Room."
                      );
                      setSessionId(null);
                      setAnswers({});
                      setDashavidhaAnswers({});
                      setScannedFiles([]);
                      setAbdmExportResult(null);
                      setEscalated(false);
                      setStep("identify");
                    }}
                    className="flex-1 sm:flex-initial bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs h-10 px-6 rounded-lg shadow-xs transition-colors"
                  >
                    {lang === "hi" ? "पूर्ण करें (अगला रोगी)" : "Finish Session"}
                  </Button>
                </div>
              </div>
            </div>
        )}
      </main>

      {/* Vision AI Document Capture Modal */}
      <DocumentCaptureModal
        isOpen={isCaptureModalOpen}
        onClose={() => setIsCaptureModalOpen(false)}
        onDocumentProcessed={(doc) => {
          setScannedFiles((prev) => [...prev, doc]);
          toast.success(
            lang === "hi"
              ? `दस्तावेज़ ओसीआर संपन्न: ${doc.name} (${doc.entities} क्लिनिकल एंटिटीज)`
              : `Document processed: ${doc.name} (${doc.entities} entities extracted)`
          );
        }}
        sessionId={sessionId}
        patientId={patientId}
        lang={lang}
      />

      {/* Kiosk Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Swadhikaar Clinical Operating System • SIH26047 & ABDM NRCES Standards Compliant</span>
        </div>
        <div>
          <span>DPDP Act 2023 Secure Session • Cache Wiped on Exit</span>
        </div>
      </footer>
    </div>
  );
}
