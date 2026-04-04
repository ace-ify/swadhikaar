"use client";

import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import VoiceAgentWidget from "@/components/voice-agent-widget";
import { AccessibilityProvider } from "@/context/accessibility-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

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
