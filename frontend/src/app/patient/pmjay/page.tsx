"use client";

// PM-JAY Hospital Readiness finder. Patient picks their district + the kind of
// care they need; we show matching EMPANELLED hospitals from the official data, the
// documents to carry, and the visit steps. Information only — eligibility lives on the
// official NHA portal we deep-link to.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, Building2, ShieldCheck, FileText, ListChecks, ExternalLink, Languages, Hospital, Volume2, Navigation, Share2, MapPin, LocateFixed } from "lucide-react";
import { usePmjayLocations, usePmjayHospitals } from "@/hooks/use-pmjay";
import { CARE_NEEDS, matchesCareNeed } from "@/lib/pmjay/specialties";
import { speak } from "@/lib/speak";
import { toast } from "sonner";
import { PmjayAskBox } from "@/components/pmjay/ask-box";
import {
  PMJAY_ABOUT,
  PMJAY_DOCUMENTS,
  PMJAY_VISIT_STEPS,
  PMJAY_ELIGIBILITY_URL,
  PMJAY_CALL_CENTRE,
} from "@/lib/pmjay/readiness";
import { fetchRoadRoute } from "@/lib/pmjay/route-osrm";

const HospitalMap = dynamic(() => import("@/components/pmjay/hospital-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center rounded-xl border text-xs text-muted-foreground">Loading map…</div>
  ),
});

type Lang = "en" | "hi";

