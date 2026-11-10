"use client";

/**
 * Indic Voice Engine powered by Gnani.ai Timbre v3.0, with browser SpeechSynthesis fallback.
 * Central home for all voice read-back across Swadhikaar (Prescription schedule, Kiosk intake, PM-JAY).
 */

let currentAudio: HTMLAudioElement | null = null;

export interface SpeakOptions {
  voice?: string;
  speed?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

export async function speak(
  text: string,
  lang: "en" | "hi" | "ta" | "bn" = "hi",
  options?: SpeakOptions
) {
  if (typeof window === "undefined" || !text.trim()) return;

  stopSpeaking();

  const bcp47Map: Record<string, string> = {
    hi: "hi-IN",
    ta: "ta-IN",
    bn: "bn-IN",
    en: "en-IN",
  };
  const bcp47 = bcp47Map[lang] || "hi-IN";

  // 1. Try Gnani.ai Timbre v3.0 REST synthesis first (High-fidelity Sovereign Indic TTS)
  try {
    const res = await fetch("/api/gnani/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.trim(),
        language: bcp47,
        voice: options?.voice,
        speed: options?.speed || 1.0,
      }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudio = audio;

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("gnani-voice-event", {
            detail: {
              active: true,
              engine: "Gnani.ai Timbre v3.0",
              language: bcp47,
              text,
            },
          })
        );
      }

      if (options?.onStart) options.onStart();

      audio.onended = () => {
        currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("gnani-voice-event", {
              detail: { active: false, engine: "Gnani.ai Timbre v3.0" },
            })
          );
        }
        if (options?.onEnd) options.onEnd();
      };

      audio.onerror = () => {
        currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        fallbackBrowserSpeak(text, bcp47, options);
      };

      await audio.play();
      return;
    }
  } catch (err) {
    console.warn("Gnani Timbre TTS failed, falling back to browser speech:", err);
  }

  // 2. Fallback to Web Speech API if offline or API failure
  fallbackBrowserSpeak(text, bcp47, options);
}

function fallbackBrowserSpeak(
  text: string,
  bcp47: string,
  options?: SpeakOptions
) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;

  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = bcp47;
    u.rate = options?.speed ? options.speed * 0.95 : 0.95;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        (bcp47.startsWith("hi") &&
          (v.lang.includes("hi") || v.name.toLowerCase().includes("hindi"))) ||
        (bcp47.startsWith("ta") &&
          (v.lang.includes("ta") || v.name.toLowerCase().includes("tamil"))) ||
        (bcp47.startsWith("bn") &&
          (v.lang.includes("bn") || v.name.toLowerCase().includes("bengali"))) ||
        (bcp47.startsWith("en") &&
          (v.lang.includes("en-IN") || v.name.toLowerCase().includes("india")))
    );
    if (preferred) u.voice = preferred;

    u.onstart = () => {
      if (options?.onStart) options.onStart();
    };

    u.onend = () => {
      if (options?.onEnd) options.onEnd();
    };

    u.onerror = () => {
      if (options?.onEnd) options.onEnd();
    };

    window.speechSynthesis.speak(u);
  } catch {
    /* speech is a nicety; never throw into the UI */
  }
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof window !== "undefined") {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    window.dispatchEvent(
      new CustomEvent("gnani-voice-event", {
        detail: { active: false },
      })
    );
  }
}
