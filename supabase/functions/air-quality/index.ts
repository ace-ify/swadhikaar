// Air quality where the patient is, from OpenWeather's Air Pollution API.
//
// EOS has an "AQI & Health Alerts" panel and we had nothing, which was the right call
// while there was no data source -- inventing an air quality number for a person with
// asthma is worse than showing none. There IS a source: the OpenWeather key already in
// this project reaches /data/2.5/air_pollution on the free tier.
//
// The band comes from India's own CPCB PM2.5 breakpoints, not OpenWeather's 1-5 index,
// which is a European scale and does not mean what an Indian reader expects from "AQI".
//
// ASCII only in this file, deliberately. The Hindi lives in the React component: this
// function is deployed through a JSON payload and Devanagari came back double-encoded the
// first time, so translations stay where they can be read in a diff.
//
// What it does NOT do is invent a reading. No key or a failed fetch returns
// available: false and the screen says it cannot reach the monitor.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// CPCB National Air Quality Index, 24-hour PM2.5 breakpoints, ug/m3. OpenWeather reports
// an instantaneous concentration, so this approximates a 24-hour band -- stated in the
// payload rather than glossed over.
const CPCB_PM25: { max: number; band: string; advice_en: string }[] = [
  { max: 30, band: "Good", advice_en: "Fine to be outdoors." },
  { max: 60, band: "Satisfactory",
    advice_en: "Fine for most people. Sensitive people may notice mild discomfort." },
  { max: 90, band: "Moderate",
    advice_en: "People with asthma, COPD or heart disease should limit heavy outdoor work." },
  { max: 120, band: "Poor",
    advice_en: "Avoid prolonged outdoor exertion. Keep inhalers to hand." },
  { max: 250, band: "Very Poor",
    advice_en: "Stay indoors where you can. Children and elderly should not exert outdoors." },
  { max: Infinity, band: "Severe",
    advice_en: "Health warning. Everyone should avoid outdoor activity." },
];

function band(pm25: number) {
  return CPCB_PM25.find((b) => pm25 <= b.max) ?? CPCB_PM25[CPCB_PM25.length - 1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return jsonResponse({ available: false, reason: "lat and lon are required" }, 400);
  }

  const key = (Deno.env.get("OPENWEATHER_API_KEY") ?? "").trim();
  if (!key || key.startsWith("your-")) {
    return jsonResponse({ available: false, reason: "no_api_key" });
  }

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${key}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return jsonResponse({ available: false, reason: `upstream_${res.status}` });

    const body = await res.json();
    const reading = body?.list?.[0];
    const pm25 = Number(reading?.components?.pm2_5);
    if (!Number.isFinite(pm25)) {
      return jsonResponse({ available: false, reason: "no_reading_for_this_location" });
    }

    const b = band(pm25);
    return jsonResponse({
      available: true,
      pm2_5: pm25,
      pm10: Number(reading.components.pm10),
      no2: Number(reading.components.no2),
      o3: Number(reading.components.o3),
      so2: Number(reading.components.so2),
      band: b.band,
      advice_en: b.advice_en,
      measured_at: reading.dt ? new Date(reading.dt * 1000).toISOString() : null,
      source: "OpenWeather Air Pollution API",
      // Said out loud because it changes how the number should be read.
      basis: "CPCB PM2.5 bands applied to an instantaneous reading, not a 24-hour mean",
    }, 200);
  } catch (e) {
    return jsonResponse({
      available: false,
      reason: e instanceof Error ? e.message : "fetch_failed",
    });
  }
});
