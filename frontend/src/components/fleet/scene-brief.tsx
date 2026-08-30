"use client";

// Scene brief. One button, one paragraph, and a line saying where it came from.
//
// It is NOT fetched automatically. A crew on a red-triage run does not need a network
// round-trip and a model warm-up between them and the accelerator, and an unread
// paragraph that cost a Gemini call is waste. They press it when they want it.

import { useState } from "react";
import { Sparkles, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Result = {
  brief: string;
  model: string;
  sources: { timeline_events: number; scene_photo_attached: boolean };
};

export function SceneBrief({ incidentId }: { incidentId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fleet-brief`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ incident_id: incidentId }),
        },
      );
      const body = await res.json();
      if (!res.ok || !body.ok) {
        // "not_configured" is its own message on purpose: an unset key and a model
        // outage look identical otherwise, and this project has lost weeks to that.
        setError(
          body.error === "not_configured"
            ? "The AI brief is not configured on this deployment."
            : (body.detail ?? body.error ?? "Could not generate a brief."),
        );
        return;
      }
      setResult(body as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate a brief.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        {result ? (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.brief}</p>
            <p className="text-muted-foreground border-t pt-2 text-[11px] leading-snug">
              AI-generated from this incident&apos;s own record and{" "}
              {result.sources.timeline_events} timeline{" "}
              {result.sources.timeline_events === 1 ? "entry" : "entries"} ({result.model}).
              Advisory only — it can be wrong, and it is not a clinical decision.{" "}
              {result.sources.scene_photo_attached
                ? "It was told a scene photo exists but has not seen it — look at the photo above yourself."
                : "No scene photo was attached."}{" "}
              There are no volunteer reports in this system, so none are included.
            </p>
          </>
        ) : (
          <Button
            variant="outline"
            className="h-11 w-full"
            disabled={busy}
            onClick={() => void generate()}
          >
            <Sparkles className="mr-2 size-4" />
            {busy ? "Reading the record…" : "Brief me on this scene"}
          </Button>
        )}

        {error ? (
          <p className="text-destructive flex items-start gap-1.5 text-xs">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
