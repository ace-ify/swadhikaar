"use client";

import { useAuth } from "@/context/auth-context";
import { AppSidebar, DashboardHeader } from "@/components/dashboard-layout";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userName } = useAuth();

  return (
    <SidebarProvider>
      <AppSidebar role="admin" />
      <SidebarInset className="flex flex-col bg-background h-screen overflow-hidden">
        <DashboardHeader role="admin" userName={userName || "Admin User"} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-muted/20">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
