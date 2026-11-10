"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  Send,
  RotateCcw,
  AlertTriangle,
  Copy,
  Check,
  Headphones,
  MessageSquare,
  Activity,
  Phone,
  Radio,
  X,
  Stethoscope,
  Pill,
  Hospital,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { speak, stopSpeaking } from "@/lib/speak";
import { clinicalEventBus } from "@/lib/event-bus";
import { VocalBiomarkersAnalyzer, type VocalBiomarkersResult } from "@/lib/clinical/vocal-biomarkers";
import { NebulaVoiceOrb, type OrbState } from "@/components/patient/nebula-voice-orb";
import {
  HospitalCard,
  MedicationCard,
  SavingsCard,
  SchemeCard,
  VitalsCard,
  EmergencyCard,
} from "@/components/patient/tool-cards";
import { FallAlertOverlay } from "@/components/patient/fall-alert-overlay";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  sender: "user" | "sahara";
  text: string;
  timestamp: string;
  toolCard?: "hospital" | "medication" | "savings" | "scheme" | "vitals" | "emergency";
  toolData?: any;
}

type LanguageMode = "hi" | "en" | "ta" | "bn";

const WELCOME_MESSAGES: Record<LanguageMode, string> = {
  hi: "नमस्ते रमेश जी! मैं सहारा हूँ — आपका AI स्वास्थ्य साथी। आप कैसा महसूस कर रहे हैं? आप बोलकर या लिखकर लक्षण पूछ सकते हैं।",
  ta: "வணக்கம் Ramesh ji! நான் உங்கள் Sahara AI நல்வாழ்வு தோழன். உங்க உடம்பு இப்போ எப்படி இருக்கு? அறிகுறிகளைப் பேசி அல்லது டைப் செய்து கேட்கலாம்.",
  bn: "নমস্কার Ramesh বাবু! আমি সাহারা — আপনার AI স্বাস্থ্য সাথী। আপনি এখন কেমন বোধ করছেন? আপনার লক্ষণগুলি মুখে বলুন বা টাইপ করে জানান।",
  en: "Hello Ramesh ji! I am Sahara — your AI health companion. How are you feeling today? You can speak or type your symptoms.",
};

const RESET_MESSAGES: Record<LanguageMode, string> = {
  hi: "नमस्ते रमेश जी! नया सत्र शुरू हो चुका है। आप आज क्या पूछना या जांचना चाहते हैं?",
  ta: "வணக்கம் Ramesh ji! புதிய அமர்வு தொடங்கிவிட்டது. இன்று நீங்கள் என்ன கேட்க விரும்புகிறீர்கள்?",
  bn: "নমস্কার Ramesh বাবু! নতুন সেশন শুরু হয়েছে। আজ আপনি কী জানতে বা চেক করতে চান?",
  en: "Hello Ramesh ji! New session started. What would you like to check or consult today?",
};

