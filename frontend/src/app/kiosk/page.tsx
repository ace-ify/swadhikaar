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
  RefreshCw,
  ShieldCheck,
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
          ? `⚠️ गंभीर लक्षण (रेड फ्लैग): ${hits[0].reason.hi} - आपातकालीन अलर्ट भेजा गया!`
          : `⚠️ Critical Red Flag: ${hits[0].reason.en} - Emergency Alert Dispatched!`
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
      const resp = await callCaseSession({
        action: "start",
        name: patientName.trim() || undefined,
        phone: phone.trim() || undefined,
        abha_id: abhaId.trim() || undefined,
        language: lang === "hi" ? "hindi" : "english",
        mode,
      });

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
      await callCaseSession({
        action: "consent",
        session_id: sessionId,
        granted: grantedConsents,
        audio_explained: audioExplaining,
        audio_language: lang === "hi" ? "hindi" : "english",
      });

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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none">
      {/* Kiosk Header */}
      <header className="bg-emerald-800 text-white shadow-md border-b border-emerald-900/20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-white text-emerald-800 p-2.5 rounded-xl shadow-inner font-black text-xl tracking-wider">
            स्वाधिकार
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <span>{lang === "hi" ? "मेडीकियोस्क" : "MediKiosk"}</span>
              <Badge variant="secondary" className="bg-emerald-700/80 text-emerald-100 text-xs font-semibold uppercase tracking-wider">
                {mode === "ayush" ? "AIIA AYUSH OPD" : "Civil OPD"}
              </Badge>
            </h1>
            <p className="text-xs text-emerald-200">
              {lang === "hi"
                ? "मल्टीमॉडल केस-टेकिंग व नैदानिक इतिहास प्रणाली"
                : "Multimodal Clinical History & Triage System"}
            </p>
          </div>
        </div>

        {/* Global Controls: Language, Mode, Reset */}
        <div className="flex items-center gap-3">
          {/* Language Toggle */}
          <div className="bg-emerald-900/60 p-1 rounded-lg flex items-center">
            <Button
              size="sm"
              variant={lang === "hi" ? "default" : "ghost"}
              onClick={() => setLang("hi")}
              className={`h-8 px-3 text-xs font-bold ${
                lang === "hi"
                  ? "bg-white text-emerald-900 hover:bg-white"
                  : "text-emerald-200 hover:text-white hover:bg-emerald-800/40"
              }`}
            >
              हिन्दी
            </Button>
            <Button
              size="sm"
              variant={lang === "en" ? "default" : "ghost"}
              onClick={() => setLang("en")}
              className={`h-8 px-3 text-xs font-bold ${
                lang === "en"
                  ? "bg-white text-emerald-900 hover:bg-white"
                  : "text-emerald-200 hover:text-white hover:bg-emerald-800/40"
              }`}
            >
              English
            </Button>
          </div>

          {/* Mode Selector */}
          <div className="bg-emerald-900/60 p-1 rounded-lg flex items-center">
            <Button
              size="sm"
              variant={mode === "allopathic" ? "default" : "ghost"}
              onClick={() => setMode("allopathic")}
              className={`h-8 px-3 text-xs font-bold ${
                mode === "allopathic"
                  ? "bg-emerald-600 text-white hover:bg-emerald-600"
                  : "text-emerald-200 hover:text-white hover:bg-emerald-800/40"
              }`}
            >
              Allopathic
            </Button>
            <Button
              size="sm"
              variant={mode === "ayush" ? "default" : "ghost"}
              onClick={() => setMode("ayush")}
              className={`h-8 px-3 text-xs font-bold ${
                mode === "ayush"
                  ? "bg-amber-600 text-white hover:bg-amber-600"
                  : "text-emerald-200 hover:text-white hover:bg-emerald-800/40"
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
              className="h-8 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              {lang === "hi" ? "रीसेट" : "New Patient"}
            </Button>
          )}
        </div>
      </header>

      {/* Red Flag Emergency Banner */}
      {activeRedFlags.length > 0 && (
        <div className="space-y-3">
          <div className="bg-red-600 text-white px-6 py-3 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
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
                className="bg-white text-red-700 hover:bg-red-50 font-bold px-3 py-1 text-xs border-red-300 shadow-md"
              >
                {showEmergencyMap
                  ? lang === "hi" ? "नक्शा छुपाएं" : "Hide Map"
                  : lang === "hi" ? "लाइव एम्बुलेंस ट्रैक करें 🚑" : "Track Moving Ambulance 🚑"}
              </Button>
              <Badge className="bg-red-800 text-white font-bold px-3 py-1 text-xs">
                {lang === "hi" ? "डॉक्टर व एम्बुलेंस अलर्ट सक्रिय" : "Emergency Dispatch Notified"}
              </Badge>
            </div>
          </div>

          {/* Expandable Live Moving Ambulance Emergency Map */}
          {showEmergencyMap && (
            <div className="max-w-5xl w-full mx-auto px-6 pt-1 animate-in slide-in-from-top-2">
              <div className="rounded-2xl border-2 border-red-500 overflow-hidden shadow-2xl bg-slate-950">
                <div className="bg-slate-900 text-white p-3 px-4 flex items-center justify-between text-xs border-b border-slate-800">
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
                    {patientName || "Walk-In Patient"} · Dispur Kiosk
                  </span>
                </div>
                <LiveAmbulanceMap
                  scene={{
                    lat: 26.1445,
                    lon: 91.7362,
                    victimName: patientName || "Kiosk Patient",
                    severity: "CRITICAL",
                    address: "MediKiosk Intake Booth #1, Dispur",
                  }}
                  hospital={{
                    name: "AIIA / GMCH Emergency Trauma Center",
                    lat: 26.1554,
                    lon: 91.7745,
                    bedsAvailable: 8,
                  }}
                  unit={{
                    callSign: "AMB-108-KAMRUP",
                    driverName: "Bhaben Kalita",
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
          <Card className="shadow-xl border-slate-200">
            <CardHeader className="text-center pb-2">
              <Badge className="w-fit mx-auto mb-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border border-emerald-300">
                {lang === "hi" ? "चरण 1 / 5: रोगी पंजीकरण" : "Step 1 of 5: Patient Check-In"}
              </Badge>
              <CardTitle className="text-2xl font-bold text-slate-800">
                {lang === "hi" ? "रोगी पहचान एवं विवरण" : "Patient Identification"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {lang === "hi"
                  ? "अपनी आभा (ABHA) संख्या अथवा मोबाइल नंबर दर्ज कर परामर्श शुरू करें।"
                  : "Enter your 14-digit ABHA ID or mobile number to initiate your consultation."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 max-w-xl mx-auto w-full pt-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-emerald-600" />
                  {lang === "hi" ? "आभा (ABHA) आईडी (वैकल्पिक)" : "ABHA Health ID (Optional)"}
                </label>
                <Input
                  placeholder="e.g. 91-1234-5678-9012"
                  value={abhaId}
                  onChange={(e) => setAbhaId(e.target.value)}
                  className="h-12 text-lg font-mono tracking-wider border-slate-300"
                />
                <span className="text-xs text-slate-400">
                  {lang === "hi"
                    ? "यदि आपके पास 14-अंकों का आभा कार्ड है तो यहाँ दर्ज करें।"
                    : "If you have a 14-digit ABHA card, enter it here."}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <Separator className="flex-1" />
                <span className="text-xs uppercase text-slate-400 font-bold">
                  {lang === "hi" ? "अथवा" : "OR"}
                </span>
                <Separator className="flex-1" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {lang === "hi" ? "रोगी का पूरा नाम *" : "Full Name *"}
                  </label>
                  <Input
                    placeholder={lang === "hi" ? "जैसे: राम कुमार" : "e.g. Ram Kumar"}
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="h-12 border-slate-300"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {lang === "hi" ? "मोबाइल नंबर *" : "Mobile Phone *"}
                  </label>
                  <Input
                    placeholder="e.g. 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-12 border-slate-300 font-mono"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end pt-4 pb-6 px-8 bg-slate-50/50 border-t border-slate-100">
              <Button
                size="lg"
                onClick={handleStartSession}
                disabled={isStarting}
                className="bg-emerald-700 hover:bg-emerald-800 text-white h-12 px-8 text-base font-bold shadow-md gap-2"
              >
                {isStarting ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>{lang === "hi" ? "सत्र प्रारंभ करें" : "Begin Consultation"}</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ========================================================================= STEP 2: CONSENT */}
        {step === "consent" && (
          <Card className="shadow-xl border-slate-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300">
                  {lang === "hi" ? "चरण 2 / 5: रोगी सहमति (DPDP एवं ABDM)" : "Step 2 of 5: Granular Consent"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePlayAudioConsent}
                  className={`gap-1.5 font-semibold text-xs border-emerald-600 text-emerald-700 ${
                    audioExplaining ? "bg-emerald-50 ring-2 ring-emerald-500" : ""
                  }`}
                >
                  <Volume2 className={`w-4 h-4 ${audioExplaining ? "animate-pulse text-emerald-600" : ""}`} />
                  {audioExplaining
                    ? lang === "hi"
                      ? "ऑडियो बज रहा है..."
                      : "Playing Audio..."
                    : lang === "hi"
                    ? "ऑडियो में सुनें"
                    : "Listen in Audio"}
                </Button>
              </div>
              <CardTitle className="text-2xl font-bold text-slate-800 mt-2">
                {lang === "hi" ? "डेटा संग्रहण एवं साझाकरण सहमति" : "Data Protection & Health Information Consent"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {lang === "hi"
                  ? "डिजिटल व्यक्तिगत डेटा संरक्षण (DPDP) अधिनियम 2023 व आयुष्मान भारत मानकों के अनुरूप अपनी सहमति चुनें।"
                  : "Select permissions in compliance with the DPDP Act 2023 and ABDM standards."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
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
                      className={`p-4 flex items-start gap-4 cursor-pointer transition-colors ${
                        isChecked ? "bg-emerald-50/40" : "hover:bg-slate-50"
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center border transition-all ${
                          isChecked
                            ? "bg-emerald-700 border-emerald-700 text-white"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {isChecked && <Check className="w-4 h-4 stroke-[3]" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                          <span>{lang === "hi" ? opt.labelHi : opt.labelEn}</span>
                          {opt.required && (
                            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                              {lang === "hi" ? "अनिवार्य" : "Mandatory"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {lang === "hi" ? opt.descHi : opt.descEn}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between items-center bg-slate-50 border-t border-slate-100 px-6 py-4">
              <Button
                variant="ghost"
                onClick={() => setStep("identify")}
                className="text-slate-600"
              >
                {lang === "hi" ? "वापस" : "Back"}
              </Button>
              <Button
                size="lg"
                onClick={handleSaveConsent}
                disabled={isSubmittingConsent}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-8 h-12 gap-2"
              >
                {isSubmittingConsent ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>{lang === "hi" ? "सहमति स्वीकारें व आगे बढ़ें" : "Accept & Continue"}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ========================================================================= STEP 3: INTERVIEW */}
        {step === "interview" && (
          <div className="space-y-4">
            {/* Progress Bar & Section Header */}
            <div className="flex items-center justify-between bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  {SECTION_HEADINGS[currentItem.section][lang]}
                </Badge>
                <span className="text-xs text-slate-400 font-mono">
                  {currentItem.code}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs font-semibold text-slate-600">
                  {lang === "hi" ? "प्रगति:" : "Progress:"}{" "}
                  {Math.round(progress.fraction * 100)}% ({progress.answered}/{progress.asked})
                </div>
                <div className="w-32 h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Active Question Card */}
            <Card className="shadow-xl border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-slate-500 text-xs">
                    {currentItem.kind.toUpperCase()}
                  </Badge>
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
                      className="h-8 gap-1.5 text-xs text-sky-700 hover:bg-sky-50 font-semibold"
                    >
                      <Volume2 className={`size-3.5 ${isSpeaking ? "animate-bounce text-sky-600" : ""}`} />
                      <span>{isSpeaking ? (lang === "hi" ? "बोल रहा है..." : "Speaking...") : (lang === "hi" ? "सवाल सुनें" : "Listen")}</span>
                    </Button>

                    <button
                      onClick={() => setAutoSpeak(!autoSpeak)}
                      className={`text-[11px] px-2 py-1 rounded border font-medium transition-colors ${
                        autoSpeak
                          ? "border-sky-400 bg-sky-50 text-sky-800"
                          : "border-slate-300 text-slate-500 hover:bg-slate-50"
                      }`}
                      title={autoSpeak ? "Auto-speech enabled" : "Auto-speech disabled"}
                    >
                      {autoSpeak ? "🔊 Auto-Speech" : "🔇 Muted"}
                    </button>

                    {/* Voice Assistant Livekit Button */}
                    <Button
                      size="sm"
                      variant={voiceActive ? "default" : "outline"}
                      disabled={voiceConnecting}
                      onClick={toggleVoiceAssistant}
                      className={`h-8 gap-1.5 text-xs font-bold transition-all ${
                        voiceActive
                          ? "bg-rose-600 hover:bg-rose-700 text-white shadow-sm ring-2 ring-rose-300"
                          : "text-slate-700 border-slate-300 hover:bg-slate-100"
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
                          <MicOff className="w-3.5 h-3.5" />
                          <span>{lang === "hi" ? "बोलकर बताएं (AI वॉयस)" : "Speak to Voice AI"}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Active Audio State (Speaking / Listening) */}
                {(isSpeaking || isListening) && (
                  <div className="mt-2 p-2.5 rounded-xl bg-sky-950 text-white border border-sky-600/40 shadow-md flex items-center justify-between gap-2 text-xs animate-in fade-in">
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex items-center justify-center size-7 rounded-full bg-sky-500/20 text-sky-300">
                        {isSpeaking ? (
                          <Volume2 className="size-3.5 animate-pulse text-sky-300" />
                        ) : (
                          <Mic className="size-3.5 animate-pulse text-emerald-400" />
                        )}
                        <span className="absolute inset-0 rounded-full border border-sky-400 animate-ping opacity-50" />
                      </div>
                      <div>
                        <div className="font-bold text-sky-200">
                          {isSpeaking
                            ? lang === "hi"
                              ? "कियोस्क सवाल पढ़कर सुना रहा है..."
                              : "MediKiosk speaking question aloud..."
                            : lang === "hi"
                            ? "माइक चालू है — अपना उत्तर बोलें..."
                            : "Listening for your response..."}
                        </div>
                        {spokenVoiceText && (
                          <div className="text-[11px] text-sky-300 font-mono">
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
                        className="text-xs text-sky-300 hover:text-white hover:bg-sky-800/50 h-7 px-2"
                      >
                        {lang === "hi" ? "रोकें" : "Stop"}
                      </Button>
                    )}
                  </div>
                )}

                {/* Live Voice Visualizer Banner */}
                {voiceActive && (
                  <div className="mt-2 p-3 rounded-xl bg-gradient-to-r from-blue-900 to-indigo-950 text-white border border-blue-400/30 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center size-8 rounded-full bg-rose-500/20 text-rose-400 shrink-0">
                        <Mic className="size-4 animate-pulse" />
                        <span className="absolute inset-0 rounded-full border border-rose-500 animate-ping opacity-60" />
                      </div>
                      <div>
                        <div className="text-xs font-bold tracking-wide flex items-center gap-2">
                          <span>{lang === "hi" ? "वॉयस असिस्टेंट सुन रहा है" : "Live Voice Assistant Listening"}</span>
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30 text-[10px] uppercase">
                            Rime Fast TTS • Hinglish
                          </Badge>
                        </div>
                        <div className="text-xs text-blue-200 mt-0.5">
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
                      className="text-xs text-rose-200 hover:text-white hover:bg-rose-500/20 h-7 px-2 shrink-0 self-end sm:self-auto"
                    >
                      {lang === "hi" ? "वॉयस बंद करें" : "Mute"}
                    </Button>
                  </div>
                )}
                <CardTitle className="text-xl md:text-2xl font-bold text-slate-800 leading-snug mt-2">
                  {currentItem.prompt[lang]}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2 pb-6">
                {/* Free Text Input */}
                {currentItem.kind === "text" && (
                  <div className="space-y-4">
                    <Textarea
                      rows={4}
                      placeholder={
                        lang === "hi"
                          ? "यहाँ अपनी समस्या विस्तार से लिखें..."
                          : "Describe your symptoms in your own words..."
                      }
                      value={freeTextDraft}
                      onChange={(e) => setFreeTextDraft(e.target.value)}
                      className="text-lg p-4 border-slate-300 focus:border-emerald-600"
                    />
                    <Button
                      size="lg"
                      disabled={!freeTextDraft.trim()}
                      onClick={() => handleSaveAnswer(freeTextDraft.trim())}
                      className="w-full bg-emerald-700 hover:bg-emerald-800 text-white h-12 text-base font-bold"
                    >
                      <span>{lang === "hi" ? "उत्तर सहेजें" : "Save Answer"}</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}

                {/* Choice Cards (Single / Multi / Duration) */}
                {currentItem.choices && currentItem.choices.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
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
                          className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.98] ${
                            isSelected
                              ? "bg-emerald-700 text-white border-emerald-700 shadow-md ring-2 ring-emerald-300"
                              : "bg-white text-slate-800 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/30"
                          }`}
                        >
                          <div className="font-bold text-base">
                            {c.label[lang]}
                          </div>
                          <ChevronRight
                            className={`w-5 h-5 ${
                              isSelected ? "text-emerald-100" : "text-slate-300"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Numeric Scale (e.g. pain severity 1-10) */}
                {currentItem.kind === "scale" && (
                  <div className="space-y-6 pt-4">
                    <div className="flex justify-between items-center text-sm font-bold text-slate-500">
                      <span>1 ({lang === "hi" ? "हल्का" : "Mild"})</span>
                      <span>5 ({lang === "hi" ? "मध्यम" : "Moderate"})</span>
                      <span>10 ({lang === "hi" ? "असहनीय" : "Severe"})</span>
                    </div>
                    <div className="grid grid-cols-10 gap-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleSaveAnswer(num)}
                          className={`h-14 rounded-xl font-bold text-lg border transition-all ${
                            answers[currentCode] === num
                              ? "bg-rose-600 text-white border-rose-600 shadow-md"
                              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>

              {/* Navigation Skip / Fast Forward */}
              <CardFooter className="flex justify-between items-center bg-slate-50 border-t border-slate-100 px-6 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = nextItem(answers, mode);
                    if (next) setCurrentCode(next.code);
                    else setStep(mode === "ayush" ? "ayush_pariksha" : "documents");
                  }}
                  className="text-slate-500 hover:text-slate-800 text-xs"
                >
                  {lang === "hi" ? "यह प्रश्न छोड़ें" : "Skip this item"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStep(mode === "ayush" ? "ayush_pariksha" : "documents")}
                  className="text-xs font-semibold text-emerald-700 border-emerald-300"
                >
                  {lang === "hi" ? "अगले चरण पर जाएँ" : "Proceed to Next Section"}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {/* ========================================================================= STEP 3 (AYUSH): DASHAVIDHA PARIKSHA */}
        {step === "ayush_pariksha" && (
          <Card className="shadow-xl border-slate-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                  {lang === "hi" ? "आयुष दशविध परीक्षा (AIIA Module A)" : "AYUSH Dashavidha Pariksha (10 Factors)"}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {Object.keys(dashavidhaAnswers).length} / {DASHAVIDHA.length}
                </Badge>
              </div>
              <CardTitle className="text-2xl font-bold text-slate-800 mt-2">
                {lang === "hi" ? "प्रकृति, अग्नि व शारीरिक धातु परीक्षण" : "Ayurvedic Constitutional Assessment"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {lang === "hi"
                  ? "चरक व अष्टांग हृदय पर आधारित 10 प्राथमिक नैदानिक कारक।"
                  : "Ten classical diagnostic factors from Ashtanga Hridaya and Charaka Samhita."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all ${
                        isActive
                          ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                          : hasAnswer
                          ? "bg-emerald-50 text-emerald-800 border-emerald-300"
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
                  <div className="bg-amber-50/50 p-5 rounded-xl border border-amber-200/80 space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">
                        {currentF.prompt[lang]}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
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
                              className={`p-4 rounded-xl border text-left font-bold text-sm transition-all ${
                                isChosen
                                  ? "bg-amber-600 text-white border-amber-600 shadow-md"
                                  : "bg-white text-slate-700 border-slate-300 hover:border-amber-400 hover:bg-amber-50/30"
                              }`}
                            >
                              <div>{c.label[lang]}</div>
                              <div className="text-[11px] font-normal opacity-80 mt-1">
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
            </CardContent>
            <CardFooter className="flex justify-between items-center bg-slate-50 border-t border-slate-100 px-6 py-4">
              <Button
                variant="ghost"
                onClick={() => setStep("interview")}
                className="text-slate-600"
              >
                {lang === "hi" ? "वापस" : "Back to Questions"}
              </Button>
              <Button
                size="lg"
                onClick={() => setStep("documents")}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-8 h-12"
              >
                <span>{lang === "hi" ? "दस्तावेज़ ओसीआर पर बढ़ें" : "Proceed to Document Scan"}</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ========================================================================= STEP 4: DOCUMENTS OCR */}
        {step === "documents" && (
          <Card className="shadow-xl border-slate-200">
            <CardHeader>
              <Badge className="w-fit bg-emerald-100 text-emerald-800 border-emerald-300">
                {lang === "hi" ? "चरण 4 / 5: पुराने पर्चे व दस्तावेज़ (Module B)" : "Step 4 of 5: Document Digitisation"}
              </Badge>
              <CardTitle className="text-2xl font-bold text-slate-800 mt-2">
                {lang === "hi" ? "कागज़ी पर्चे व लैब रिपोर्ट स्कैन" : "Scan Physical Prescriptions & Lab Reports"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {lang === "hi"
                  ? "कियोस्क के कैमरे के सामने पर्चा रखें या फ़ाइल अपलोड करें।"
                  : "Present paper records to the kiosk camera or upload test scans."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Scan Trigger Box */}
              <div
                onClick={() => setIsCaptureModalOpen(true)}
                className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/60 p-8 rounded-2xl text-center cursor-pointer transition-all space-y-3"
              >
                <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-inner">
                  <Camera className="w-7 h-7" />
                </div>
                <h4 className="font-bold text-base text-slate-800">
                  {lang === "hi"
                    ? "कागज़ी पर्चा / लैब रिपोर्ट स्कैन करने के लिए यहाँ टैप करें"
                    : "Tap here to capture document via Vision AI Camera / Upload"}
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {lang === "hi"
                    ? "लाइव कैमरा, फ़ाइल अपलोड या क्लिनिकल प्रीसेट से पर्चा स्कैन करें। एआई दवाइयाँ, मात्रा और ड्रग इंटरेक्शन तुरंत पहचान लेगा।"
                    : "Live kiosk camera, file upload, or clinical presets. Gemini Vision AI extracts medications, dosages, and drug-drug interactions in real time."}
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCaptureModalOpen(true);
                    }}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold gap-1.5 shadow-sm"
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
                    className="text-xs text-slate-600 hover:text-slate-900 border-slate-300"
                  >
                    <span>{lang === "hi" ? "त्वरित सिमुलेशन" : "Quick Demo Scan"}</span>
                  </Button>
                </div>
                {isOcrProcessing && (
                  <div className="flex items-center justify-center gap-2 text-emerald-700 text-sm font-semibold pt-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{lang === "hi" ? "ओसीआर विश्लेषण जारी है..." : "Extracting clinical entities..."}</span>
                  </div>
                )}
              </div>

              {/* Scanned Items List */}
              {scannedFiles.length > 0 && (
                <div className="space-y-3">
                  <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {lang === "hi" ? "पहचाने गए दस्तावेज़" : "Processed Documents"}
                  </h5>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
                    {scannedFiles.map((doc, idx) => (
                      <div key={idx} className="p-4 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                            <div>
                              <div className="font-bold text-sm text-slate-800">{doc.name}</div>
                              <div className="text-xs text-slate-400">
                                {doc.entities} {lang === "hi" ? "क्लिनिकल एंटिटीज मिलीं" : "entities extracted"} • {doc.type}
                              </div>
                            </div>
                          </div>
                          <Badge className="bg-emerald-100 text-emerald-800 font-semibold text-xs border-emerald-300">
                            {doc.status}
                          </Badge>
                        </div>

                        {/* Extracted Medications chips */}
                        {doc.medications && doc.medications.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {doc.medications.map((med: any, mIdx: number) => (
                              <span
                                key={mIdx}
                                className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 border border-sky-200"
                              >
                                <span className="font-semibold">{med.name}</span>
                                {med.dosage && <span className="text-sky-600">({med.dosage})</span>}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Interaction Warnings */}
                        {doc.interactions && doc.interactions.length > 0 && (
                          <div className="space-y-1 rounded-lg bg-amber-50 p-2.5 border border-amber-200">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                              <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
                              <span>
                                {lang === "hi"
                                  ? `${doc.interactions.length} संभावित ड्रग इंटरेक्शन चेतावनी:`
                                  : `${doc.interactions.length} Drug Interaction Warning(s):`}
                              </span>
                            </div>
                            {doc.interactions.map((inter: any, iIdx: number) => (
                              <div key={iIdx} className="text-[11px] text-amber-800 pl-5">
                                • <span className="font-semibold">{inter.drugA} + {inter.drugB}</span>: {inter.effect}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between items-center bg-slate-50 border-t border-slate-100 px-6 py-4">
              <Button
                variant="ghost"
                onClick={() => setStep("interview")}
                className="text-slate-600"
              >
                {lang === "hi" ? "वापस" : "Back"}
              </Button>
              <Button
                size="lg"
                onClick={handleProceedToSummary}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-8 h-12 gap-2"
              >
                <span>{lang === "hi" ? "अंतिम सारांश व एक्सपोर्ट" : "View Summary & Export"}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ========================================================================= STEP 5: SUMMARY & ABDM EXPORT */}
        {step === "summary" && (
          <Card className="shadow-xl border-slate-200">
            <CardHeader>
              <Badge className="w-fit bg-emerald-100 text-emerald-800 border-emerald-300">
                {lang === "hi" ? "चरण 5 / 5: नैदानिक सारांश व ABDM एक्सपोर्ट" : "Step 5 of 5: Clinical Summary & ABDM Export"}
              </Badge>
              <CardTitle className="text-2xl font-bold text-slate-800 mt-2">
                {lang === "hi" ? "कंसल्टेशन सारांश व FHIR R4 रिकॉर्ड" : "Consultation Record & Interoperable FHIR Export"}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                {lang === "hi"
                  ? "ओपीडी डॉक्टर के लिए तैयार सारांश देखें और राष्ट्रीय ABDM नेटवर्क पर एक्सपोर्ट करें।"
                  : "Review the structured case-taking report and export the NRCES-compliant FHIR R4 bundle."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Patient Badge */}
              <div className="bg-slate-100 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-base text-slate-800">
                    {patientName || "Walk-In Patient"}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {abhaId ? `ABHA: ${abhaId}` : `Phone: ${phone || "Anonymous"}`} • Mode: {mode.toUpperCase()}
                  </div>
                </div>
                <Badge className="bg-emerald-700 text-white font-bold">
                  {lang === "hi" ? "परामर्श के लिए तैयार" : "Ready for Doctor"}
                </Badge>
              </div>

              {/* Summary Sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SECTION_ORDER.map((sec) => {
                  const secItems = ONTOLOGY.filter(
                    (i) => i.section === sec && answers[i.code] !== undefined
                  );
                  if (secItems.length === 0) return null;
                  return (
                    <div
                      key={sec}
                      className="p-4 rounded-xl border border-slate-200 bg-white space-y-2"
                    >
                      <h5 className="font-bold text-xs uppercase tracking-wider text-emerald-800">
                        {SECTION_HEADINGS[sec][lang]}
                      </h5>
                      <div className="space-y-1.5">
                        {secItems.map((item) => (
                          <div key={item.code} className="text-xs">
                            <span className="text-slate-500 font-medium">
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
                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                  <h5 className="font-bold text-xs uppercase tracking-wider text-amber-900">
                    {lang === "hi" ? "दशविध परीक्षा निष्कर्ष" : "Dashavidha Pariksha Findings"}
                  </h5>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Object.entries(dashavidhaAnswers).map(([fac, ans]) => (
                      <div key={fac} className="bg-white p-2 rounded border border-amber-100 text-xs">
                        <div className="text-slate-400 font-mono text-[10px] uppercase">{fac}</div>
                        <div className="font-bold text-slate-800">{ans.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ABDM Export Result Banner */}
              {abdmExportResult && (
                <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-xl flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-bold text-sm text-emerald-900">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span>{lang === "hi" ? "ABDM FHIR R4 बंडल तैयार!" : "ABDM NRCES FHIR R4 Bundle Ready!"}</span>
                    </div>
                    <div className="text-xs text-emerald-700 font-mono">
                      Ref: {abdmExportResult.abdm_reference} • {abdmExportResult.resource_count} Resources
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadBundle}
                    className="gap-1.5 font-bold text-xs border-emerald-600 text-emerald-800 hover:bg-emerald-100"
                  >
                    <Download className="w-4 h-4" />
                    <span>{lang === "hi" ? "JSON डाउनलोड करें" : "Download FHIR JSON"}</span>
                  </Button>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between items-center bg-slate-50 border-t border-slate-100 px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setStep("interview")}
                className="text-slate-700"
              >
                {lang === "hi" ? "वापस प्रश्नोत्तर पर" : "Back to Intake"}
              </Button>

              <div className="flex gap-3">
                <Button
                  size="lg"
                  onClick={handleExportToAbdm}
                  disabled={isExporting}
                  className="bg-indigo-700 hover:bg-indigo-800 text-white font-bold px-6 h-12 gap-2"
                >
                  {isExporting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <FileCheck className="w-5 h-5" />
                      <span>{lang === "hi" ? "ABDM में एक्सपोर्ट करें" : "Export to ABDM"}</span>
                    </>
                  )}
                </Button>

                <Button
                  size="lg"
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
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-6 h-12"
                >
                  {lang === "hi" ? "पूर्ण करें (अगला रोगी)" : "Finish Session"}
                </Button>
              </div>
            </CardFooter>
          </Card>
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
