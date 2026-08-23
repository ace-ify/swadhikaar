"use client";

import dynamic from "next/dynamic";
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

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userName } = useAuth();

  return (
    <AccessibilityProvider>
      <SidebarProvider>
        <AppSidebar role="patient" />
        <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
          <DashboardHeader role="patient" userName={userName || "Ramesh Kumar"} />
          <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-muted/20">
            {children}
          </main>
        </SidebarInset>
        <VoiceAgentWidget />
      </SidebarProvider>
    </AccessibilityProvider>
  );
}
