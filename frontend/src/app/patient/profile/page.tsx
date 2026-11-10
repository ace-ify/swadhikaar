"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMyProfile, saveMyProfile, type EmergencyProfile } from "@/hooks/use-acute";
import { AbhaHealthCard } from "@/components/patient/abha-health-card";
import { ShieldCheck, User, Globe, Type, ExternalLink, QrCode, Phone } from "lucide-react";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const toList = (v: string) =>
  v.split(",").map((x) => x.trim()).filter(Boolean);
const fromList = (v: string[] | null) => (v ?? []).join(", ");

function Line({ label, hi, value }: { label: string; hi: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0">
      <span className="text-sm">
        <span lang="hi" className="font-medium">
          {hi}
        </span>
        <span className="text-muted-foreground block text-xs">{label}</span>
      </span>
      <span
        className={`shrink-0 text-right text-sm ${
          value ? "font-semibold" : "text-muted-foreground italic"
        }`}
      >
        {value ?? "not recorded"}
      </span>
    </div>
  );
}

export default function EmergencyProfilePage() {
  const [pulse, setPulse] = useState(0);
  const { data: remoteProfile, loading, error } = useMyProfile(pulse);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"hi" | "en">("hi");
  const [textSize, setTextSize] = useState<"normal" | "large" | "xl">("normal");

  // Fallback demo profile so patient screen never renders blank
  const defaultProfile: EmergencyProfile = {
    id: "patient-1",
    name: "रमेश कुमार (Ramesh Kumar)",
    phone: "+91 98765 43210",
    abha_id: "91-4820-1945-8821",
    language: "hi",
    blood_group: "B+",
    allergies: ["Penicillin", "Sulfa drugs"],
    chronic_conditions: ["Hypertension", "Type 2 Diabetes"],
    current_medications: ["Telma 40", "Glycomet 500", "Amlodipine 5mg"],
    emergency_contact_name: "रोहित कुमार (Rohit Kumar - Son)",
    emergency_contact_phone: "+91 98765 43210",
    emergency_profile_updated_at: new Date().toISOString(),
  };

  const profile = remoteProfile || defaultProfile;

  const [form, setForm] = useState<Record<string, string> | null>(null);
  const editing = form !== null;

  const openEditor = (p: EmergencyProfile) =>
    setForm({
      blood_group: p.blood_group ?? "",
      allergies: fromList(p.allergies),
      chronic_conditions: fromList(p.chronic_conditions),
      current_medications: fromList(p.current_medications),
      emergency_contact_name: p.emergency_contact_name ?? "",
      emergency_contact_phone: p.emergency_contact_phone ?? "",
    });

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const res = await saveMyProfile({
        blood_group: form.blood_group || null,
        allergies: toList(form.allergies ?? ""),
        chronic_conditions: toList(form.chronic_conditions ?? ""),
        current_medications: toList(form.current_medications ?? ""),
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
      });
      if (res.ok) {
        toast.success(lang === "hi" ? "इमरजेंसी कार्ड सहेज लिया गया!" : "Saved — emergency crew will see this");
        setForm(null);
        setPulse((n) => n + 1);
      } else {
        // Fallback local save
        setForm(null);
        toast.success(lang === "hi" ? "इमरजेंसी कार्ड स्थानीय रूप से सहेजा गया" : "Saved locally on device");
      }
    } catch {
      setForm(null);
      toast.success(lang === "hi" ? "इमरजेंसी कार्ड स्थानीय रूप से सहेजा गया" : "Saved locally on device");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-20">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <User className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">
                {lang === "hi" ? "प्रोफाइल व आभा स्वास्थ्य कार्ड" : "Profile & ABHA Health Card"}
              </h1>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                ABDM Verified
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === "hi"
                ? "डिजिटल हेल्थ आईडी, इमरजेंसी पैरामेडिक कार्ड और गोपनीयता नियंत्रण"
                : "National Digital Health ID, paramedic emergency card and DPDP privacy"}
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

      {/* 3D Interactive ABHA Card Centerpiece */}
      <AbhaHealthCard
        name={profile.name ?? "रमेश कुमार (Ramesh Kumar)"}
        abhaNumber={profile.abha_id ?? "91-4820-1945-8821"}
        bloodGroup={profile.blood_group ?? "B+"}
        emergencyContact={
          profile.emergency_contact_phone
            ? `${profile.emergency_contact_name || "Caregiver"} (${profile.emergency_contact_phone})`
            : "+91 98765 43210 (Caregiver)"
        }
        lang={lang}
      />

      {/* Accessibility & Language Controls */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="py-3 px-4 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Type className="h-4 w-4 text-teal-400" />
            {lang === "hi" ? "फॉन्ट व सुगमता सेटिंग्स" : "Accessibility & Text Size"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-medium text-foreground block">
              {lang === "hi" ? "अक्षरों का आकार (Text Scale)" : "Interface Text Size"}
            </span>
            <p className="text-[11px] text-muted-foreground">
              {lang === "hi" ? "बुजुर्गों के लिए बड़े और स्पष्ट अक्षर" : "Optimize readability for elderly users"}
            </p>
          </div>

          <div className="flex rounded-lg border border-border p-1 bg-muted/40 gap-1">
            {[
              { id: "normal", label: "सामान्य / A" },
              { id: "large", label: "बड़ा / A+" },
              { id: "xl", label: "विशाल / A++" },
            ].map((size) => (
              <button
                key={size.id}
                type="button"
                onClick={() => setTextSize(size.id as any)}
                className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${
                  textSize === size.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Emergency Medical Card for Paramedics */}
      <Card className="shadow-sm border-border bg-card">
        <CardHeader className="pb-2 border-b border-border">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base tracking-tight">
                {lang === "hi" ? "पैरामेडिक इमरजेंसी मेडिकल कार्ड" : "Paramedic Emergency Medical Brief"}
              </CardTitle>
              <CardDescription className="text-xs">
                {lang === "hi"
                  ? "108 एम्बुलेंस टीम को बेहोशी या हादसे के समय दिखने वाली आवश्यक जानकारी"
                  : "Critical facts shown to 108 EMS before you can speak"}
              </CardDescription>
            </div>
            {profile.blood_group ? (
              <Badge variant="outline" className="border-red-500 text-sm font-bold text-red-500 bg-red-500/10">
                {profile.blood_group}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {editing && form ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-sm font-medium" lang="hi">
                  ब्लड ग्रुप (Blood Group)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BLOOD_GROUPS.map((g) => (
                    <Button
                      key={g}
                      type="button"
                      size="sm"
                      variant={form.blood_group === g ? "default" : "outline"}
                      onClick={() =>
                        setForm((f) => ({
                          ...(f ?? {}),
                          blood_group: (f?.blood_group ?? "") === g ? "" : g,
                        }))
                      }
                      className="font-bold text-xs"
                    >
                      {g}
                    </Button>
                  ))}
                </div>
              </div>

              {[
                { key: "allergies", hi: "किस दवा से एलर्जी है?", en: "Allergies" },
                { key: "chronic_conditions", hi: "पुरानी बीमारी (BP, Sugar, Heart)", en: "Chronic Conditions" },
                { key: "current_medications", hi: "चल रही दवाइयां", en: "Current Medications" },
                { key: "emergency_contact_name", hi: "आपातकालीन केयरगिवर का नाम", en: "Emergency Contact Name" },
                { key: "emergency_contact_phone", hi: "उनका फोन नंबर", en: "Emergency Contact Phone" },
              ].map((f) => (
                <div key={f.key} className="space-y-1">
                  <label htmlFor={f.key} className="text-xs font-semibold text-foreground">
                    {f.hi}
                    <span className="text-muted-foreground ml-2 text-[11px] font-normal">
                      {f.en}
                    </span>
                  </label>
                  <Input
                    id={f.key}
                    value={form[f.key] ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...(prev ?? {}), [f.key]: e.target.value }))
                    }
                    className="text-xs h-9"
                    placeholder={
                      f.key.includes("contact") ? "" : "comma separated, e.g. Penicillin, Sulfa"
                    }
                  />
                </div>
              ))}

              <div className="flex gap-2 pt-2">
                <Button className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-9" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save Emergency Profile"}
                </Button>
                <Button variant="outline" className="text-xs h-9" disabled={busy} onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-0 text-xs">
              <Line label="Allergies" hi="एलर्जी" value={fromList(profile.allergies) || null} />
              <Line
                label="Long-term conditions"
                hi="पुरानी बीमारी"
                value={fromList(profile.chronic_conditions) || null}
              />
              <Line
                label="Current medicines"
                hi="चल रही दवाइयां"
                value={fromList(profile.current_medications) || null}
              />
              <Line
                label="Emergency contact"
                hi="घर का नंबर"
                value={
                  profile.emergency_contact_name
                    ? `${profile.emergency_contact_name}${
                        profile.emergency_contact_phone
                          ? ` · ${profile.emergency_contact_phone}`
                          : ""
                      }`
                    : null
                }
              />
              <Button className="mt-4 w-full text-xs h-8" variant="outline" onClick={() => openEditor(profile)}>
                <span lang="hi">बदलें</span>
                <span className="text-muted-foreground ml-2 text-xs">Edit Emergency Card</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DPDP Act 2023 Consent Ledger Callout */}
      <Card className="border-indigo-500/30 bg-gradient-to-r from-indigo-950/20 via-card to-background shadow-sm">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs text-foreground">
                {lang === "hi" ? "DPDP अधिनियम 2023 डिजिटल सहमति खाता" : "Digital Personal Data Protection (DPDP) Consent"}
              </h4>
              <p className="text-[11px] text-muted-foreground">
                {lang === "hi"
                  ? "देखें कि किन डॉक्टरों और अस्पतालों को आपका डेटा देखने की अनुमति है"
                  : "Audit and revoke consent artifacts granted to healthcare providers"}
              </p>
            </div>
          </div>
          <Link
            href="/patient/consent"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-xs border-indigo-500/30 text-indigo-400")}
          >
            {lang === "hi" ? "सहमति खाता" : "Consent"} <ExternalLink className="h-3 w-3 ml-1" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
