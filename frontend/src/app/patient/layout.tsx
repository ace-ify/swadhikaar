"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import { AccessibilityProvider } from "@/context/accessibility-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

// LiveKit's browser client is ~507 KB of WebRTC. Loading it lazily keeps it out of
// the shared chunk graph, so an ASHA on a low-spec phone never downloads a video
// stack she has no screen for. It only arrives when a patient opens the call sheet.
// ssr:false because WebRTC has no server-side meaning.
const VoiceAgentWidget = dynamic(
  () => import("@/components/voice-agent-widget"),
  { ssr: false }
);

// The voice agent places and answers FOLLOW-UP calls -- the thirty days after a case
// closes. It has no business floating over the SOS button: a second round thing to press
// next to the one that matters, on the screen where a wrong tap costs the most. EOS uses
// voice during an active SOS for a consciousness check every 60 seconds, which is a real
// feature and a different one; we have not built that, so we do not imply it by leaving
// a microphone on the emergency screens.
const EMERGENCY_ROUTES = ["/patient/sos", "/patient/first-aid"];

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userName } = useAuth();
  const pathname = usePathname();
  const duringEmergency = EMERGENCY_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <AccessibilityProvider>
      <SidebarProvider>
        <AppSidebar role="patient" />
        <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
          <DashboardHeader role="patient" userName={userName} />
          <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-muted/20">
            {children}
          </main>
        </SidebarInset>
        {duringEmergency ? null : <VoiceAgentWidget />}
      </SidebarProvider>
    </AccessibilityProvider>
  );
}
