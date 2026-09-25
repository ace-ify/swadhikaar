"use client";

/**
 * Shared browser text-to-speech (Web Speech API). One home for "say this out loud"
 * so the medication readback (and, later, the kiosk intake and wellbeing check that
 * currently hand-roll it) don't each re-implement speechSynthesis. Zero-latency,
 * offline, no cost; picks a Hindi / Indian-English voice when the device has one.
 */
export function speak(text: string, lang: "en" | "hi" = "en") {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    u.rate = 0.95; // slower for elderly / low-literacy comprehension
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        (lang === "hi" && (v.lang.includes("hi") || v.name.toLowerCase().includes("hindi"))) ||
        (lang === "en" && (v.lang.includes("en-IN") || v.name.toLowerCase().includes("india")))
    );
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is a nicety; never throw into the UI */
  }
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}
