"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Users,
  QrCode,
  Phone,
  ShieldCheck,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Activity,
  Heart,
  Pill,
  Siren,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function PatientCaregiverPage() {
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [caregiverName, setCaregiverName] = useState("रोहित कुमार (Rohit Kumar)");
  const [caregiverPhone, setCaregiverPhone] = useState("+91 98765 43210");
  const [caregiverRelation, setCaregiverRelation] = useState("बेटा / Son");
  const [isLinked, setIsLinked] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);

  const pairingCode = "849-210";

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(pairingCode);
    setCopiedCode(true);
    toast.success(lang === "hi" ? "पेयरिंग कोड कॉपी हो गया!" : "Pairing code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 3000);
  };

  const handleSendWhatsAppTest = () => {
    const text = encodeURIComponent(
      lang === "hi"
        ? `[सहारा स्वास्थ्य साथी] रमेश जी ने आपको आपातकालीन केयरगिवर के रूप में जोड़ा है। पेयरिंग कोड: ${pairingCode}। लाइव ट्रैकिंग लिंक: https://swadhikaar.health/patient`
        : `[Sahara Health Companion] Ramesh ji has linked you as their primary emergency caregiver. Pairing code: ${pairingCode}. Track at: https://swadhikaar.health/patient`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
    toast.success(lang === "hi" ? "व्हाट्सएप शेयर खोला गया" : "WhatsApp share window opened");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "केयरगिवर व परिवार मंडल" : "Caregiver & Family Circle"}
              </h1>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                {isLinked ? (lang === "hi" ? "सक्रिय जुड़ा हुआ" : "Linked & Active") : "Unlinked"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "आपातकाल और स्वास्थ्य गिरावट की स्थिति में परिवार के सदस्यों को स्वचालित टेलीमेट्री अलर्ट"
                : "Continuous health telemetry & instant WhatsApp SOS alerts to family members"}
            </p>
          </div>
        </div>

        <div className="flex rounded-lg border border-border p-0.5 bg-muted/40 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setLang("hi")}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === "hi" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            हिन्दी
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
              lang === "en" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Linked Caregiver Card */}
      <Card className="border-teal-500/30 bg-gradient-to-br from-teal-950/30 via-card to-background shadow-md">
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/40 flex items-center justify-center font-bold text-lg">
              र
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground">{caregiverName}</h3>
                <Badge className="bg-teal-500/10 text-teal-300 border-teal-500/30 text-[10px]">
                  {caregiverRelation}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
                <Phone className="h-3 w-3 text-teal-400" />
                {caregiverPhone}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendWhatsAppTest}
              className="h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              {lang === "hi" ? "व्हाट्सएप टेस्ट भेजें" : "Send WhatsApp Test"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* QR Code & Pairing Section */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <QrCode className="h-4 w-4 text-teal-400" />
            {lang === "hi" ? "नया फोन या केयरगिवर जोड़ें" : "Pair Caregiver Smartphone"}
          </CardTitle>
          <CardDescription className="text-xs">
            {lang === "hi"
              ? "केयरगिवर इस QR कोड को स्कैन कर सकते हैं या नीचे दिए गए 6-अंकों के कोड का उपयोग कर सकते हैं:"
              : "Family member can scan this QR code or input the 6-digit sync pin on their device:"}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 flex flex-col md:flex-row items-center justify-around gap-6">
          {/* QR Box */}
          <div className="p-4 rounded-2xl bg-white shadow-lg flex flex-col items-center justify-center border border-zinc-200">
            <QrCode className="h-40 w-40 text-black" />
            <span className="text-[10px] text-zinc-500 font-mono mt-2 uppercase tracking-widest font-bold">
              SAHARA-PAIR-01
            </span>
          </div>

          {/* Code & Instructions */}
          <div className="space-y-4 max-w-sm text-center md:text-left">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold block">
                {lang === "hi" ? "आसान पेयरिंग कोड:" : "Quick Pairing PIN:"}
              </span>
              <div className="flex items-center justify-center md:justify-start gap-3 mt-1">
                <span className="font-mono text-3xl font-black text-teal-400 tracking-widest bg-muted/60 px-4 py-1.5 rounded-xl border border-border">
                  {pairingCode}
                </span>
                <Button size="sm" variant="outline" onClick={handleCopyCode} className="h-10 text-xs">
                  {copiedCode ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {lang === "hi"
                ? "यह कोड परिवार के सदस्य को ऐप में जोड़ेगा, जिससे उन्हें मरीज की दैनिक दवा अनुपालन, वाइटल्स गिरावट और 108 इमरजेंसी का रीयल-टाइम अलर्ट प्राप्त होगा।"
                : "This pairs the family caregiver's device, giving them real-time visibility into medication adherence, vital drops, and 108 SOS beacons."}
            </p>

            <Button
              size="sm"
              onClick={handleSendWhatsAppTest}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {lang === "hi" ? "केयरगिवर को व्हाट्सएप आमंत्रण भेजें" : "Share Pairing Link via WhatsApp"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Patient Telemetry Shared with Caregiver */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-foreground uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-teal-400" />
          {lang === "hi" ? "केयरगिवर को दिखने वाला लाइव स्वास्थ्य डेटा" : "Live Health Telemetry Visible to Caregiver"}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-1">
              <span className="text-xs text-muted-foreground block flex items-center gap-1">
                <Pill className="h-3.5 w-3.5 text-teal-400" />
                {lang === "hi" ? "आज का दवा अनुपालन" : "Today's Medication"}
              </span>
              <span className="text-2xl font-black font-mono text-teal-400">67%</span>
              <p className="text-[11px] text-muted-foreground">2 of 3 doses taken today</p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-1">
              <span className="text-xs text-muted-foreground block flex items-center gap-1">
                <Heart className="h-3.5 w-3.5 text-red-400" />
                {lang === "hi" ? "अंतिम दर्ज रक्तचाप (BP)" : "Latest Blood Pressure"}
              </span>
              <span className="text-2xl font-black font-mono text-foreground">128/84</span>
              <p className="text-[11px] text-emerald-400 font-medium">NEWS2: 0 · Normal range</p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-1">
              <span className="text-xs text-muted-foreground block flex items-center gap-1">
                <Siren className="h-3.5 w-3.5 text-amber-400" />
                {lang === "hi" ? "आपातकालीन स्थिति" : "Emergency Status"}
              </span>
              <span className="text-2xl font-black font-mono text-emerald-400">READY</span>
              <p className="text-[11px] text-muted-foreground">108 CAD Auto-Relay Enabled</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