export default function PatientChatGPTPage() {
  const [lang, setLang] = useState<LanguageMode>("hi");
  const [viewMode, setViewMode] = useState<"chat" | "voice">("chat");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [inputText, setInputText] = useState("");
  const [isCopiedId, setIsCopiedId] = useState<string | null>(null);
  const [biomarkers, setBiomarkers] = useState<VocalBiomarkersResult | null>(null);
  const [fallAlertOpen, setFallAlertOpen] = useState(false);

  // Chat message stream
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg-0",
      sender: "sahara",
      text: WELCOME_MESSAGES["hi"],
      timestamp: "Just now",
    },
  ]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const biomarkerAnalyzerRef = useRef<VocalBiomarkersAnalyzer | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, orbState]);

  // Copy text to clipboard
  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopiedId(id);
    const copyToasts: Record<LanguageMode, string> = {
      hi: "कॉपी कर लिया गया",
      ta: "Copied pannappattadhu",
      bn: "Copy kora hoyeche",
      en: "Copied to clipboard",
    };
    toast.success(copyToasts[lang]);
    setTimeout(() => setIsCopiedId(null), 2000);
  };

  // Switch Language Mode across Hinglish, Tanglish, Benglish & English
  const handleSwitchLanguage = (newLang: LanguageMode) => {
    setLang(newLang);
    stopSpeaking();
    setMessages((prev) => {
      if (prev.length <= 1) {
        return [
          {
            id: "msg-0",
            sender: "sahara",
            text: WELCOME_MESSAGES[newLang],
            timestamp: "Just now",
          },
        ];
      }
      return prev;
    });

    const activeToasts: Record<LanguageMode, string> = {
      hi: "Hinglish (हिन्दी) मोड सक्रिय — Timbre v3.0 (Shivani)",
      ta: "Tanglish (தமிழ்) mode active — Timbre v3.0 (Lakshmi)",
      bn: "Benglish (বাংলা) mode active — Timbre v3.0 (Riyaa)",
      en: "English mode active — Timbre v3.0 (Shivani)",
    };
    toast.info(activeToasts[newLang]);
  };

  // Reset conversation
  const handleResetChat = () => {
    stopSpeaking();
    setMessages([
      {
        id: `msg-${Date.now()}`,
        sender: "sahara",
        text: RESET_MESSAGES[lang],
        timestamp: "Just now",
      },
    ]);
    setOrbState("idle");
    const resetToasts: Record<LanguageMode, string> = {
      hi: "नया चैट शुरू किया गया",
      ta: "Puthiya chat thodangappattadhu",
      bn: "Notun chat shuru hoyeche",
      en: "New chat started",
    };
    toast.info(resetToasts[lang]);
  };

  // Voice Microphone Toggle
  const handleToggleVoice = async () => {
    if (orbState === "listening") {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    if (typeof window === "undefined") return;

    try {
      setOrbState("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Start T7 Acoustic Vocal Biomarker Analyzer
      const analyzer = new VocalBiomarkersAnalyzer();
      await analyzer.startAnalysis(stream);
      biomarkerAnalyzerRef.current = analyzer;

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setOrbState("thinking");
        setAudioLevel(0);

        if (biomarkerAnalyzerRef.current) {
          const bioResult = biomarkerAnalyzerRef.current.stopAnalysis();
          setBiomarkers(bioResult);
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        stream.getTracks().forEach((t) => t.stop());

        // Call Gnani Prisma v3.0 STT with Sovereign Indic-Auto Code-Mixing
        let recognizedText = "";
        try {
          const fd = new FormData();
          fd.append("audio", audioBlob, "patient_intake.wav");
          fd.append("language_code", "indic-auto");
          fd.append("model", "prisma-v3.0");

          const res = await fetch("/api/gnani/stt", { method: "POST", body: fd });
          if (res.ok) {
            const data = await res.json();
            recognizedText = data.transcript || "";
          }
        } catch (err) {
          console.warn("Gnani STT fallback to manual", err);
        }

        if (!recognizedText) {
          if (lang === "ta") {
            recognizedText = "Enakku severe headache and dizziness irukku";
          } else if (lang === "bn") {
            recognizedText = "Amar matha ghurche and chest heaviness lagche";
          } else if (lang === "hi") {
            recognizedText = "मुझे सिरदर्द और चक्कर आ रहे हैं";
          } else {
            recognizedText = "I have severe headache and dizziness";
          }
        }

        handleProcessUserQuery(recognizedText);
      };

      recorder.start();
      setOrbState("listening");
      setAudioLevel(0.65);
    } catch (err) {
      console.error("Mic access error", err);
      const micErrors: Record<LanguageMode, string> = {
        hi: "माइक्रोफ़ोन अनुमति नहीं मिली",
        ta: "Microphone anumathi kidaikkavillai",
        bn: "Microphone er onumoti paowa jayni",
        en: "Microphone permission denied",
      };
      toast.error(micErrors[lang]);
      setOrbState("idle");
    }
  };

  // Process user query & respond with clinical intelligence
  const handleProcessUserQuery = (queryText: string) => {
    if (!queryText.trim()) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setOrbState("thinking");

    // Clinical Logic & Tool Card Selection
    setTimeout(() => {
      const q = queryText.toLowerCase();
      let replyText = "";
      let toolCardType: ChatMessage["toolCard"] = undefined;
      let toolData: any = undefined;

      const isEmergency =
        q.includes("सीने") ||
        q.includes("chest") ||
        q.includes("सांस") ||
        q.includes("breath") ||
        q.includes("चक्कर") ||
        q.includes("सिरदर्द") ||
        q.includes("headache") ||
        q.includes("dizziness") ||
        q.includes("marbu") ||
        q.includes("vali") ||
        q.includes("nenju") ||
        q.includes("swasam") ||
        q.includes("moochu") ||
        q.includes("mayakkam") ||
        q.includes("buke") ||
        q.includes("betha") ||
        q.includes("heaviness") ||
        q.includes("saas") ||
        q.includes("koshto") ||
        q.includes("kosto") ||
        q.includes("matha") ||
        q.includes("ghurche");

      const isMedicine =
        q.includes("दवा") ||
        q.includes("medicine") ||
        q.includes("bp") ||
        q.includes("sugar") ||
        q.includes("सस्ता") ||
        q.includes("जन औषधि") ||
        q.includes("marunthu") ||
        q.includes("tablets") ||
        q.includes("salt") ||
        q.includes("oushodh") ||
        q.includes("goli") ||
        q.includes("aushadhi");

      const isHospital =
        q.includes("अस्पताल") ||
        q.includes("hospital") ||
        q.includes("pmjay") ||
        q.includes("आयुष्मान") ||
        q.includes("aaspathiri") ||
        q.includes("hashpatal") ||
        q.includes("bed") ||
        q.includes("doctor");

      if (isEmergency) {
        if (lang === "ta") {
          replyText =
            "⚠️ Unga symptoms acute-ah irukku. Naanga clinical triage panni 108 Emergency SBAR pre-alert dispatch desk-ku anupiyullom. Immediate rest edukavum.";
        } else if (lang === "bn") {
          replyText =
            "⚠️ Apnar symptoms guruttopurno. Amra acute clinical triage korechi ebong 108 EMS pre-alert SBAR dispatch desk e pathiyechi. Ekhoni rest nin.";
        } else if (lang === "hi") {
          replyText =
            "⚠️ आपके लक्षण महत्वपूर्ण हैं। हमने आपके लक्षणों का क्लीनिकल ट्राइएज किया है और आपातकालीन 108 SBAR प्रोटोकॉल तैयार किया है।";
        } else {
          replyText =
            "⚠️ These symptoms require immediate clinical attention. We conducted acute triage and generated a pre-alert SBAR summary for 108 EMS.";
        }
        toolCardType = "emergency";
        toolData = {
          title: "Acute Clinical Triage Pre-Alert (Red/Amber Path)",
          sbar: "S: Acute Chest Heaviness / Headache & Dizziness. B: Male, 58Y, Hypertensive on Telma 40. A: Suspected hypertensive urgency / acute event. R: 108 EMS desk alerted.",
        };
        setOrbState("emergency");

        // Broadcast to Door 3 (Ops) and Door 4 (Dispatch)
        clinicalEventBus.publish({
          type: "EMERGENCY_SOS_TRIGGERED",
          payload: {
            incidentId: `sos-${Date.now()}`,
            type: "Acute Symptoms / Dizziness Pre-Alert",
            victimName: "रमेश कुमार (Ramesh Kumar)",
            coords: { lat: 28.6139, lng: 77.209 },
            triage: "red",
            sbar: {
              situation: "Severe chest heaviness, headache or dizziness reported via code-mixed patient intake",
              background: "Male, 58Y, Hypertensive on Telma 40",
              assessment: "Suspected hypertensive urgency / cardiac risk",
              recommendation: "Immediate vitals check & 108 CAD ambulance standby",
            },
            timestamp: Date.now(),
          },
        });
      } else if (isMedicine) {
        if (lang === "ta") {
          replyText =
            "Unga regular BP medicine Telma 40. Idhe generic salt (Telmisartan 40mg) Jan Aushadhi Kendra-la mattum ₹32-ku kedaikkum, ungalukku 88% direct savings kedaikkum!";
        } else if (lang === "bn") {
          replyText =
            "Apnar regular BP medicine Telma 40. Eki generic salt (Telmisartan 40mg) Jan Aushadhi Kendra-te matro ₹32 te paben, jar fole 88% pocket savings hobe!";
        } else if (lang === "hi") {
          replyText =
            "आपकी नियमित BP की दवा Telma 40 है। आप जन औषधि केंद्र से यही सॉल्ट (Telmisartan 40mg) केवल ₹32 में प्राप्त कर सकते हैं, जिससे आपकी 88% की बचत होगी।";
        } else {
          replyText =
            "Your regular BP medicine is Telma 40. The same generic salt (Telmisartan 40mg) is available at Jan Aushadhi Kendra for only ₹32, saving 88%.";
        }
        toolCardType = "savings";
        toolData = {
          brandedName: "Telma 40 (Telmisartan 40mg)",
          brandedPrice: 285,
          genericName: "Jan Aushadhi Telmisartan 40mg",
          genericPrice: 32,
          savingsPct: 88,
        };
        setOrbState("speaking");
      } else if (isHospital) {
        if (lang === "ta") {
          replyText =
            "Unga location-ku kitta Civil Hospital 2.4 km dhoorathula irukku. Anga Ayushman Bharat PM-JAY cashless treatment & 14 emergency beds available-ah irukku.";
        } else if (lang === "bn") {
          replyText =
            "Apnar kache Civil Hospital matro 2.4 km dure ache, jekhane PM-JAY cashless treatment ebong 14 ti emergency bed available ache.";
        } else if (lang === "hi") {
          replyText =
            "आपके नज़दीक सिविल अस्पताल (Civil Hospital) 2.4 किमी दूरी पर है, जहाँ आयुष्मान भारत PM-JAY के तहत मुफ़्त इलाज व 14 आपातकालीन बेड उपलब्ध हैं।";
        } else {
          replyText =
            "Civil Hospital is 2.4 km away with PM-JAY cashless treatment and 14 emergency beds currently open.";
        }
        toolCardType = "hospital";
        setOrbState("speaking");
      } else {
        if (lang === "ta") {
          replyText =
            "Unga details note pannikitten. Konjam water kudichitu rest edunga. Edhavadhu discomfort irundha udane enakku sollunga.";
        } else if (lang === "bn") {
          replyText =
            "Ami apnar kotha note kore niyechi. Ektu jol khan ebong rest nin. Kono rokom koshto hole sathe sathe janaben.";
        } else if (lang === "hi") {
          replyText =
            "मैंने आपकी जानकारी नोट कर ली है। कृपया थोड़ा पानी पिएं और विश्राम करें। यदि कोई भी असहजता महसूस हो तो तुरंत मुझे बताएं।";
        } else {
          replyText =
            "I have recorded your notes. Please drink some water and rest. If you feel any worsening discomfort, let me know immediately.";
        }
        toolCardType = "vitals";
        setOrbState("speaking");
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: "sahara",
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        toolCard: toolCardType,
        toolData: toolData,
      };

      setMessages((prev) => [...prev, botMsg]);

      // Voice Output via Gnani Timbre TTS (hi -> Shivani, ta -> Lakshmi, bn -> Riyaa)
      speak(replyText, lang);

      setTimeout(() => {
        setOrbState((curr) => (curr === "emergency" ? "emergency" : "idle"));
      }, 5500);
    }, 1100);
  };

  const starterPrompts = [
    {
      icon: Stethoscope,
      hi: "मुझे सिरदर्द और चक्कर आ रहे हैं",
      ta: "Enakku severe headache and dizziness irukku",
      bn: "Amar matha ghurche and buke heaviness lagche",
      en: "I have headache and dizziness",
      descHi: "लक्षणों का त्वरित क्लीनिकल ट्राइएज",
      descTa: "Acute symptom clinical triage",
      descBn: "Acute symptom clinical triage",
      descEn: "Acute symptom clinical triage",
    },
    {
      icon: Pill,
      hi: "मेरी आज की दवाइयों का समय बताओ",
      ta: "Enoda innaiku BP medicine schedule kaatunga",
      bn: "Ajker daily medicine schedule ta bolun",
      en: "Show my medicines for today",
      descHi: "खुराक शेड्यूल व नियमितता",
      descTa: "Daily dose schedule & adherence",
      descBn: "Daily dose schedule & adherence",
      descEn: "Daily dose schedule & adherence",
    },
    {
      icon: Hospital,
      hi: "नज़दीकी PM-JAY अस्पताल कहाँ है?",
      ta: "Nearest PM-JAY hospital and emergency beds sollunga",
      bn: "Kacher PM-JAY hospital e emergency bed ache?",
      en: "Where is nearest PM-JAY hospital?",
      descHi: "मुफ़्त इलाज व इमरजेंसी बेड स्थिति",
      descTa: "Cashless coverage & bed status",
      descBn: "Cashless coverage & bed status",
      descEn: "Cashless coverage & bed status",
    },
    {
      icon: Sparkles,
      hi: "BP की दवा का सस्ता जन औषधि विकल्प?",
      ta: "BP tablet-ku cheap Jan Aushadhi generic alternative?",
      bn: "BP oushodher sosta Jan Aushadhi generic alternative?",
      en: "Cheaper Jan Aushadhi generic for BP?",
      descHi: "88% तक की सॉल्ट बचत तुलना",
      descTa: "Generic salt savings up to 88%",
      descBn: "Generic salt savings up to 88%",
      descEn: "Generic salt savings up to 88%",
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-background select-text">
      {/* 1. ChatGPT-Style Slim Top Header */}
      <header className="h-13 shrink-0 border-b border-border/50 px-4 md:px-6 flex items-center justify-between bg-background/80 backdrop-blur-md z-10">
        {/* Left: Brand & Mode Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-sm tracking-tight text-foreground">
              {lang === "ta"
                ? "Sahara AI (சகாரா)"
                : lang === "bn"
                ? "Sahara AI (সাহারা)"
                : lang === "hi"
                ? "सहारा AI"
                : "Sahara Health AI"}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-teal-400 border-teal-500/30">
              Gnani Voice
            </Badge>
          </div>

          <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />

          {/* Mode Pill: Chat vs Full Voice */}
          <div className="hidden sm:flex rounded-full border border-border/60 p-0.5 bg-muted/30 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("chat")}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium transition-all ${
                viewMode === "chat"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              <span>{lang === "ta" ? "சாட்" : lang === "bn" ? "চ্যাট" : lang === "hi" ? "चैट" : "Chat"}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("voice")}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium transition-all ${
                viewMode === "voice"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Headphones className="h-3 w-3" />
              <span>{lang === "ta" ? "வாய்ஸ்" : lang === "bn" ? "ভয়েস" : lang === "hi" ? "वॉयस" : "Voice"}</span>
            </button>
          </div>
        </div>

        {/* Right: Controls (Language, New Chat, SOS) */}
        <div className="flex items-center gap-2">
          {/* Fall Alert Test */}
          <button
            type="button"
            onClick={() => setFallAlertOpen(true)}
            className="hidden md:flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <AlertTriangle className="h-3 w-3" />
            <span>{lang === "ta" ? "Fall Test" : lang === "bn" ? "Fall Test" : lang === "hi" ? "फॉल टेस्ट" : "Test Fall"}</span>
          </button>

          {/* 4-Language Code-Mixed Toggle Bar */}
          <div className="flex rounded-lg border border-border/60 p-0.5 bg-muted/30">
            <button
              type="button"
              onClick={() => handleSwitchLanguage("hi")}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-all ${
                lang === "hi" ? "bg-teal-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Hinglish (Timbre v3.0 Shivani)"
            >
              Hinglish (हि)
            </button>
            <button
              type="button"
              onClick={() => handleSwitchLanguage("ta")}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-all ${
                lang === "ta" ? "bg-teal-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Tanglish (Timbre v3.0 Lakshmi)"
            >
              Tanglish (த)
            </button>
            <button
              type="button"
              onClick={() => handleSwitchLanguage("bn")}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-all ${
                lang === "bn" ? "bg-teal-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Benglish (Timbre v3.0 Riyaa)"
            >
              Benglish (বা)
            </button>
            <button
              type="button"
              onClick={() => handleSwitchLanguage("en")}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-all ${
                lang === "en" ? "bg-teal-600 text-white shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
              title="English (Indian English)"
            >
              EN
            </button>
          </div>

          {/* New Chat Button */}
          <button
            type="button"
            onClick={handleResetChat}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Reset Chat"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {lang === "ta" ? "புதிய சாட்" : lang === "bn" ? "নতুন চ্যাট" : lang === "hi" ? "नया चैट" : "New Chat"}
            </span>
          </button>

          {/* 108 SOS Quick Action */}
          <Link
            href="/patient/sos"
            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Phone className="h-3.5 w-3.5 animate-pulse" />
            <span>108 SOS</span>
          </Link>
        </div>
      </header>

      {/* 2. Main Body Area */}
      {viewMode === "voice" ? (
        /* ================= VOICE COMPANION MODE (ChatGPT Advanced Voice Mode) ================= */
        <div className="flex-1 flex flex-col items-center justify-between p-6 md:p-12 relative overflow-hidden bg-radial from-teal-950/20 via-background to-background">
          {/* Top Bar inside voice mode */}
          <div className="w-full max-w-lg flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-teal-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">
                {lang === "ta"
                  ? "Sovereign Voice Session Active (Tanglish - Lakshmi)"
                  : lang === "bn"
                  ? "Sovereign Voice Session Active (Benglish - Riyaa)"
                  : lang === "hi"
                  ? "सॉवरेन वॉइस सत्र सक्रिय (Hinglish - Shivani)"
                  : "Sovereign Voice Session Active (Indian English)"}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setViewMode("chat")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4 mr-1" />
              {lang === "ta" ? "சாட் திரும்பு" : lang === "bn" ? "চ্যাটে ফিরুন" : lang === "hi" ? "चैट पर लौटें" : "Back to Chat"}
            </Button>
          </div>

          {/* Center 3D Bloop Orb */}
          <div className="flex flex-col items-center justify-center my-auto z-10">
            <NebulaVoiceOrb
              state={orbState}
              audioLevel={audioLevel}
              lang={lang}
              onClick={handleToggleVoice}
              size={260}
            />

            {/* Vocal Biomarkers Badge */}
            {biomarkers && (
              <div className="mt-4 px-3 py-1.5 rounded-full bg-muted/60 border border-border/80 text-xs flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-teal-400" />
                <span className="text-muted-foreground">Dyspnea Index:</span>
                <span className="font-semibold text-foreground">{biomarkers.dyspneaScore}/10</span>
                <Badge variant="outline" className="text-[10px] text-teal-400 border-teal-500/30">
                  {biomarkers.classification}
                </Badge>
              </div>
            )}
          </div>

          {/* Bottom Voice Controls */}
          <div className="w-full max-w-md flex flex-col items-center gap-3 z-10">
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                onClick={handleToggleVoice}
                className={`rounded-full h-14 w-14 p-0 shadow-lg transition-transform ${
                  orbState === "listening"
                    ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                    : "bg-teal-600 hover:bg-teal-500 text-white hover:scale-105"
                }`}
              >
                {orbState === "listening" ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {lang === "ta"
                ? "மைக்கை அழுத்திப் பேசுங்கள். சஹாரா உடனடியாகப் பதிலளிக்கும்."
                : lang === "bn"
                ? "মাইক চেপে কথা বলুন। সাহারা তৎক্ষণাৎ উত্তর দেবে।"
                : lang === "hi"
                ? "माइक दबाकर बोलें। समाप्त करने के बाद सहारा तुरंत जवाब देगा।"
                : "Tap the mic and speak. Sahara will transcribe and respond verbally."}
            </p>
          </div>
        </div>
      ) : (
        /* ================= CHAT MODE (Clean ChatGPT Layout) ================= */
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Scrollable Conversation Canvas */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-6"
          >
            <div className="max-w-3xl mx-auto w-full">
              {/* If no interaction yet, show centered welcoming hero & prompt tiles */}
              {messages.length <= 1 ? (
                <div className="flex flex-col items-center justify-center min-h-[50vh] text-center my-auto py-8">
                  {/* Interactive 3D Bloop Orb Centerpiece */}
                  <div className="mb-6">
                    <NebulaVoiceOrb
                      state={orbState}
                      audioLevel={audioLevel}
                      lang={lang}
                      onClick={handleToggleVoice}
                      size={180}
                    />
                  </div>

                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-2">
                    {lang === "ta"
                      ? "வணக்கம் Ramesh ji, இன்று உங்கள் உடல்நலம் எப்படி இருக்கிறது?"
                      : lang === "bn"
                      ? "নমস্কার Ramesh বাবু, আজ আপনার শরীর কেমন আছে?"
                      : lang === "hi"
                      ? "नमस्ते रमेश जी, आज आपकी सेहत कैसी है?"
                      : "Hello Ramesh ji, how are you feeling today?"}
                  </h1>
                  <p className="text-sm text-muted-foreground max-w-md mb-8">
                    {lang === "ta"
                      ? "அறிகுறிகளைச் சொல்லுங்கள், மாத்திரை அட்டவணையை சரிபார்க்கவும் அல்லது அருகிலுள்ள PM-JAY மருத்துவமனையைக் கண்டறியவும்."
                      : lang === "bn"
                      ? "লক্ষণ জানান, ওষুধের সময়সূচী চেক করুন বা কাছের PM-JAY হাসপাতাল খুঁজুন।"
                      : lang === "hi"
                      ? "लक्षण बताएं, अपनी नियमित दवाओं के बारे में पूछें या नजदीकी PM-JAY अस्पताल खोजें।"
                      : "Describe your symptoms, check dose schedules, or locate nearby PM-JAY hospitals."}
                  </p>

                  {/* 2x2 ChatGPT-Style Suggestion Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl text-left">
                    {starterPrompts.map((item, idx) => {
                      const Icon = item.icon;
                      const promptText =
                        lang === "ta" ? item.ta : lang === "bn" ? item.bn : lang === "hi" ? item.hi : item.en;
                      const promptDesc =
                        lang === "ta" ? item.descTa : lang === "bn" ? item.descBn : lang === "hi" ? item.descHi : item.descEn;

                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleProcessUserQuery(promptText)}
                          className="group p-3.5 rounded-2xl border border-border/70 bg-card hover:bg-muted/50 hover:border-teal-500/40 transition-all flex items-start gap-3 shadow-xs hover:shadow-sm"
                        >
                          <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 group-hover:bg-teal-500/20 transition-colors shrink-0">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground group-hover:text-teal-400 transition-colors line-clamp-1">
                              {promptText}
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-1">
                              {promptDesc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Chat Messages Stream */
                <div className="space-y-6 pb-6">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.sender === "user" ? "items-end" : "items-start"
                      } space-y-2`}
                    >
                      {/* Sender Avatar & Message Bubble */}
                      <div
                        className={`flex gap-3 max-w-[88%] md:max-w-[80%] ${
                          msg.sender === "user" ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {msg.sender === "sahara" && (
                          <div className="h-7 w-7 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <Sparkles className="h-3.5 w-3.5" />
                          </div>
                        )}

                        <div className="space-y-1">
                          <div
                            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                              msg.sender === "user"
                                ? "bg-teal-600 text-white rounded-tr-xs"
                                : "bg-muted/50 text-foreground border border-border/60 rounded-tl-xs"
                            }`}
                          >
                            <p>{msg.text}</p>
                          </div>

                          {/* Action Buttons for Sahara Responses */}
                          {msg.sender === "sahara" && (
                            <div className="flex items-center gap-3 px-1 pt-0.5 text-xs text-muted-foreground">
                              <button
                                type="button"
                                onClick={() => speak(msg.text, lang)}
                                className="flex items-center gap-1 hover:text-teal-400 transition-colors"
                              >
                                <Volume2 className="h-3 w-3" />
                                <span>
                                  {lang === "ta" ? "கேளுங்கள்" : lang === "bn" ? "শুনুন" : lang === "hi" ? "सुनें" : "Listen"}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCopyText(msg.id, msg.text)}
                                className="flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                {isCopiedId === msg.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-400" />
                                    <span className="text-emerald-400">
                                      {lang === "ta" ? "Copied" : lang === "bn" ? "Copied" : lang === "hi" ? "कॉपी हुआ" : "Copied"}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    <span>
                                      {lang === "ta" ? "Copy" : lang === "bn" ? "Copy" : lang === "hi" ? "कॉपी" : "Copy"}
                                    </span>
                                  </>
                                )}
                              </button>

                              <span className="text-[10px] opacity-60 font-mono">{msg.timestamp}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Inline Rich Clinical Tool Cards (Rendered like ChatGPT Canvas/Artifacts) */}
                      {msg.toolCard === "emergency" && (
                        <div className="w-full max-w-[88%] md:max-w-[80%] pl-10">
                          <EmergencyCard details={msg.toolData} />
                        </div>
                      )}
                      {msg.toolCard === "savings" && (
                        <div className="w-full max-w-[88%] md:max-w-[80%] pl-10">
                          <SavingsCard data={msg.toolData} />
                        </div>
                      )}
                      {msg.toolCard === "hospital" && (
                        <div className="w-full max-w-[88%] md:max-w-[80%] pl-10">
                          <HospitalCard />
                        </div>
                      )}
                      {msg.toolCard === "vitals" && (
                        <div className="w-full max-w-[88%] md:max-w-[80%] pl-10">
                          <VitalsCard />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Thinking Indicator */}
                  {orbState === "thinking" && (
                    <div className="flex items-center gap-3 pl-2">
                      <div className="h-7 w-7 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center shrink-0">
                        <Sparkles className="h-3.5 w-3.5 animate-spin" />
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-muted/40 border border-border/40 text-xs text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        <span className="ml-1.5 font-medium">
                          {lang === "ta"
                            ? "Sahara yosikkuthu..."
                            : lang === "bn"
                            ? "Sahara bhabche..."
                            : lang === "hi"
                            ? "सहारा सोच रहा है..."
                            : "Sahara is thinking..."}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. Bottom ChatGPT-Style Docked Prompt Capsule */}
          <div className="shrink-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
            <div className="max-w-3xl mx-auto w-full space-y-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleProcessUserQuery(inputText);
                }}
                className="relative flex items-center gap-2 rounded-3xl border border-border/80 bg-card/90 backdrop-blur-md px-3 py-2 shadow-lg focus-within:border-teal-500/80 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all"
              >
                {/* Voice Microphone Button */}
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  title="Speak to Sahara"
                  className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    orbState === "listening"
                      ? "bg-teal-500 text-white animate-pulse shadow-md shadow-teal-500/30 scale-105"
                      : "text-muted-foreground hover:text-teal-400 hover:bg-muted/60"
                  }`}
                >
                  {orbState === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>

                {/* Text Input */}
                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    lang === "ta"
                      ? "சஹாராவிடம் கேளுங்கள்... (அறிகுறிகள், மருந்துகள், PM-JAY மருத்துவமனை)"
                      : lang === "bn"
                      ? "সাহারার কাছে জানতে চান... (লক্ষণ, ওষুধ, PM-JAY হাসপাতাল)"
                      : lang === "hi"
                      ? "सहारा से कुछ भी पूछें... (लक्षण, दवाइयाँ, PM-JAY अस्पताल)"
                      : "Ask Sahara anything... (symptoms, medications, hospitals)"
                  }
                  className="flex-1 bg-transparent border-0 outline-none text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />

                {/* Switch to Full Voice Mode */}
                <button
                  type="button"
                  onClick={() => setViewMode("voice")}
                  title="Switch to Fullscreen Voice Orb"
                  className="hidden sm:flex h-8 w-8 rounded-full items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Headphones className="h-4 w-4" />
                </button>

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    inputText.trim()
                      ? "bg-teal-600 hover:bg-teal-500 text-white shadow-xs"
                      : "text-muted-foreground/30 bg-muted/40 cursor-not-allowed"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>

              {/* Minimal Disclaimer */}
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {lang === "ta"
                  ? "சஹாரா ஒரு AI சுகாதாரத் தோழன். அவசர நிலைகளில் உடனே 108-ஐ அழைக்கவும்."
                  : lang === "bn"
                  ? "সাহারা একটি AI স্বাস্থ্য সঙ্গী। জরুরি পরিস্থিতিতে অবিলম্বে 108 ডায়াল করুন।"
                  : lang === "hi"
                  ? "सहारा एक AI स्वास्थ्य साथी है। किसी भी गंभीर आपातकाल में तुरंत 108 पर कॉल करें।"
                  : "Sahara is an AI health companion. In critical emergencies, immediately dial 108."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fall Alert Simulation Modal Overlay */}
      <FallAlertOverlay
        isOpen={fallAlertOpen}
        onDismiss={() => setFallAlertOpen(false)}
        onConfirmSOS={() => {
          setFallAlertOpen(false);
          clinicalEventBus.publish({
            type: "EMERGENCY_SOS_TRIGGERED",
            payload: {
              incidentId: `fall-${Date.now()}`,
              type: "Fall Impact Confirmed",
              victimName: "रमेश कुमार (Ramesh Kumar)",
              coords: { lat: 28.6139, lng: 77.209 },
              triage: "red",
              sbar: {
                situation: "Sudden fall detected with uncancelled user alarm",
                background: "Male, 58Y, hypertensive elderly citizen",
                assessment: "High risk of trauma / fracture or syncope",
                recommendation: "Immediate 108 CAD ambulance dispatch",
              },
              timestamp: Date.now(),
            },
          });
          window.location.href = "/patient/sos";
        }}
        lang={lang}
      />
    </div>
  );
}
