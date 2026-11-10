"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Siren, CheckCircle2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FallAlertOverlayProps {
  isOpen: boolean;
  onDismiss: () => void;
  onConfirmSOS: () => void;
  lang?: "hi" | "en";
}

export function FallAlertOverlay({
  isOpen,
  onDismiss,
  onConfirmSOS,
  lang = "hi",
}: FallAlertOverlayProps) {
  const [secondsLeft, setSecondsLeft] = useState(15);

  useEffect(() => {
    if (!isOpen) {
      setSecondsLeft(15);
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onConfirmSOS();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, onConfirmSOS]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-gradient-to-b from-red-950 via-zinc-950 to-black border-2 border-red-500 rounded-2xl p-6 text-center shadow-2xl space-y-6">
        <div className="mx-auto w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center animate-pulse">
          <AlertTriangle className="h-10 w-10 text-red-500" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold text-red-400">
            {lang === "hi" ? "गिरने की आशंका का पता चला!" : "Potential Fall Detected!"}
          </h2>
          <p className="text-sm text-zinc-300">
            {lang === "hi"
              ? "सहारा ने अचानक हलचल महसूस की है। क्या आप सुरक्षित हैं?"
              : "Sahara detected a sudden fall impact. Are you alright?"}
          </p>
        </div>

        {/* Countdown Ring */}
        <div className="py-2">
          <div className="text-5xl font-black font-mono text-white tracking-widest">
            00:{secondsLeft < 10 ? `0${secondsLeft}` : secondsLeft}
          </div>
          <p className="text-xs text-red-400 mt-1 uppercase tracking-wider font-semibold">
            {lang === "hi" ? "स्वचालित 108 SOS भेजने में शेष समय" : "Auto-dispatching 108 SOS in"}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <Button
            size="lg"
            variant="destructive"
            onClick={onConfirmSOS}
            className="w-full h-13 text-base font-bold bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/30"
          >
            <Siren className="h-5 w-5 mr-2 animate-bounce" />
            {lang === "hi" ? "हाँ, मदद चाहिए (तुरंत 108 बुलाएं)" : "Yes, Need Help (Call 108 Now)"}
          </Button>

          <Button
            size="lg"
            variant="outline"
            onClick={onDismiss}
            className="w-full h-12 text-sm font-semibold border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          >
            <CheckCircle2 className="h-5 w-5 mr-2 text-emerald-400" />
            {lang === "hi" ? "मैं सुरक्षित हूँ, अलर्ट रद्द करें" : "I'm OK, Cancel Alert"}
          </Button>
        </div>
      </div>
    </div>
  );
}

