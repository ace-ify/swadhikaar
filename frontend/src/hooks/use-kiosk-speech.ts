"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { speak, stopSpeaking as stopGlobalSpeaking } from "@/lib/speak";

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
  const [engine, setEngine] = useState<string>("Gnani.ai Prisma & Timbre");
  const [sttLatency, setSttLatency] = useState<number | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Listen to global Gnani speech events
  useEffect(() => {
    const handleVoiceEvent = (e: any) => {
      if (e.detail) {
        setIsSpeaking(!!e.detail.active);
        if (e.detail.engine) setEngine(e.detail.engine);
      }
    };
    window.addEventListener("gnani-voice-event", handleVoiceEvent);
    return () => {
      window.removeEventListener("gnani-voice-event", handleVoiceEvent);
    };
  }, []);

  // Stop any ongoing speech synthesis
  const stopSpeaking = useCallback(() => {
    stopGlobalSpeaking();
    setIsSpeaking(false);
  }, []);

  // Speak text using Gnani Timbre v3.0 (with fallback inside speak())
  const speakText = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!autoSpeak) {
        if (onEnd) onEnd();
        return;
      }
      setIsSpeaking(true);
      speak(text, lang, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false);
          if (onEnd) onEnd();
        },
      });
    },
    [autoSpeak, lang]
  );

  // Send recorded audio to Gnani Prisma v3.0 STT API
  const sendToGnaniSTT = useCallback(
    async (blob: Blob) => {
      try {
        const formData = new FormData();
        formData.append("audio", blob, "recording.wav");
        formData.append("language_code", lang === "hi" ? "hi-IN" : "en-IN");
        formData.append("model", "prisma-v3.0");

        const res = await fetch("/api/gnani/stt", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.transcript) {
            setTranscript(data.transcript);
            setSttLatency(data.latency || null);
            if (onSpeechResult) {
              onSpeechResult(data.transcript);
            }
            return;
          }
        }
      } catch (err) {
        console.warn("Gnani STT API call error:", err);
      }
    },
    [lang, onSpeechResult]
  );

  // Fallback: Start Web Speech Recognition
  const startFallbackRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      if (recognitionRef.current) recognitionRef.current.stop();

      const rec = new SpeechRec();
      rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
      rec.continuous = false;
      rec.interimResults = true;

      rec.onstart = () => setIsListening(true);
      rec.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((r: any) => r[0]?.transcript)
          .join(" ");
        setTranscript(text);
        if (event.results[0]?.isFinal && onSpeechResult) {
          onSpeechResult(text);
        }
      };
      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);

      recognitionRef.current = rec;
      rec.start();
    } catch (_) {}
  }, [lang, onSpeechResult]);

  // Start Listening with Microphone & MediaRecorder (Gnani Prisma STT)
  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;

    audioChunksRef.current = [];
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsListening(false);
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
          stream.getTracks().forEach((track) => track.stop());
          if (audioBlob.size > 1000) {
            await sendToGnaniSTT(audioBlob);
          }
        };

        mediaRecorder.start();
        setIsListening(true);
        return;
      } catch (err) {
        console.warn("MediaRecorder mic access error, falling back to Web Speech:", err);
      }
    }

    startFallbackRecognition();
  }, [sendToGnaniSTT, startFallbackRecognition]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
      mediaRecorderRef.current = null;
    }

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
    engine,
    sttLatency,
  };
}
