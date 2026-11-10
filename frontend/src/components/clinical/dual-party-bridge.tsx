"use client";

import { useState } from "react";
import { Mic, Volume2, ArrowLeftRight, Stethoscope, User, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { speak } from "@/lib/speak";
import { clinicalEventBus } from "@/lib/event-bus";

interface Utterance {
  id: string;
  sender: "doctor" | "patient";
  text: string;
  translation: string;
  timestamp: string;
}

export default function DualPartyMedicalBridge() {
  const [patientLang, setPatientLang] = useState<"hi" | "ta" | "te" | "bn">("hi");
  const [isTranslating, setIsTranslating] = useState(false);
  const [conversation, setConversation] = useState<Utterance[]>([
    {
      id: "1",
      sender: "doctor",
      text: "How many days have you had this chest discomfort?",
      translation: "आपको यह छाती में बेचैनी कितने दिनों से हो रही है?",
      timestamp: "10:42 AM",
    },
    {
      id: "2",
      sender: "patient",
      text: "दो दिन से है डॉक्टर साहब, चलने पर दर्द बढ़ जाता है।",
      translation: "It has been two days doctor, pain increases upon walking.",
      timestamp: "10:43 AM",
    },
  ]);

  const speakDoctorPrompt = (englishText: string, translatedHindi: string) => {
    setIsTranslating(true);
    speak(translatedHindi, patientLang === "hi" ? "hi" : "en", {
      onEnd: () => setIsTranslating(false),
    });

    clinicalEventBus.publish({
      type: "BEDSIDE_TRANSLATION_UTTERANCE",
      payload: {
        speaker: "doctor",
        sourceText: englishText,
        sourceLang: "en-IN",
        translatedText: translatedHindi,
        targetLang: patientLang,
        timestamp: Date.now(),
      },
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center font-bold">
            <ArrowLeftRight className="size-4" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              T6: Bedside Dual-Party Medical Bridge
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                <Sparkles className="size-2.5 mr-1" />
                Gnani Timbre & Prisma
              </Badge>
            </h4>
            <p className="text-[11px] text-slate-500">
              Live ambient interpretation bridging Doctor (English) ⇄ Patient (Regional Dialect)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 font-medium">Patient Dialect:</span>
          <select
            value={patientLang}
            onChange={(e: any) => setPatientLang(e.target.value)}
            className="text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-slate-800 dark:text-slate-200"
          >
            <option value="hi">Hindi (हिंदी)</option>
            <option value="ta">Tamil (தமிழ்)</option>
            <option value="te">Telugu (తెలుగు)</option>
            <option value="bn">Bengali (বাংলা)</option>
          </select>
        </div>
      </div>

      {/* Conversation Thread */}
      <div className="my-4 space-y-3 max-h-60 overflow-y-auto pr-1">
        {conversation.map((msg) => (
          <div
            key={msg.id}
            className={`p-3 rounded-xl border text-xs ${
              msg.sender === "doctor"
                ? "bg-sky-50/70 border-sky-200 ml-6 text-sky-950 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200"
                : "bg-emerald-50/70 border-emerald-200 mr-6 text-emerald-950 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200"
            }`}
          >
            <div className="flex items-center justify-between font-bold mb-1 opacity-80 text-[10px]">
              <span className="flex items-center gap-1 uppercase">
                {msg.sender === "doctor" ? <Stethoscope className="size-3" /> : <User className="size-3" />}
                {msg.sender === "doctor" ? "Doctor (English)" : "Patient (Regional)"}
              </span>
              <span>{msg.timestamp}</span>
            </div>
            <div className="font-medium">{msg.text}</div>
            <div className="mt-1 pt-1 border-t border-dashed border-slate-300/60 dark:border-slate-700/60 italic text-slate-600 dark:text-slate-400 flex items-center justify-between">
              <span>{msg.translation}</span>
              <button
                onClick={() => speak(msg.translation, patientLang === "hi" ? "hi" : "en")}
                className="hover:text-slate-900 dark:hover:text-white"
                title="Speak translated text"
              >
                <Volume2 className="size-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Doctor Prompts */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
          Quick Clinical Inquiries (Speak in Patient's Language via Gnani Timbre):
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 rounded-lg"
            onClick={() =>
              speakDoctorPrompt(
                "Do you have diabetes or high blood pressure?",
                "क्या आपको शुगर (डायबिटीज) या बीपी की बीमारी है?"
              )
            }
          >
            <Volume2 className="size-3 mr-1 text-sky-600" />
            Check BP / Diabetes
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 rounded-lg"
            onClick={() =>
              speakDoctorPrompt(
                "Are you allergic to any medicines like penicillin?",
                "क्या आपको किसी दवा से एलर्जी या रिएक्शन होता है?"
              )
            }
          >
            <Volume2 className="size-3 mr-1 text-sky-600" />
            Ask Drug Allergy
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 rounded-lg"
            onClick={() =>
              speakDoctorPrompt(
                "Take this medication after your meals twice daily.",
                "यह दवा दिन में दो बार खाना खाने के बाद लें।"
              )
            }
          >
            <Volume2 className="size-3 mr-1 text-sky-600" />
            Explain Dosage Instruction
          </Button>
        </div>
      </div>
    </div>
  );
}

