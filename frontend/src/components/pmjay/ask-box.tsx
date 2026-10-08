"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircleQuestion, ExternalLink, Volume2 } from "lucide-react";
import { speak } from "@/lib/speak";

interface Citation {
  section: string;
  source: string;
  url: string;
}

/** Bounded "ask about PM-JAY" box — answers only from the official-source corpus,
 *  shows citations, and refuses when the question is out of corpus. */
export function PmjayAskBox({ lang }: { lang: "en" | "hi" }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [refused, setRefused] = useState(false);
  const t = (en: string, hi: string) => (lang === "hi" ? hi : en);

  const ask = async () => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setAnswer(null);
    setRefused(false);
    setCitations([]);
    try {
      const res = await fetch("/api/pmjay-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, lang }),
      });
      const d = await res.json();
      if (d.refused || !d.answer) setRefused(true);
      else {
        setAnswer(d.answer);
        setCitations(d.citations || []);
      }
    } catch {
      setRefused(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <MessageCircleQuestion className="size-4 text-sky-600" /> {t("Ask about PM-JAY", "PM-JAY के बारे में पूछें")}
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            placeholder={t("e.g. What documents do I need?", "जैसे: मुझे कौन से दस्तावेज़ चाहिए?")}
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-background px-3 py-2 text-sm"
          />
          <Button size="sm" onClick={ask} disabled={loading}>{loading ? "…" : t("Ask", "पूछें")}</Button>
        </div>

        {refused && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t(
              "I can only answer from the official PM-JAY documents, and I don't have that. For eligibility or specifics, use the official portal or call 14555.",
              "मैं केवल आधिकारिक PM-JAY दस्तावेज़ों से उत्तर देता हूँ, और वह मेरे पास नहीं है। पात्रता/विवरण हेतु आधिकारिक पोर्टल या 14555 पर संपर्क करें।"
            )}
          </p>
        )}

        {answer && (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">{answer}</p>
              <button onClick={() => speak(answer, lang)} className="shrink-0 text-sky-600" aria-label={t("Listen", "सुनें")}>
                <Volume2 className="size-4" />
              </button>
            </div>
            {citations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                <span className="text-[10px] text-muted-foreground">{t("Sources:", "स्रोत:")}</span>
                {citations.map((c, i) => (
                  <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-sky-700 dark:text-sky-400 hover:underline">
                    <ExternalLink className="size-2.5" />
                    {c.source}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          {t("Answers come only from official PM-JAY sources — not an eligibility decision.", "उत्तर केवल आधिकारिक PM-JAY स्रोतों से — पात्रता निर्णय नहीं।")}
        </p>
      </CardContent>
    </Card>
  );
}
