"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface UseKioskSpeechProps {
  lang: "en" | "hi";
  onSpeechResult?: (transcript: string) => void;
  enabled?: boolean;
}

export function useKioskSpeech({
  lang = "hi",
  onSpeechResult,
  enabled = true,
}: UseKioskSpeechProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);

  // Stop any ongoing speech synthesis
  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // Speak text using Web Speech Synthesis API
  const speakText = useCallback(
    (text: string, onEnd?: () => void) => {
      if (typeof window === "undefined" || !window.speechSynthesis || !autoSpeak) {
        if (onEnd) onEnd();
        return;
      }

      window.speechSynthesis.cancel(); // Cancel any existing queue

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "hi" ? "hi-IN" : "en-IN";
      utterance.rate = 0.95; // Slightly slower for rural/elderly comprehension
      utterance.pitch = 1.0;

      // Select Hindi or Indian English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) =>
          (lang === "hi" && (v.lang.includes("hi") || v.name.toLowerCase().includes("hindi"))) ||
          (lang === "en" && (v.lang.includes("en-IN") || v.name.toLowerCase().includes("india")))
      );
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        if (onEnd) onEnd();
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        if (onEnd) onEnd();
      };

      window.speechSynthesis.speak(utterance);
    },
    [autoSpeak, lang]
  );

  // Start Speech Recognition
  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const rec = new SpeechRec();
      rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
      rec.continuous = false;
      rec.interimResults = true;

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((r: any) => r[0]?.transcript)
          .join(" ");
        setTranscript(text);
        if (event.results[0]?.isFinal && onSpeechResult) {
          onSpeechResult(text);
        }
      };

      rec.onerror = () => {
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (_) {}
  }, [lang, onSpeechResult]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      stopListening();
    };
  }, [stopSpeaking, stopListening]);

  return {
    isSpeaking,
    isListening,
    autoSpeak,
    setAutoSpeak,
    transcript,
    speakText,
    stopSpeaking,
    startListening,
    stopListening,
  };
}
