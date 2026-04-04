"use client";

import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userName } = useAuth();

  return (
    <SidebarProvider>
      <AppSidebar role="doctor" />
      <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
        <DashboardHeader role="doctor" userName={userName || "Priya Sharma"} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-muted/20">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
