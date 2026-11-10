"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Heart, Play, Square, Volume2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { speak } from "@/lib/speak";

interface CprMetronomeProps {
  lang?: "en" | "hi";
  onCycleComplete?: (cycle: number) => void;
}

export default function CprMetronome({ lang = "hi", onCycleComplete }: CprMetronomeProps) {
  const [isActive, setIsActive] = useState(false);
  const [bpm, setBpm] = useState(105); // 100-120 BPM AHA standard
  const [beatCount, setBeatCount] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [pulseScale, setPulseScale] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<any>(null);

  // Play crisp acoustic click
  const playClick = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Higher pitch for first beat of cycle
      osc.frequency.value = beatCount % 30 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Audio not permitted yet
    }
  }, [beatCount]);

  const tick = useCallback(() => {
    setBeatCount((prev) => {
      const next = prev + 1;
      if (next >= 30) {
        setCycleCount((c) => {
          const nextCycle = c + 1;
          if (onCycleComplete) onCycleComplete(nextCycle);
          return nextCycle;
        });
        return 0;
      }
      return next;
    });

    setPulseScale(true);
    setTimeout(() => setPulseScale(false), 120);
    playClick();
  }, [playClick, onCycleComplete]);

  useEffect(() => {
    if (isActive) {
      const intervalMs = (60 / bpm) * 1000;
      timerRef.current = setInterval(tick, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, bpm, tick]);

  const toggleMetronome = () => {
    if (!isActive) {
      setIsActive(true);
      setBeatCount(0);
      // Speak audio guidance in Hindi/English
      const guidance =
        lang === "hi"
          ? "छाती के बीच में दोनों हाथों से जोर से और तेजी से दबाएं। बीट के साथ गति बनाए रखें।"
          : "Push hard and fast in the center of the chest. Match the audio beat.";
      speak(guidance, lang);
    } else {
      setIsActive(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-rose-500/40 bg-gradient-to-b from-rose-950/40 to-slate-900 p-5 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between pb-3 border-b border-rose-800/40">
        <div className="flex items-center gap-2">
          <Heart className="size-5 text-rose-500 animate-pulse" />
          <span className="font-bold text-sm tracking-wide uppercase text-rose-300">
            {lang === "hi" ? "सीपीआर गाइड और मेट्रोनोम" : "CPR Metronome & Guide"}
          </span>
        </div>
        <span className="text-[11px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full">
          {bpm} BPM (AHA Standard)
        </span>
      </div>

      <div className="py-6 flex flex-col items-center justify-center">
        {/* Pulsing Cardiac Core */}
        <div
          className={`relative size-28 rounded-full flex flex-col items-center justify-center transition-transform duration-100 cursor-pointer shadow-lg ${
            pulseScale ? "scale-110 bg-rose-500 shadow-rose-500/50" : "scale-100 bg-rose-600/80 shadow-rose-900/50"
          }`}
          onClick={toggleMetronome}
        >
          <Heart className="size-10 text-white fill-current" />
          <div className="font-mono font-bold text-lg text-white mt-1">
            {beatCount === 0 && cycleCount > 0 ? "30" : beatCount || "START"}
          </div>
          {isActive && (
            <span className="absolute inset-0 rounded-full border-2 border-rose-400 animate-ping opacity-75" />
          )}
        </div>

        <div className="mt-4 text-center">
          <div className="text-xs text-rose-200 font-medium">
            {isActive
              ? lang === "hi"
                ? `दबाव: ${beatCount}/30 • चक्र पूरा: ${cycleCount}`
                : `Compressions: ${beatCount}/30 • Completed Cycles: ${cycleCount}`
              : lang === "hi"
              ? "शुरू करने के लिए दिल पर टैप करें या नीचे बटन दबाएं"
              : "Tap heart to start rhythm guide"}
          </div>
          {beatCount >= 28 && (
            <div className="mt-2 text-xs font-bold text-amber-300 bg-amber-950/60 border border-amber-500/40 px-3 py-1 rounded-full animate-bounce">
              {lang === "hi" ? "2 सांसें दें (30 दबाव के बाद)" : "Give 2 rescue breaths after 30"}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={toggleMetronome}
          className={`w-full font-bold text-xs h-10 rounded-xl ${
            isActive
              ? "bg-rose-700 hover:bg-rose-800 text-white"
              : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/30"
          }`}
        >
          {isActive ? (
            <>
              <Square className="size-4 mr-1.5 fill-current" />
              {lang === "hi" ? "मेट्रोनोम रोकें" : "Stop Metronome"}
            </>
          ) : (
            <>
              <Play className="size-4 mr-1.5 fill-current" />
              {lang === "hi" ? "मेट्रोनोम शुरू करें (105 BPM)" : "Start CPR Metronome"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

