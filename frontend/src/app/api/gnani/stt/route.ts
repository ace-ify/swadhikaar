import { NextResponse } from "next/server";

const GNANI_STT_ENDPOINT = "https://api.vachana.ai/stt/v3";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GNANI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "GNANI_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { success: false, error: "Multipart formData is required" },
        { status: 400 }
      );
    }

    const audioFile = formData.get("audio") || formData.get("audio_file");
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { success: false, error: "Audio file blob ('audio' or 'audio_file') is required" },
        { status: 400 }
      );
    }

    const languageCode = (formData.get("language_code") as string) || "indic-auto";
    const model = (formData.get("model") as string) || "prisma-v3.0";

    const gnaniFormData = new FormData();
    gnaniFormData.append("audio_file", audioFile, "audio.wav");
    gnaniFormData.append("language_code", languageCode);
    gnaniFormData.append("model", model);

    const startTime = Date.now();
    const response = await fetch(GNANI_STT_ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-Key-ID": apiKey,
      },
      body: gnaniFormData,
    });

    const elapsed = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gnani STT error:", response.status, errText);
      return NextResponse.json(
        { success: false, error: `Gnani Prisma STT failed: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      transcript: data.transcript || "",
      detected_language_code: data.detected_language_code || "hi-IN",
      latency: data.end_to_end_latency || elapsed,
      model: data.model || model,
      raw: data,
    });
  } catch (error: any) {
    console.error("Gnani STT route error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

