"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { useAccessibility } from "@/context/accessibility-context";
import {
  Smartphone,
  Type,
  LayoutDashboard,
  ClipboardList,
  PhoneCall,
  ShieldCheck,
  HeartPulse,
  Stethoscope,
  Users,
  BrainCircuit,
  Workflow,
  Network,
  FileBarChart,
  LogOut,
  ArrowLeft,
  Syringe,
  Activity,
  IndianRupee,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const navByRole: Record<string, NavItem[]> = {
  patient: [
    { label: "Dashboard", href: "/patient/dashboard", icon: LayoutDashboard },
    { label: "My Records", href: "/patient/records", icon: ClipboardList },
    { label: "Call History", href: "/patient/calls", icon: PhoneCall },
    { label: "Consent", href: "/patient/consent", icon: ShieldCheck },
  ],
  doctor: [
    { label: "Dashboard", href: "/doctor/dashboard", icon: LayoutDashboard },
    { label: "Escalation Queue", href: "/doctor/escalations", icon: HeartPulse },
    { label: "Health Camp Patients", href: "/doctor/patients", icon: Stethoscope },
    { label: "Vaccinations", href: "/doctor/vaccinations", icon: Syringe },
    { label: "AI Verification", href: "/doctor/review", icon: BrainCircuit },
  ],
  admin: [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Operations", href: "/admin/operations", icon: Activity },
    { label: "Patients", href: "/admin/patients", icon: Users },
    { label: "Workflows", href: "/admin/workflows", icon: Workflow },
    { label: "Coordination", href: "/admin/coordination", icon: Network },
    { label: "Finance", href: "/admin/finance", icon: IndianRupee },
    { label: "Consent", href: "/admin/consent", icon: ShieldCheck },
    { label: "FHIR Reports", href: "/admin/reports", icon: FileBarChart },
  ],
};

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navByRole[role] || [];
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="pt-6 pb-2 px-4 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:pt-4">
        <Link href={`/${role}/dashboard`} className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
            <ShieldCheck className="size-5!" />
          </div>
          <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-semibold text-base tracking-tight">Swadhikaar</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{role === "doctor" ? "coordinator" : role} Portal</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 mt-2 group-data-[collapsible=icon]:p-0">
        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground/60 mb-2 group-data-[collapsible=icon]:hidden">Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.label}
                      onClick={() => {
                        setOpenMobile(false);
                        router.push(item.href);
                      }}
                      className={cn("h-10 text-[13px] font-medium transition-colors", isActive ? "bg-accent/60 font-semibold" : "")}
                    >
                      <item.icon className="size-5! shrink-0 opacity-80" />
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border/40 group-data-[collapsible=icon]:p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to Home"
              className="h-10 font-medium text-muted-foreground"
              onClick={() => {
                setOpenMobile(false);
                router.push("/");
              }}
            >
              <ArrowLeft className="size-5! shrink-0 opacity-70" />
              <span className="group-data-[collapsible=icon]:hidden">Back to Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function DashboardHeader({
  role,
  userName,
}: {
  role: string;
  userName: string;
}) {
  const { signOut } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await signOut();
    router.push("/login");
  }

  let language = "en", setLanguage = undefined as any, fontSize = "normal", setFontSize = undefined as any;
  try {
    const acc = useAccessibility();
    language = acc.language;
    setLanguage = acc.setLanguage;
    fontSize = acc.fontSize;
    setFontSize = acc.setFontSize;
  } catch (e) {}

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/40 bg-background px-6 transition-all duration-300 ease-in-out z-10 shadow-sm shadow-black/5">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-2 h-8 w-8 text-muted-foreground hover:text-foreground" />
        <div className="h-4 w-px bg-border/60 mx-1 hidden md:block"></div>
        <h2 className="text-[13px] uppercase tracking-widest font-bold text-foreground/80 hidden sm:block">
          {role === "doctor" ? "Coordinator" : role} Dashboard
        </h2>
      </div>

      <div className="flex items-center gap-3 sm:gap-5">
        {role === "patient" && (
          <div className="flex items-center gap-3 border-r border-border/50 pr-4 sm:pr-5">
            <span className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-muted/30 text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
              <Smartphone className="h-3 w-3" />
              <span>Caregiver Linked: Suresh</span>
            </span>

            <button
              onClick={() => setFontSize && setFontSize(fontSize === "normal" ? "large" : "normal")}
              className="flex items-center justify-center h-8 w-8 rounded-full border border-border/40 bg-muted/20 hover:bg-accent hover:text-accent-foreground text-foreground/80 transition-colors shadow-sm"
              title="Toggle Large Text"
            >
              <Type className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => setLanguage && setLanguage(language === "en" ? "hi" : "en")}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-border/40 bg-muted/20 hover:bg-accent hover:text-accent-foreground text-[11px] font-bold text-foreground/80 transition-colors shadow-sm"
              title="Toggle Language"
            >
              {language === "en" ? "अ Hindi" : "A English"}
            </button>
          </div>
        )}

        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-foreground/90">{userName}</span>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/50 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
