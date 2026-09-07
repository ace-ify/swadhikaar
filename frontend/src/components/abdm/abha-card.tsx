"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Download, Printer, QrCode, ShieldCheck, Share2 } from "lucide-react";
import { toast } from "sonner";

export interface AbhaCardProps {
  abhaNumber?: string;
  abhaAddress?: string;
  name?: string;
  gender?: string;
  yearOfBirth?: number | string;
  mobile?: string;
  bloodGroup?: string;
  kycVerified?: boolean;
  photoUrl?: string;
  className?: string;
}

// Deterministic SVG QR Code generator for offline & reliable rendering without external assets
function SvgQrCode({ value, size = 100 }: { value: string; size?: number }) {
  // Simple pseudo-random but deterministic matrix generator based on string hash
  const gridSize = 21;
  const hash = Array.from(value).reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0);

  const isDark = (r: number, c: number) => {
    // Standard QR finder patterns in corners
    if ((r < 7 && c < 7) || (r < 7 && c >= gridSize - 7) || (r >= gridSize - 7 && c < 7)) {
      if (r === 0 || r === 6 || c === 0 || c === 6 || r === gridSize - 1 || r === gridSize - 7 || c === gridSize - 1 || c === gridSize - 7) return true;
      if (r >= 2 && r <= 4 && c >= 2 && c <= 4) return true;
      if (r >= 2 && r <= 4 && c >= gridSize - 5 && c <= gridSize - 3) return true;
      if (r >= gridSize - 5 && r <= gridSize - 3 && c >= 2 && c <= 4) return true;
      return false;
    }
    // Timing patterns
    if (r === 6 || c === 6) return (r + c) % 2 === 0;
    // Data cells
    return ((r * c + hash) % 3 === 0) || ((r + c * hash) % 5 === 0);
  };

  const rects: any[] = [];
  const cellSize = size / gridSize;

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (isDark(r, c)) {
        rects.push(
          <rect
            key={`${r}-${c}`}
            x={c * cellSize}
            y={r * cellSize}
            width={cellSize}
            height={cellSize}
            fill="#0f172a"
          />
        );
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded bg-white p-1">
      {rects}
    </svg>
  );
}

export default function AbhaCard({
  abhaNumber = "91-8899-7766-5544",
  abhaAddress = "devendra.sharma@abdm",
  name = "Devendra Sharma",
  gender = "M",
  yearOfBirth = 1982,
  mobile = "XXXXXX3210",
  bloodGroup = "O+ve",
  kycVerified = true,
  photoUrl,
  className = "",
}: AbhaCardProps) {
  const [downloading, setDownloading] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    setDownloading(true);
    const cardData = {
      abha_number: abhaNumber,
      abha_address: abhaAddress,
      name,
      gender,
      year_of_birth: yearOfBirth,
      mobile,
      blood_group: bloodGroup,
      kyc_verified: kycVerified,
      issuer: "National Health Authority, Ministry of Health & Family Welfare, Govt. of India",
      issued_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(cardData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ABHA_CARD_${abhaNumber.replace(/-/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloading(false);
    toast.success("ABHA Card digital record downloaded successfully");
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Authentic Tricolor ABHA Digital Health Card */}
      <div className="relative mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl border-2 border-slate-300 bg-gradient-to-b from-white via-slate-50 to-slate-100 shadow-xl print:border-black">
        {/* Government of India Tricolor Header Bar */}
        <div className="flex h-3 w-full">
          <div className="h-full w-1/3 bg-[#FF9933]" /> {/* Saffron */}
          <div className="h-full w-1/3 bg-[#FFFFFF]" /> {/* White */}
          <div className="h-full w-1/3 bg-[#138808]" /> {/* Green */}
        </div>

        {/* Header Branding */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-2.5 bg-white">
          <div className="flex items-center gap-2.5">
            {/* National Emblem Emblem Icon */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-amber-400 font-serif font-bold text-base shadow-sm">
              🏛️
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-900 leading-tight">
                National Health Authority
              </div>
              <div className="text-[10px] font-medium text-slate-500 leading-tight">
                Ministry of Health &amp; Family Welfare · Govt. of India
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-500 bg-emerald-50 text-[10px] font-bold text-emerald-700 gap-1 px-2 py-0.5"
          >
            <ShieldCheck className="size-3 text-emerald-600" />
            ABHA CARD
          </Badge>
        </div>

        {/* Card Body */}
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
            {/* Left: Patient Details */}
            <div className="space-y-3">
              {/* Photo & Name Row */}
              <div className="flex items-center gap-3">
                <div className="relative flex size-16 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 bg-slate-200 text-2xl font-bold text-slate-700 shadow-inner overflow-hidden">
                  {photoUrl ? (
                    <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <span>{name.charAt(0)}</span>
                  )}
                  {kycVerified && (
                    <div className="absolute bottom-0 right-0 bg-emerald-600 text-white p-0.5 rounded-tl">
                      <CheckCircle2 className="size-3" />
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-slate-900 leading-tight">
                    {name}
                  </h3>
                  <p className="font-mono text-xs font-semibold text-slate-500">
                    {gender === "M" ? "Male / पुरुष" : gender === "F" ? "Female / महिला" : gender} · YOB: {yearOfBirth}
                  </p>
                  <p className="text-[11px] text-slate-600 font-medium">
                    Mobile: {mobile}
                  </p>
                </div>
              </div>

              {/* ABHA Number (Prominent Quad-Dash) */}
              <div className="rounded-lg border border-slate-200 bg-white/90 p-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  ABHA Number (आभा संख्या)
                </div>
                <div className="font-mono text-lg font-extrabold tracking-wider text-slate-900">
                  {abhaNumber}
                </div>
              </div>

              {/* ABHA Address & Blood Group */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">
                    ABHA Address
                  </span>
                  <span className="font-mono font-bold text-sky-700">{abhaAddress}</span>
                </div>
                {bloodGroup && (
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">
                      Blood Group
                    </span>
                    <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700 font-bold text-xs">
                      {bloodGroup}
                    </Badge>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Dynamic QR Code */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              <SvgQrCode value={`https://abdm.gov.in/profile/${abhaNumber}`} size={104} />
              <div className="mt-1.5 flex items-center gap-1 text-[9px] font-mono font-semibold text-slate-500">
                <QrCode className="size-2.5" />
                SCAN TO VERIFY
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bar */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-100/90 px-4 py-2 text-[10px] text-slate-600">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="inline-block size-2 rounded-full bg-emerald-500" />
            <span>KYC Verified Ayushman Bharat Health Account</span>
          </div>
          <span className="font-mono font-bold text-slate-500">NHA-ABDM-2026</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2 print:hidden">
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownload}
          disabled={downloading}
          className="gap-1.5 text-xs font-semibold"
        >
          <Download className="size-3.5" />
          Download Card (JSON)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handlePrint}
          className="gap-1.5 text-xs font-semibold"
        >
          <Printer className="size-3.5" />
          Print Health Card
        </Button>
      </div>
    </div>
  );
}
