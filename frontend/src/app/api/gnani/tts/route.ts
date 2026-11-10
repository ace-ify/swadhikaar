import { NextResponse } from "next/server";

const GNANI_TTS_ENDPOINT = "https://api.vachana.ai/api/v1/tts/inference";

// Default voices mapped to models and languages
const DEFAULT_V3_VOICE: Record<string, string> = {
  "hi-IN": "Shivani",
  "en-IN": "Shivani",
  "ta-IN": "Lakshmi",
  "te-IN": "Kalpana",
  "kn-IN": "Prakash",
  "mr-IN": "Chetana",
  "gu-IN": "Devansh",
  "bn-IN": "Riyaa",
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GNANI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "GNANI_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { text, language = "hi-IN", voice, speed = 1 } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { success: false, error: "Valid 'text' is required" },
        { status: 400 }
      );
    }

    const selectedVoice = voice || DEFAULT_V3_VOICE[language] || "Shivani";

    const payload = {
      text: text.trim(),
      voice: selectedVoice,
      model: "timbre-v3.0",
      language: language,
      speed: Number(speed) || 1,
      audio_config: {
        encoding: "linear_pcm",
        container: "wav",
        num_channels: 1,
        sample_rate: 24000,
        sample_width: 2,
      },
    };

    let response = await fetch(GNANI_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key-ID": apiKey,
      },
      body: JSON.stringify(payload),
    });

    // Fallback to timbre-v2.5 if v3.0 fails for a voice/language
    if (!response.ok && response.status === 400) {
      console.warn("Gnani Timbre v3.0 400, falling back to timbre-v2.5...");
      const fallbackPayload = {
        ...payload,
        model: "timbre-v2.5",
        voice: "Nalini",
      };
      response = await fetch(GNANI_TTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key-ID": apiKey,
        },
        body: JSON.stringify(fallbackPayload),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gnani TTS error response:", response.status, errText);
      return NextResponse.json(
        { success: false, error: `Gnani TTS failed: ${errText}` },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
        "X-Powered-By": "Gnani-Timbre-v3.0",
      },
    });
  } catch (error: any) {
    console.error("Gnani TTS route error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

