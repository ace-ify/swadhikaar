"use client";

// Air quality where the person actually is, and what it means for them.
//
// EOS has this panel and we did not. The reading is measured -- OpenWeather's Air
// Pollution API -- and the band is India's own CPCB PM2.5 scale rather than OpenWeather's
// 1-5 European index, because "AQI" to an Indian reader means the CPCB one.
//
// The Hindi lives here rather than in the edge function: that function is deployed as a
// JSON payload and Devanagari came back double-encoded, so translations stay in a file
// where a wrong character is visible in a diff.
//
// Nothing is invented. If the monitor cannot be reached the card says so instead of
// showing a comforting number, because the people who read this panel are the ones whose
// breathing depends on it.

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Reading = {
  available: boolean;
  reason?: string;
  pm2_5?: number;
  pm10?: number;
  no2?: number;
  o3?: number;
  band?: string;
  advice_en?: string;
  measured_at?: string | null;
  source?: string;
  basis?: string;
};

// Keyed on the band the function returns, so the two never drift apart silently: an
// unknown band falls through to no Hindi rather than to the wrong Hindi.
const BAND_HI: Record<string, string> = {
  Good: "अच्छी",
  Satisfactory: "ठीक",
  Moderate: "मध्यम",
  Poor: "खराब",
  "Very Poor": "बहुत खराब",
  Severe: "गंभीर",
};

const ADVICE_HI: Record<string, string> = {
  Good: "बाहर रहना ठीक है।",
  Satisfactory: "ज़्यादातर लोगों के लिए ठीक। सांस के मरीज़ों को थोड़ी दिक्कत हो सकती है।",
  Moderate: "दमा, सांस या दिल की बीमारी हो तो बाहर भारी काम न करें।",
  Poor: "बाहर देर तक मेहनत न करें। इनहेलर पास रखें।",
  "Very Poor": "हो सके तो घर में रहें। बच्चे और बुज़ुर्ग बाहर मेहनत न करें।",
  Severe: "सबके लिए खतरा। बाहर की गतिविधि टालें।",
};

const BAND_STYLE: Record<string, string> = {
  Good: "border-emerald-500 bg-emerald-50 text-emerald-700",
  Satisfactory: "border-lime-500 bg-lime-50 text-lime-700",
  Moderate: "border-amber-500 bg-amber-50 text-amber-800",
  Poor: "border-orange-500 bg-orange-50 text-orange-800",
  "Very Poor": "border-red-500 bg-red-50 text-red-700",
  Severe: "border-red-700 bg-red-100 text-red-900",
};

export function AirQuality() {
  const [data, setData] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);
  // Resolved here rather than taken as a prop: the only honest source for "the air where
  // you are" is the device, and a district centre standing in for it would be a location
  // claim we cannot make. No permission, no card -- rather than a card about somewhere else.
  const [at, setAt] = useState<{ lat: number; lon: number } | null>(null);
  const [noLocation, setNoLocation] = useState(false);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setNoLocation(true);
      return;
    }
    // maximumAge is generous on purpose: this is ambient information, and a cached fix
    // from ten minutes ago describes the same air.
    navigator.geolocation.getCurrentPosition(
      (p) => setAt({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setNoLocation(true),
      { timeout: 8000, maximumAge: 600000 },
    );
  }, []);

  useEffect(() => {
    if (!at) return;
    let cancelled = false;
    const url =
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/air-quality` +
      `?lat=${at.lat}&lon=${at.lon}`;
    void fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    })
      .then((r) => r.json())
      .then((body: Reading) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [at]);

  // Silent when there is no location. This panel is ambient; it must never be the reason
  // a permission prompt sits in front of the SOS button.
  if (noLocation) return null;

  if (failed || (data && !data.available)) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-muted-foreground text-sm">
            <span lang="hi">हवा की जानकारी अभी नहीं मिल रही।</span>
            <span className="block text-xs">
              Cannot reach the air quality monitor right now.
            </span>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const band = data.band ?? "";

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">
              <span lang="hi">आपके इलाके की हवा</span> · Air where you are
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {data.pm2_5?.toFixed(1)}
              <span className="text-muted-foreground ml-1 text-sm font-normal">
                µg/m³ PM2.5
              </span>
            </p>
          </div>
          <Badge variant="outline" className={BAND_STYLE[band] ?? ""}>
            <span lang="hi">{BAND_HI[band] ?? band}</span>
          </Badge>
        </div>

        <div>
          <p className="text-sm font-medium" lang="hi">
            {ADVICE_HI[band] ?? ""}
          </p>
          <p className="text-muted-foreground text-xs">{data.advice_en}</p>
        </div>

        {/* Every other pollutant the monitor reported, so the headline number is checkable
            rather than asserted. */}
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-xs">
          <span>PM10 {data.pm10?.toFixed(1)}</span>
          <span>NO₂ {data.no2?.toFixed(1)}</span>
          <span>O₃ {data.o3?.toFixed(1)}</span>
        </div>

        <p className="text-muted-foreground text-[11px] leading-snug">
          {data.source}
          {data.measured_at
            ? ` · measured ${new Date(data.measured_at).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : ""}
          . {data.basis}.
        </p>
      </CardContent>
    </Card>
  );
}
