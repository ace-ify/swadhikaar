"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectivitySlot } from "@/components/asha/ui";
import { startOfflineRuntime } from "@/lib/offline/register";

// Mobile-portrait-first shell (target 390x844). Deliberately NOT the desktop
// sidebar shell used by admin/doctor/patient — a field worker holds a phone.
const NAV = [
  { href: "/asha/dashboard", Icon: Home, hi: "घर", en: "Home" },
  { href: "/asha/screening/new", Icon: ClipboardList, hi: "जांच", en: "Screen" },
  { href: "/asha/patients", Icon: Users, hi: "मरीज़", en: "Patients" },
] as const;

export default function AshaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Registers the service worker and drains the outbox on `online` /
  // `visibilitychange`. Without this the queue only moves when someone taps
  // "Send now" by hand, which is how 12 screenings sat unsynced after a
  // reconnect. Guarded internally, so mounting twice is harmless.
  useEffect(() => {
    startOfflineRuntime();
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#0F172A]">
      <header className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between gap-3 border-b border-slate-200 bg-[#FAFAFA]/95 px-4 backdrop-blur">
        <Link href="/asha/dashboard" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-[#10B981] text-[15px] font-bold text-white">
            स्व
          </span>
          <span className="text-[16px] font-bold">Swadhikaar</span>
        </Link>
        {/* placeholder chip — swap ConnectivitySlot's body, not this slot */}
        <ConnectivitySlot />
      </header>

      <main className="mx-auto w-full max-w-[430px] px-4 pt-4 pb-28">{children}</main>

      <nav
        aria-label="मुख्य नेविगेशन / Main navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white"
      >
        <ul className="mx-auto flex max-w-[430px]">
          {NAV.map(({ href, Icon, hi, en }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[60px] flex-col items-center justify-center gap-0.5 py-2",
                    active ? "text-[#10B981]" : "text-slate-500"
                  )}
                >
                  <Icon aria-hidden className="size-6" strokeWidth={active ? 2.5 : 2} />
                  <span className="text-[13px] font-semibold" lang="hi">
                    {hi}
                  </span>
                  <span className="sr-only">{en}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
