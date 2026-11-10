"use client";

import React, { useState } from "react";
import { ShieldCheck, QrCode, Phone, Heart, RotateCw, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface AbhaCardProps {
  abhaNumber?: string;
  name?: string;
  age?: number;
  gender?: string;
  bloodGroup?: string;
  emergencyContact?: string;
  lang?: "hi" | "en";
}

export function AbhaHealthCard({
  abhaNumber = "91-4820-1945-8821",
  name = "रमेश कुमार (Ramesh Kumar)",
  age = 58,
  gender = "Male",
  bloodGroup = "B+ve",
  emergencyContact = "+91 98765 43210 (Caregiver)",
  lang = "hi",
}: AbhaCardProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center select-none py-2">
      {/* 3D Perspective Card Container */}
      <div
        className="relative w-full max-w-[380px] h-[220px] cursor-pointer group"
        style={{ perspective: "1200px" }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="relative w-full h-full duration-700 transition-all rounded-2xl shadow-xl"
          style={{
            transformStyle: "preserve-3d",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* FRONT SIDE */}
          <div
            className="absolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-900 via-slate-900 to-zinc-950 border border-teal-500/40 text-white shadow-2xl backface-hidden"
            style={{ backfaceVisibility: "hidden" }}
          >
            {/* Background Holographic Sheen */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-teal-500/10 blur-2xl pointer-events-none" />

            {/* Header: National Health Authority / Sahara */}
            <div className="flex items-center justify-between border-b border-teal-500/20 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-400/40 flex items-center justify-center">
                  <ShieldCheck className="h-4 w-4 text-teal-300" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-teal-200">
                    {lang === "hi" ? "राष्ट्रीय डिजिटल स्वास्थ्य कार्ड" : "National Digital Health Card"}
                  </h4>
                  <p className="text-[10px] text-teal-400 font-mono">ABDM / SAHĀRĀ VERIFIED</p>
                </div>
              </div>
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] font-mono">
                PM-JAY ACTIVE
              </Badge>
            </div>

            {/* Middle: Patient Info & Chip */}
            <div className="flex items-center justify-between my-1">
              <div className="space-y-1">
                <h3 className="font-bold text-base text-white tracking-tight">{name}</h3>
                <div className="flex items-center gap-3 text-xs text-zinc-300">
                  <span>{age} Yrs · {gender}</span>
                  <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold text-[10px]">
                    {bloodGroup}
                  </span>
                </div>
              </div>

              {/* Smart Gold Chip */}
              <div className="w-10 h-8 rounded bg-gradient-to-tr from-amber-400 to-amber-200 border border-amber-500 shadow-inner flex flex-col justify-around p-1 opacity-90">
                <div className="w-full h-0.5 bg-amber-700/40" />
                <div className="w-full h-0.5 bg-amber-700/40" />
              </div>
            </div>

            {/* Bottom: ABHA Number & Tap Hint */}
            <div className="flex items-end justify-between pt-2 border-t border-teal-500/20">
              <div>
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest block font-medium">ABHA Number</span>
                <span className="font-mono text-sm font-black text-teal-300 tracking-wider">
                  {abhaNumber}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-teal-400/80 group-hover:text-teal-300 font-medium">
                <RotateCw className="h-3 w-3 animate-spin" />
                <span>{lang === "hi" ? "QR देखने हेतु टैप करें" : "Tap for QR"}</span>
              </div>
            </div>
          </div>

          {/* BACK SIDE */}
          <div
            className="absolute inset-0 w-full h-full rounded-2xl p-5 flex flex-col justify-between overflow-hidden bg-gradient-to-br from-zinc-950 via-slate-900 to-teal-950 border border-teal-500/40 text-white shadow-2xl"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <div className="flex items-center justify-between border-b border-teal-500/20 pb-2">
              <span className="text-xs font-semibold text-zinc-300">
                {lang === "hi" ? "अस्पताल ओपीडी चेक-इन क्यूआर" : "Hospital OPD Fast Check-in"}
              </span>
              <span className="text-[10px] text-teal-400 font-mono">ENCRYPTED DPDP-2023</span>
            </div>

            {/* QR Code and Emergency Contact */}
            <div className="flex items-center gap-4 my-2">
              {/* High Fidelity QR Box */}
              <div className="p-2 rounded-xl bg-white shadow-md flex items-center justify-center">
                <QrCode className="h-20 w-20 text-black" />
              </div>

              <div className="space-y-1.5 flex-1 text-xs">
                <div>
                  <span className="text-[10px] text-zinc-400 block">Emergency Contact</span>
                  <p className="font-semibold text-zinc-200 flex items-center gap-1 mt-0.5">
                    <Phone className="h-3 w-3 text-emerald-400" />
                    {emergencyContact}
                  </p>
                </div>
                <div className="pt-1">
                  <span className="text-[10px] text-zinc-400 block">Primary Care Centre</span>
                  <p className="text-[11px] text-zinc-300 font-medium">CH Centre · Block 4 (Rural)</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-400 border-t border-teal-500/20 pt-2">
              <span>Scan at any Ayushman Arogya Mandir</span>
              <div className="flex items-center gap-1 text-teal-400 font-medium">
                <RotateCw className="h-3 w-3" />
                <span>{lang === "hi" ? "वापस पलटें" : "Flip back"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

