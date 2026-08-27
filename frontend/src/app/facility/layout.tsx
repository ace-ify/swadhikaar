"use client";

import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

// A receiving facility gets the desktop shell, not the ASHA phone shell: this is
// used at a nursing station or an ED desk, on whatever screen is already there.
export default function FacilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userName } = useAuth();

  return (
    <SidebarProvider>
      <AppSidebar role="facility_staff" />
      <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
        <DashboardHeader role="facility_staff" userName={userName || "Facility Staff"} />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-4 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