export default function PmjayReadinessPage() {
  const [lang, setLang] = useState<Lang>("hi");
  const [district, setDistrict] = useState<string>("");
  const [careNeed, setCareNeed] = useState<string>("");
  const [forName, setForName] = useState<string>("");
  const [patientLoc, setPatientLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const { locations, loading: locLoading } = usePmjayLocations();
  const { hospitals, loading } = usePmjayHospitals(district || null);

  const filtered = useMemo(
    () => (careNeed ? hospitals.filter((h) => matchesCareNeed(h.specialities, careNeed)) : hospitals),
    [hospitals, careNeed]
  );
  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);
  const asOn = hospitals.find((h) => h.as_on)?.as_on;
  const mapHospitals = useMemo(
    () =>
      filtered
        .filter((h) => h.lat != null && h.lon != null)
        .map((h) => ({ id: h.id, name: h.name, lat: h.lat as number, lon: h.lon as number, geo_source: h.geo_source, hospital_type: h.hospital_type })),
    [filtered]
  );

  const speakReadiness = () => {
    const docs = PMJAY_DOCUMENTS.map((d) => t(d.en, d.hi)).join(". ");
    const steps = PMJAY_VISIT_STEPS.map((s, i) => `${i + 1}. ${t(s.en, s.hi)}`).join(". ");
    speak(
      `${t("Documents to carry:", "साथ ले जाने योग्य दस्तावेज़:")} ${docs}. ${t("At the hospital:", "अस्पताल में:")} ${steps}`,
      lang
    );
  };
  const directionsUrl = (h: { name: string; district: string | null; state: string | null }) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([h.name, h.district, h.state].filter(Boolean).join(" "))}`;

  // Caregiver / ASHA handoff: build a full readiness plan as text to share with the
  // patient's family (WhatsApp/SMS), personalised with the name if given.
  const buildPlanText = () => {
    const lines: string[] = [];
    lines.push(forName ? t(`PM-JAY readiness plan for ${forName}`, `${forName} के लिए PM-JAY तैयारी योजना`) : t("PM-JAY readiness plan", "PM-JAY तैयारी योजना"));
    if (district) {
      const care = careNeed ? CARE_NEEDS.find((c) => c.id === careNeed) : null;
      lines.push("", t(`District: ${district}`, `ज़िला: ${district}`) + (care ? ` · ${t(care.en, care.hi)}` : ""));
      const top = filtered.slice(0, 5);
      if (top.length) {
        lines.push(t("Empanelled hospitals:", "सूचीबद्ध अस्पताल:"));
        top.forEach((h, i) => lines.push(`${i + 1}. ${h.name}${h.hospital_type ? ` (${h.hospital_type})` : ""}${h.phone ? ` — ${h.phone}` : ""}`));
      }
    }
    lines.push("", t("Documents to carry:", "साथ ले जाने योग्य दस्तावेज़:"));
    PMJAY_DOCUMENTS.forEach((d) => lines.push(`- ${t(d.en, d.hi)}`));
    lines.push("", t("At the hospital:", "अस्पताल में:"));
    PMJAY_VISIT_STEPS.forEach((s, i) => lines.push(`${i + 1}. ${t(s.en, s.hi)}`));
    lines.push("", t(`Information only, not an eligibility decision. Check eligibility: ${PMJAY_ELIGIBILITY_URL} or call ${PMJAY_CALL_CENTRE}.`, `केवल जानकारी, पात्रता निर्णय नहीं। पात्रता जाँचें: ${PMJAY_ELIGIBILITY_URL} या ${PMJAY_CALL_CENTRE} पर कॉल करें।`));
    return lines.join("\n");
  };
  const sharePlan = async () => {
    const text = buildPlanText();
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "PM-JAY readiness plan", text });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.success(t("Plan copied to share", "योजना साझा करने हेतु कॉपी हुई"));
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(t("Location not available on this device", "इस डिवाइस पर स्थान उपलब्ध नहीं"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPatientLoc({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => toast.error(t("Could not get your location", "आपका स्थान नहीं मिल सका"))
    );
  };
  const selectHospital = async (id: string) => {
    setSelectedId(id);
    setRoute(null);
    const h = mapHospitals.find((x) => x.id === id);
    if (h && patientLoc) {
      const r = await fetchRoadRoute(patientLoc, { lat: h.lat, lon: h.lon });
      setRoute(r);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-20">
      {/* __BODY__ */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Hospital className="size-6 text-emerald-600" />
            {t("PM-JAY Hospital Finder", "PM-JAY अस्पताल खोज")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("Find an empanelled hospital, what to carry, and what to expect.", "सूचीबद्ध अस्पताल, क्या साथ ले जाएँ और क्या अपेक्षा करें — जानें।")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={speakReadiness} className="gap-1.5">
            <Volume2 className="size-4" />
            {t("Listen", "सुनें")}
          </Button>
          <Button variant="outline" size="sm" onClick={sharePlan} className="gap-1.5">
            <Share2 className="size-4" />
            {t("Share", "साझा")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLang(lang === "hi" ? "en" : "hi")} className="gap-1.5">
            <Languages className="size-4" />
            {lang === "hi" ? "EN" : "हिं"}
          </Button>
        </div>
      </div>

      <Card className="border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="size-4" /> {t("About PM-JAY", "PM-JAY के बारे में")}
          </div>
          <p className="text-slate-700 dark:text-slate-300">{t(PMJAY_ABOUT.en, PMJAY_ABOUT.hi)}</p>
          <a href={PMJAY_ELIGIBILITY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
            <ExternalLink className="size-3.5" /> {t("Check eligibility / download your card — official NHA portal", "पात्रता जाँचें / कार्ड डाउनलोड करें — आधिकारिक NHA पोर्टल")}
          </a>
        </CardContent>
      </Card>

      <PmjayAskBox lang={lang} />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("Your district", "आपका ज़िला")}</label>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-background px-3 py-2 text-sm">
              <option value="">{locLoading ? t("Loading…", "लोड हो रहा…") : t("Select a district", "ज़िला चुनें")}</option>
              {locations.map((l) => (
                <option key={`${l.state}|${l.district}`} value={l.district}>{l.district} · {l.state}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("What care do you need?", "आपको किस इलाज की ज़रूरत है?")}</label>
            <select value={careNeed} onChange={(e) => setCareNeed(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-background px-3 py-2 text-sm">
              <option value="">{t("Any care", "कोई भी इलाज")}</option>
              {CARE_NEEDS.map((c) => (<option key={c.id} value={c.id}>{t(c.en, c.hi)}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("Preparing for someone? (ASHA / caregiver — optional)", "किसी के लिए तैयारी? (आशा / देखभालकर्ता — वैकल्पिक)")}</label>
            <input value={forName} onChange={(e) => setForName(e.target.value)} placeholder={t("Patient's name", "रोगी का नाम")} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-background px-3 py-2 text-sm" />
          </div>
        </CardContent>
      </Card>

      {district && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold">{t("Empanelled hospitals", "सूचीबद्ध अस्पताल")} ({filtered.length})</h2>
            {asOn && <span className="text-[10px] text-muted-foreground">{t("as on", "दिनांक")} {asOn}</span>}
          </div>
          {mapHospitals.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={useMyLocation} className="gap-1.5 text-xs h-8">
                  <LocateFixed className="size-3.5" /> {t("Use my location", "मेरा स्थान")}
                </Button>
                <span className="text-[10px] text-muted-foreground">{t("Tap a pin for the route · faint pins are approximate", "रूट हेतु पिन टैप करें · धुँधले पिन अनुमानित")}</span>
              </div>
              <HospitalMap hospitals={mapHospitals} patient={patientLoc} selectedId={selectedId} route={route} onSelect={selectHospital} />
            </div>
          )}
          {loading ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("Loading…", "लोड हो रहा…")}</CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("No empanelled hospital found for this care need here. Try 'Any care' or another district.", "इस ज़िले में इस इलाज हेतु कोई सूचीबद्ध अस्पताल नहीं मिला। 'कोई भी इलाज' या दूसरा ज़िला आज़माएँ।")}</CardContent></Card>
          ) : (
            filtered.map((h) => {
              const covered = CARE_NEEDS.filter((c) => matchesCareNeed(h.specialities, c.id));
              return (
                <Card key={h.id}>
                  <CardContent className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Building2 className="size-4 mt-0.5 text-emerald-600 shrink-0" />
                        <div>
                          <div className="font-bold text-sm">{h.name}</div>
                          <div className="text-[11px] text-muted-foreground">{h.district} · {h.state}</div>
                        </div>
                      </div>
                      {h.hospital_type && (
                        <Badge variant="outline" className={`text-[10px] ${h.hospital_type === "Government" ? "border-sky-300 text-sky-700 dark:text-sky-300" : "border-violet-300 text-violet-700 dark:text-violet-300"}`}>
                          {h.hospital_type === "Government" ? t("Govt", "सरकारी") : t("Private", "निजी")}
                        </Badge>
                      )}
                    </div>
                    {covered.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {covered.map((c) => (<span key={c.id} className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-300">{t(c.en, c.hi)}</span>))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {h.phone && (
                        <a href={`tel:${h.phone}`} className="inline-block">
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"><Phone className="size-3.5" /> {h.phone}</Button>
                        </a>
                      )}
                      <a href={directionsUrl(h)} target="_blank" rel="noopener noreferrer" className="inline-block">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8"><Navigation className="size-3.5" /> {t("Directions", "रास्ता")}</Button>
                      </a>
                      {h.lat != null && (
                        <Button variant="outline" size="sm" onClick={() => selectHospital(h.id)} className="gap-1.5 text-xs h-8"><MapPin className="size-3.5" /> {t("Route on map", "मानचित्र पर रूट")}</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm"><FileText className="size-4 text-sky-600" /> {t("Documents to carry", "साथ ले जाने योग्य दस्तावेज़")}</div>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {PMJAY_DOCUMENTS.map((d, i) => (
              <li key={i} className="flex gap-2"><span className="text-emerald-600 shrink-0">✓</span><span>{t(d.en, d.hi)}</span></li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm"><ListChecks className="size-4 text-sky-600" /> {t("What happens at the hospital", "अस्पताल में क्या होता है")}</div>
          <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            {PMJAY_VISIT_STEPS.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 text-[11px] font-bold text-sky-700 dark:text-sky-300">{i + 1}</span>
                <span>{t(s.en, s.hi)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <p className="px-1 text-[11px] text-muted-foreground">
        {t(
          `Information only — not an eligibility or coverage decision. Confirm eligibility on the official portal or call ${PMJAY_CALL_CENTRE}. Hospital empanelment changes; verify before travelling.`,
          `केवल जानकारी — पात्रता या कवरेज निर्णय नहीं। पात्रता आधिकारिक पोर्टल पर जाँचें या ${PMJAY_CALL_CENTRE} पर कॉल करें। अस्पताल सूची बदलती रहती है; जाने से पहले पुष्टि करें।`
        )}
      </p>
    </div>
  );
}
