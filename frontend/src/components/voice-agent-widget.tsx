"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  LiveKitRoom,
  useVoiceAssistant,
  BarVisualizer,
  RoomAudioRenderer,
  useConnectionState,
  useChat,
  useLocalParticipant,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionState as LKConnectionState } from "livekit-client";
import {
  Mic,
  MicOff,
  Send,
  PhoneOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { callStartVoiceCall } from "@/lib/edge-functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePatients } from "@/hooks/use-supabase";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const SUGGESTIONS = [
  "Mujhe sir mein dard hai",
  "Meri dawai khatam ho gayi",
  "BP check karana hai",
  "Neend nahi aa rahi",
];

type Phase = "idle" | "connecting" | "active" | "error";

interface ChatMsg {
  id: string;
  from: "agent" | "user";
  text: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// CallPanel — rendered inside <LiveKitRoom>
// ---------------------------------------------------------------------------
function CallPanel({ onEnd }: { onEnd: () => void }) {
  const { state, audioTrack, agentTranscriptions } = useVoiceAssistant();
  const connState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const { send: sendChat } = useChat();
  const [text, setText] = useState("");
  const [userMsgs, setUserMsgs] = useState<ChatMsg[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = connState === LKConnectionState.Connected;

  // Call duration timer
  useEffect(() => {
    if (isConnected) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((d) => d + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // Merge agent transcriptions + user typed messages
  const messages = useMemo<ChatMsg[]>(() => {
    const agent: ChatMsg[] = (agentTranscriptions ?? [])
      .filter((s) => s.text?.trim())
      .map((s) => ({
        id: s.id,
        from: "agent",
        text: s.text,
        ts: s.firstReceivedTime ?? 0,
      }));
    return [...agent, ...userMsgs].sort((a, b) => a.ts - b.ts);
  }, [agentTranscriptions, userMsgs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    (msg?: string) => {
      const content = (msg || text).trim();
      if (!content) return;
      setText("");
      setUserMsgs((p) => [
        ...p,
        {
          id: crypto.randomUUID(),
          from: "user",
          text: content,
          ts: Date.now(),
        },
      ]);
      sendChat?.(content).catch(() => {});
    },
    [text, sendChat]
  );

  const toggleMic = useCallback(() => {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  // State-dependent color for the visualizer glow
  const glowColor =
    state === "speaking"
      ? "from-blue-500/20 via-indigo-500/10"
      : state === "listening"
        ? "from-emerald-500/20 via-teal-500/10"
        : state === "thinking"
          ? "from-amber-500/20 via-orange-500/10"
          : "from-muted/30 via-muted/10";

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      {/* Top status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
            Live
          </span>
        </div>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {fmtTime(elapsed)}
        </span>
      </div>

      {/* Visualizer zone */}
      <div
        className={cn(
          "relative flex flex-col items-center gap-2 px-6 py-5 bg-gradient-to-b to-transparent shrink-0",
          glowColor
        )}
      >
        <div className="w-full h-20 flex items-center justify-center">
          {audioTrack ? (
            <BarVisualizer
              state={state}
              trackRef={audioTrack}
              barCount={5}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <div className="flex items-end justify-center gap-[6px] h-full pb-2">
              {[14, 22, 32, 22, 14].map((h, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[10px] rounded-full transition-all duration-700",
                    isConnected
                      ? "bg-primary/50 animate-pulse"
                      : "bg-muted-foreground/20"
                  )}
                  style={{
                    height: `${h}px`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Agent state label */}
        {state === "thinking" ? (
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[5px] h-[5px] rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
            <span className="text-xs font-medium text-amber-600">
              Processing...
            </span>
          </div>
        ) : (
          <p
            className={cn(
              "text-xs font-medium tracking-wide",
              state === "speaking"
                ? "text-blue-600"
                : state === "listening"
                  ? "text-emerald-600"
                  : "text-muted-foreground"
            )}
          >
            {state === "speaking"
              ? "Agent is speaking"
              : state === "listening"
                ? "Listening to you..."
                : isConnected
                  ? "Connected"
                  : "Connecting..."}
          </p>
        )}
      </div>

      {/* Transcript */}
      <ScrollArea className="flex-1 min-h-0 border-t">
        <div className="p-4 space-y-2.5">
          {messages.length === 0 && isConnected && (
            <div className="flex flex-col items-center gap-4 py-6">
              <p className="text-sm text-muted-foreground animate-pulse">
                Agent is listening, try asking something...
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center px-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="text-[11px] px-3 py-1.5 rounded-full border border-primary/20 text-primary/80 hover:bg-primary/5 hover:border-primary/40 transition-colors"
                  >
                    &ldquo;{s}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex",
                m.from === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                  m.from === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted rounded-bl-sm"
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Bottom control bar */}
      <div className="border-t bg-background/80 backdrop-blur-sm px-3 py-2.5 shrink-0 z-10 relative">
        <div className="flex items-center gap-2">
          {/* Mic toggle */}
          <Button
            size="icon"
            variant={isMicrophoneEnabled ? "secondary" : "destructive"}
            className="rounded-full h-9 w-9 shrink-0"
            onClick={toggleMic}
            title={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            {isMicrophoneEnabled ? (
              <Mic className="h-4 w-4" />
            ) : (
              <MicOff className="h-4 w-4" />
            )}
          </Button>

          {/* Text input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex-1 flex gap-1"
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              className="rounded-full h-9 text-[13px]"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={!text.trim()}
              className="rounded-full h-9 w-9 shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>

          {/* End call */}
          <Button
            size="icon"
            variant="destructive"
            className="rounded-full h-9 w-9 shrink-0"
            onClick={onEnd}
            title="End call"
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VoiceAgentWidget — FAB + Sheet (patient-only)
// ---------------------------------------------------------------------------
export default function VoiceAgentWidget() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lkUrl, setLkUrl] = useState<string | null>(null);
  const [lkToken, setLkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use first available patient profile for widget call context
  const { data: allPatients } = usePatients();
  const primaryPatient = allPatients[0];

  const connect = async () => {
    setPhase("connecting");
    setError(null);
    try {
      const patientId =
        primaryPatient?.id || "00000000-0000-0000-0000-000000000001";
      const patientName = primaryPatient?.name || "Guest User";

      const data = await callStartVoiceCall({
        patient_id: patientId,
        patient_name: patientName,
        language: "hindi",
        call_type: "follow_up",
      });
      if (data.error) throw new Error(data.error);
      if (!data.livekit_token)
        throw new Error("No LiveKit token received from edge function");
      setLkUrl(data.livekit_url);
      setLkToken(data.livekit_token);
      setPhase("active");
      toast.success("Voice session connected");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setPhase("error");
      toast.error(e instanceof Error ? e.message : "Connection failed");
    }
  };

  const disconnect = () => {
    setLkUrl(null);
    setLkToken(null);
    setPhase("idle");
    setError(null);
    toast.info("Voice session ended");
  };

  const close = () => {
    if (phase === "active") disconnect();
    setOpen(false);
    setPhase("idle");
  };

  const isActive = phase === "active";

  return (
    <>
      {/* Floating Action Button */}
      <Button
        size="icon"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl",
          isActive
            ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/25"
            : "shadow-primary/25"
        )}
      >
        {isActive ? (
          <span className="relative flex items-center justify-center">
            <span className="absolute h-8 w-8 animate-ping rounded-full bg-white/20" />
            <Mic className="relative h-6 w-6" />
          </span>
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </Button>

      {/* Side panel */}
      <Sheet
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={!isActive}
          className="flex flex-col p-0 gap-0 sm:max-w-[400px]"
        >
          {/* Header */}
          <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/10">
                <Mic className="h-4 w-4 text-primary" />
              </span>
              <span>Swadhikaar</span>
            </SheetTitle>
            <SheetDescription>
              AI-powered voice health companion
            </SheetDescription>
          </SheetHeader>

          {/* ── Idle: Welcome screen ── */}
          {phase === "idle" && (
            <div className="flex-1 flex flex-col items-center px-6 pt-10 pb-4 gap-6">
              {/* Animated mic pulse */}
              <div className="relative flex items-center justify-center">
                <span className="absolute h-24 w-24 rounded-full bg-primary/5 animate-ping [animation-duration:2.5s]" />
                <span className="absolute h-20 w-20 rounded-full bg-primary/10 animate-pulse [animation-duration:2s]" />
                <span className="relative w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25">
                  <Mic className="h-7 w-7 text-primary-foreground" />
                </span>
              </div>

              {/* Text */}
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold tracking-tight">
                  Talk to your Health Assistant
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">
                  Speak naturally in Hindi, English, Bhojpuri, or Maithili. The
                  agent adapts to your language.
                </p>
              </div>

              {/* Start button */}
              <Button
                size="lg"
                className="w-full max-w-[260px] rounded-full h-12 text-[15px] font-semibold shadow-md shadow-primary/20"
                onClick={connect}
              >
                <Mic className="h-5 w-5 mr-2" />
                Start Session
              </Button>

              {/* Suggestions */}
              <div className="w-full space-y-2.5 mt-2">
                <p className="text-[10px] text-muted-foreground text-center uppercase tracking-[0.15em] font-semibold">
                  Try saying
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] px-3 py-1.5 rounded-full bg-muted/60 text-muted-foreground border border-transparent"
                    >
                      &ldquo;{s}&rdquo;
                    </span>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-1.5 mt-auto text-[10px] text-muted-foreground/60">
                <span>Powered by</span>
                <Badge
                  variant="outline"
                  className="text-[10px] h-[18px] px-1.5 font-normal text-muted-foreground/60"
                >
                  Gemini 2.0 Flash
                </Badge>
                <span>&middot;</span>
                <Badge
                  variant="outline"
                  className="text-[10px] h-[18px] px-1.5 font-normal text-muted-foreground/60"
                >
                  LiveKit
                </Badge>
              </div>
            </div>
          )}

          {/* ── Connecting ── */}
          {phase === "connecting" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5">
              <div className="relative">
                <span className="absolute inset-0 rounded-full bg-primary/10 animate-ping [animation-duration:1.5s]" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </span>
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-sm">Connecting</p>
                <p className="text-xs text-muted-foreground">
                  Setting up your voice session...
                </p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {phase === "error" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </span>
              <div className="text-center space-y-1">
                <p className="font-semibold text-sm">Connection Failed</p>
                <p className="text-xs text-muted-foreground max-w-[240px]">
                  {error}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
                Try Again
              </Button>
            </div>
          )}

          {/* ── Active call ── */}
          {phase === "active" && lkUrl && lkToken && (
            <LiveKitRoom
              serverUrl={lkUrl}
              token={lkToken}
              connect
              audio
              video={false}
              onDisconnected={disconnect}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <CallPanel onEnd={close} />
            </LiveKitRoom>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
