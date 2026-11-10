import { NextResponse } from "next/server";

interface ChatTurn {
  sender: "user" | "sahara";
  text: string;
}

export async function POST(req: Request) {
  try {
    const { message, lang = "hi", history = [] } = (await req.json().catch(() => ({}))) as {
      message?: string;
      lang?: "hi" | "ta" | "bn" | "en";
      history?: ChatTurn[];
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ success: false, error: "message is required" }, { status: 400 });
    }

    const trimmedMsg = message.trim();
    const groqKey = process.env.GROQ_API_KEY || "";
    const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

    const langInstructions: Record<string, string> = {
      hi: "Respond in natural, empathetic conversational Hinglish (code-mixed Hindi + English words).",
      ta: "Respond in natural, empathetic conversational Tanglish (code-mixed Tamil + English words).",
      bn: "Respond in natural, empathetic conversational Benglish (code-mixed Bengali + English words).",
      en: "Respond in natural, empathetic Indian English.",
    };

    const systemPrompt = `You are Sahara AI, a compassionate clinical healthcare companion for the Swadhikaar sovereign healthcare platform.
You are conversing with patient Ramesh Kumar (Male, 58Y, hypertensive on regular Telma 40).

${langInstructions[lang] || langInstructions.hi}

CRITICAL RULES:
1. Keep your reply concise (2-3 short spoken sentences maximum), warm, and respectful.
2. For greetings (e.g. "hello", "hi", "namaste", "kem cho", "how are you"): Warmly greet Ramesh ji, ask how he is feeling, and ask how you can help with his health, medicines, or symptoms today. NEVER give unsolicited medical treatment or diagnosis on a simple greeting.
3. For emergency red-flags (severe chest pain, crushing chest heaviness, breathlessness/dyspnea, sudden severe dizziness, syncope/fainting, vomiting blood): Urgently advise stopping physical effort, sitting or lying down, and warn that 108 emergency triage is being signaled. Set toolCard to "emergency".
4. For medicine/prescription queries (Telma 40, BP medicine, blood pressure tablet cost, generic alternatives, Jan Aushadhi): Explain that the exact same generic salt (Telmisartan 40mg) is available at Pradhan Mantri Jan Aushadhi Kendra for ~₹32 instead of ₹285 branded, giving 88% out-of-pocket savings. Set toolCard to "savings".
5. For hospital or bed availability queries (PM-JAY, Ayushman Bharat, nearby hospital, emergency bed): Mention that Civil Hospital is 2.4 km away with cashless Ayushman Bharat PM-JAY treatment and 14 emergency beds currently open. Set toolCard to "hospital".
6. For explicit vitals review requests (e.g., "mera bp batao", "check my vitals", "vitals record dikhao"): Review recent vitals (BP 128/84, Pulse 76, SpO2 98% - stable). Set toolCard to "vitals".
7. For all other general health questions, symptoms, or casual conversation: Provide empathetic, helpful guidance, practical non-prescriptive home comfort steps, or doctor visit advice. Set toolCard to null. DO NOT emit toolCard for general talk or greetings!

OUTPUT SCHEMA:
Return ONLY valid JSON (no markdown formatting, no code blocks):
{
  "reply": "<concise conversational response>",
  "toolCard": null | "emergency" | "savings" | "hospital" | "vitals",
  "toolData": object | null
}`;

    // Build message history context (last 6 turns)
    const messagesPayload: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (Array.isArray(history)) {
      const recent = history.slice(-6);
      for (const turn of recent) {
        messagesPayload.push({
          role: turn.sender === "user" ? "user" : "assistant",
          content: turn.text,
        });
      }
    }

    messagesPayload.push({ role: "user", content: trimmedMsg });

    // 1. Try Groq LLM (High-speed sub-200ms sovereign inference)
    if (groqKey) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: groqModel,
            messages: messagesPayload,
            response_format: { type: "json_object" },
            temperature: 0.4,
            max_tokens: 450,
          }),
        });

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const rawContent = groqData.choices?.[0]?.message?.content?.trim();
          if (rawContent) {
            try {
              const parsed = JSON.parse(rawContent);
              let toolData = parsed.toolData || null;

              if (parsed.toolCard === "emergency" && !toolData) {
                toolData = {
                  title: "Acute Clinical Triage Pre-Alert (Red/Amber Path)",
                  sbar: "S: Acute distress reported by patient via code-mixed intake. B: Male, 58Y, Hypertensive on Telma 40. A: Suspected acute clinical event. R: 108 EMS pre-alert signal active.",
                };
              } else if (parsed.toolCard === "savings" && !toolData) {
                toolData = {
                  brandedName: "Telma 40 (Telmisartan 40mg)",
                  brandedPrice: 285,
                  genericName: "Jan Aushadhi Telmisartan 40mg",
                  genericPrice: 32,
                  savingsPct: 88,
                };
              }

              return NextResponse.json({
                success: true,
                reply: parsed.reply,
                toolCard: parsed.toolCard || null,
                toolData,
                engine: "groq-llm",
              });
            } catch {
              // If JSON parsing fails, use text directly with null card
              return NextResponse.json({
                success: true,
                reply: rawContent.replace(/^\{[\s\S]*"reply":\s*"/, "").replace(/"\s*,[\s\S]*\}$/, ""),
                toolCard: null,
                toolData: null,
                engine: "groq-raw",
              });
            }
          }
        }
      } catch (err) {
        console.warn("Groq inference error, using intelligent clinical fallback:", err);
      }
    }

    // 2. Intelligent Resilient Fallback Engine (Clinical Rule Core)
    const lower = trimmedMsg.toLowerCase();

    // A. Casual Greetings
    const isGreeting =
      /^(hi|hello|hey|namaste|kem cho|vanakkam|nomoshkar|pranam|good morning|good evening|kya haal hai|kaise ho)\b/i.test(
        lower
      ) ||
      lower === "hi" ||
      lower === "hello" ||
      lower === "hey" ||
      lower === "namaste";

    if (isGreeting) {
      const greetingReplies: Record<string, string> = {
        hi: "नमस्ते रमेश जी! मैं सहारा हूँ। आज आपकी सेहत कैसी है? आप किसी भी लक्षण, दवाइयों या नजदीकी अस्पताल के बारे में पूछ सकते हैं।",
        ta: "வணக்கம் Ramesh ji! நான் சஹாரா. இன்று உங்கள் உடல்நலம் எப்படி உள்ளது? அறிகுறிகள் அல்லது மருந்துகள் பற்றி என்னிடம் கேளுங்கள்.",
        bn: "নমস্কার Ramesh বাবু! আমি সাহারা। আজ আপনার শরীর কেমন আছে? লক্ষণ, ওষুধ বা হাসপাতাল সম্পর্কে কিছু জানতে চাইলে বলুন।",
        en: "Hello Ramesh ji! I am Sahara, your health companion. How are you feeling today? You can ask about symptoms, medicines, or nearby hospitals.",
      };
      return NextResponse.json({
        success: true,
        reply: greetingReplies[lang] || greetingReplies.hi,
        toolCard: null,
        toolData: null,
        engine: "clinical-fallback",
      });
    }

    // B. Emergency Distress (Red-Flag)
    const isEmergency =
      lower.includes("chest") ||
      lower.includes("सीने") ||
      lower.includes("सांस") ||
      lower.includes("breath") ||
      lower.includes("चक्कर") ||
      lower.includes("dizziness") ||
      lower.includes("faint") ||
      lower.includes("behosh") ||
      lower.includes("nenju") ||
      lower.includes("buke");

    if (isEmergency) {
      const emergencyReplies: Record<string, string> = {
        hi: "⚠️ रमेश जी, आपके लक्षण गंभीर हो सकते हैं। कृपया तुरंत बैठ जाएं या लेट जाएं और विश्राम करें। हमने 108 इमरजेंसी ट्राइएज प्री-अलर्ट तैयार कर दिया है।",
        ta: "⚠️ Ramesh ji, unga symptoms serious-ah irukku. Udane rest edunga. Naanga 108 Emergency triage pre-alert dispatch desk-ku anupiyullom.",
        bn: "⚠️ Ramesh বাবু, আপনার লক্ষণগুলি অত্যন্ত গুরুতর। অবিলম্বে বিশ্রাম নিন। আমরা 108 EMS প্রি-অ্যালার্ট পাঠিয়েছি।",
        en: "⚠️ Ramesh ji, your reported symptoms require urgent clinical attention. Please rest immediately. A 108 Emergency triage pre-alert has been generated.",
      };
      return NextResponse.json({
        success: true,
        reply: emergencyReplies[lang] || emergencyReplies.hi,
        toolCard: "emergency",
        toolData: {
          title: "Acute Clinical Triage Pre-Alert (Red/Amber Path)",
          sbar: "S: Acute distress reported via code-mixed patient intake. B: Male, 58Y, Hypertensive on Telma 40. A: Suspected hypertensive urgency / acute event. R: 108 EMS alerted.",
        },
        engine: "clinical-fallback",
      });
    }

    // C. Medicine & Jan Aushadhi Savings
    const isMedicine =
      lower.includes("dawa") ||
      lower.includes("दवा") ||
      lower.includes("medicine") ||
      lower.includes("telma") ||
      lower.includes("generic") ||
      lower.includes("jan aushadhi") ||
      lower.includes("marunthu") ||
      lower.includes("oushodh");

    if (isMedicine) {
      const medReplies: Record<string, string> = {
        hi: "आपकी नियमित BP दवा Telma 40 है। आप जन औषधि केंद्र से यही सॉल्ट (Telmisartan 40mg) मात्र ₹32 में ले सकते हैं, जिससे 88% की सीधी बचत होगी।",
        ta: "Unga regular BP tablet Telma 40. Idhe generic salt (Telmisartan 40mg) Jan Aushadhi Kendra-la ₹32-ku kedaikkum, 88% savings kedaikkum.",
        bn: "Apnar regular BP oushodh Telma 40. Eki generic salt (Telmisartan 40mg) Jan Aushadhi Kendra theke matro ₹32 te paben, 88% savings hobe.",
        en: "Your regular BP medicine is Telma 40. The identical generic salt (Telmisartan 40mg) is available at Jan Aushadhi Kendra for only ₹32, saving 88%.",
      };
      return NextResponse.json({
        success: true,
        reply: medReplies[lang] || medReplies.hi,
        toolCard: "savings",
        toolData: {
          brandedName: "Telma 40 (Telmisartan 40mg)",
          brandedPrice: 285,
          genericName: "Jan Aushadhi Telmisartan 40mg",
          genericPrice: 32,
          savingsPct: 88,
        },
        engine: "clinical-fallback",
      });
    }

    // D. Hospital & PM-JAY
    const isHospital =
      lower.includes("hospital") ||
      lower.includes("अस्पताल") ||
      lower.includes("pmjay") ||
      lower.includes("ayushman") ||
      lower.includes("aaspathiri") ||
      lower.includes("bed");

    if (isHospital) {
      const hospReplies: Record<string, string> = {
        hi: "आपके नज़दीक सिविल अस्पताल 2.4 किमी दूरी पर है, जहाँ आयुष्मान भारत PM-JAY के तहत मुफ़्त इलाज व 14 आपातकालीन बेड उपलब्ध हैं।",
        ta: "Unga location-ku kitta Civil Hospital 2.4 km dhoorathula irukku, anga PM-JAY cashless treatment & 14 emergency beds available.",
        bn: "Apnar kache Civil Hospital matro 2.4 km dure ache, jekhane PM-JAY cashless treatment ebong 14 emergency bed available.",
        en: "Civil Hospital is 2.4 km away with cashless Ayushman Bharat PM-JAY treatment and 14 emergency beds currently open.",
      };
      return NextResponse.json({
        success: true,
        reply: hospReplies[lang] || hospReplies.hi,
        toolCard: "hospital",
        toolData: null,
        engine: "clinical-fallback",
      });
    }

    // E. General Health Symptoms & Advice (NO unsolicited vitals card!)
    const generalReplies: Record<string, string> = {
      hi: "मैंने आपकी बात समझ ली है। कृपया थोड़ा पानी पिएं और पर्याप्त आराम करें। यदि कोई भी लक्षण बढ़े या बेचैनी हो तो तुरंत डॉक्टर से परामर्श लें।",
      ta: "Naan unga vishayathai purinthukonden. Konjam water kudithu rest edungal. Kooduthal discomfort irunthal doctor-ai paarungal.",
      bn: "Ami apnar kotha bujhte perechi. Ektu jol khan ebong bishram nin. Jodi oshubidha bare tahole doctor er poramorsho nin.",
      en: "I understand. Please drink some water and get sufficient rest. If your discomfort persists or worsens, consult a physician promptly.",
    };

    return NextResponse.json({
      success: true,
      reply: generalReplies[lang] || generalReplies.hi,
      toolCard: null,
      toolData: null,
      engine: "clinical-fallback",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
