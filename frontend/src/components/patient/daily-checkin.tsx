"use client";

import React, { useState } from "react";
import { Sparkles, Smile, Frown, AlertCircle, HeartHandshake, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface DailyCheckInProps {
  userName?: string;
  lang?: "hi" | "en";
  onSelectMood: (mood: string, hiText: string) => void;
}

export function DailyCheckInCard({
  userName = "रमेश जी",
  lang = "hi",
  onSelectMood,
}: DailyCheckInProps) {
  const [completed, setCompleted] = useState(false);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);

  const moodOptions = [
    { id: "good", emoji: "😊", labelHi: "अच्छा महसूस हो रहा है", labelEn: "Feeling Good", color: "hover:border-emerald-500/50 hover:bg-emerald-500/10" },
    { id: "tired", emoji: "🥱", labelHi: "थोड़ी थकावट है", labelEn: "Tired / Weak", color: "hover:border-amber-500/50 hover:bg-amber-500/10" },
    { id: "pain", emoji: "😣", labelHi: "शरीर में दर्द / बेचैनी", labelEn: "In Pain / Discomfort", color: "hover:border-red-500/50 hover:bg-red-500/10" },
    { id: "dizzy", emoji: "😵", labelHi: "चक्कर या सिर भारी है", labelEn: "Dizziness / Headache", color: "hover:border-purple-500/50 hover:bg-purple-500/10" },
  ];

  const handleSelect = (option: typeof moodOptions[0]) => {
    setSelectedMood(option.id);
    setCompleted(true);
    onSelectMood(option.labelEn, option.labelHi);
  };

  if (completed) {
    return (
      <Card className="border-teal-500/30 bg-teal-950/20 shadow-sm">
        <CardContent className="p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-teal-400" />
            <span className="text-xs font-medium text-foreground">
              {lang === "hi"
                ? "आज का दैनिक स्वास्थ्य चेक-इन पूरा हुआ! सहारा आपकी देखभाल कर रहा है।"
                : "Today's daily health check-in completed! Sahara is monitoring."}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setCompleted(false)} className="h-6 text-[11px] text-teal-400">
            {lang === "hi" ? "बदलें" : "Update"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-card via-card to-primary/5 shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <h4 className="font-semibold text-sm text-foreground">
              {lang === "hi" ? `नमस्ते ${userName}! आज आप कैसा महसूस कर रहे हैं?` : `Hello ${userName}! How are you feeling today?`}
            </h4>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase font-semibold">Daily Check-in</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {moodOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt)}
              className={`flex items-center gap-2 p-2.5 rounded-lg border border-border/80 bg-background/60 text-left transition-all ${opt.color}`}
            >
              <span className="text-xl">{opt.emoji}</span>
              <span className="text-xs font-medium text-foreground leading-snug">
                {lang === "hi" ? opt.labelHi : opt.labelEn}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

