"use client";

// Voice channel for one incident. A room, not a phone call — nothing here dials a
// number, so it cannot place outbound minutes on a run.
//
// Two channels exist server-side and the split matters: `operator` is crew, dispatcher
// and the receiving hospital; `emergency` is the person at the scene. Someone standing
// over a bleeding stranger should not be listening to a bed negotiation. The crew's
// screen joins `operator`; the reporter's channel needs a control on the patient SOS
// screen, which is not built yet.
//
// Reuses the LiveKit SDK already in this app for the voice agent. No push-to-talk: a
// held button is a hand off the wheel.

import { useState, useCallback } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
} from "@livekit/components-react";
import { Mic, MicOff, Radio, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Inside({ onLeave }: { onLeave: () => void }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const live = localParticipant?.isMicrophoneEnabled ?? false;
  const others = participants.filter((p) => !p.isLocal);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Radio className="size-4 shrink-0 text-emerald-600" />
        <span className="text-sm font-medium">Operator channel</span>
        <Badge variant={others.length > 0 ? "secondary" : "outline"} className="ml-auto">
          {others.length === 0
            ? "nobody else on"
            : `${others.length} other${others.length === 1 ? "" : "s"}`}
        </Badge>
      </div>

      {others.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {others.map((p) => p.identity).join(", ")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={live ? "default" : "outline"}
          className="h-12"
          onClick={() => void localParticipant?.setMicrophoneEnabled(!live)}
        >
          {live ? <Mic className="mr-2 size-4" /> : <MicOff className="mr-2 size-4" />}
          {live ? "Mic on" : "Mic off"}
        </Button>
        <Button variant="outline" className="h-12" onClick={onLeave}>
          <PhoneOff className="mr-2 size-4" />
          Leave
        </Button>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

export function VoiceChannel({ incidentId }: { incidentId: string }) {
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/voice-channel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ incident_id: incidentId, channel: "operator" }),
        },
      );
      const body = await res.json();
      if (!res.ok || !body.ok) {
        toast.error(
          body.error === "not_configured"
            ? "Voice channels are not configured on this deployment."
            : (body.detail ?? body.error ?? "Could not open the channel."),
        );
        return;
      }
      setConn({ url: body.livekit_url, token: body.livekit_token });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the channel.");
    } finally {
      setBusy(false);
    }
  }, [incidentId]);

  return (
    <Card>
      <CardContent className="py-4">
        {conn ? (
          <LiveKitRoom
            serverUrl={conn.url}
            token={conn.token}
            connect
            audio
            video={false}
            onDisconnected={() => setConn(null)}
            onError={(e) => toast.error(e.message)}
          >
            <Inside onLeave={() => setConn(null)} />
          </LiveKitRoom>
        ) : (
          <Button
            variant="outline"
            className="h-12 w-full"
            disabled={busy}
            onClick={() => void join()}
          >
            <Radio className="mr-2 size-4" />
            {busy ? "Connecting…" : "Open operator channel"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
