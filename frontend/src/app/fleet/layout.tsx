"use client";

import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

// A crew reads this on a phone mounted in a moving vehicle, so the padding is tighter
// than the desk shells and the content column is narrow.
export default function FleetLayout({ children }: { children: React.ReactNode }) {
  const { userName } = useAuth();

  return (
    <SidebarProvider>
      <AppSidebar role="fleet_operator" />
      <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
        <DashboardHeader role="fleet_operator" userName={userName || "Crew"} />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-3 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
