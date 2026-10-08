import { NextResponse } from "next/server";
import { PMJAY_CORPUS } from "@/lib/pmjay/corpus";
import { retrieve } from "@/lib/pmjay/retrieve";

/**
 * Bounded RAG for "ask about PM-JAY". Grounding is enforced in CODE, not just the
 * prompt: we retrieve from the official-source corpus and REFUSE when nothing clears
 * the overlap gate (no LLM call at all). When passages are found we either have Gemini
 * rephrase them (constrained to the sources, must emit NO_ANSWER if uncovered) or, with
 * no key, return the passages verbatim (extractive = guaranteed grounded). Citations
 * always come from the retrieved passages.
 */
export async function POST(req: Request) {
  try {
    const { question, lang } = await req.json().catch(() => ({}));
    if (!question || typeof question !== "string") {
      return NextResponse.json({ success: false, error: "question required" }, { status: 400 });
    }

    const hits = retrieve(question, PMJAY_CORPUS, 3);
    if (hits.length === 0) {
      return NextResponse.json({ success: true, refused: true, answer: null, citations: [] });
    }
    const citations = hits.map((h) => ({ section: h.chunk.section, source: h.chunk.source, url: h.chunk.url }));
    const context = hits.map((h, i) => `[${i + 1}] (${h.chunk.section}) ${h.chunk.text}`).join("\n");

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    if (apiKey) {
      try {
        const langLine = lang === "hi" ? "Reply in simple Hindi (Devanagari)." : "Reply in simple English.";
        const prompt =
          `You are a PM-JAY information assistant. Answer the question USING ONLY the numbered sources below. ` +
          `Cite sources inline as [1], [2]. If the sources do not contain the answer, reply with exactly NO_ANSWER. ` +
          `Do not add facts not in the sources. Do not decide whether the user personally is eligible. ` +
          `Keep it to 2-4 short sentences. ${langLine}\n\nSources:\n${context}\n\nQuestion: ${question}`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text && /NO_ANSWER/i.test(text)) {
            return NextResponse.json({ success: true, refused: true, answer: null, citations: [] });
          }
          if (text) {
            return NextResponse.json({ success: true, refused: false, answer: text, citations, grounded: "llm" });
          }
        }
      } catch {
        /* fall through to extractive */
      }
    }

    // Extractive fallback: the most relevant official passage(s), verbatim.
    return NextResponse.json({
      success: true,
      refused: false,
      answer: hits.map((h) => h.chunk.text).join("\n\n"),
      citations,
      grounded: "extractive",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pmjay-ask failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
