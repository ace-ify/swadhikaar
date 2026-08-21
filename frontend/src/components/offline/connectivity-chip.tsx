"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CloudOff, LoaderCircle } from "lucide-react";
import { onPendingChange, pendingCount } from "@/lib/offline/outbox";
import { startOfflineRuntime } from "@/lib/offline/register";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Connectivity + outbox status. Icon + text + colour, never colour alone.
 * Also boots the service worker / sync listeners on first mount.
 */
export function ConnectivityChip({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(0);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true // SSR: assume online, the client corrects it
  );

  useEffect(() => {
    startOfflineRuntime();
    const off = onPendingChange(setPending);
    // ponytail: 5s poll covers ops enqueued by other modules in this tab without a pub/sub bus.
    const timer = setInterval(() => void pendingCount().then(setPending), 5000);
    return () => {
      clearInterval(timer);
      off();
    };
  }, []);

  const state = !online ? "offline" : pending > 0 ? "syncing" : "online";

  const styles = {
    offline: "bg-amber-50 text-amber-900 border-amber-500",
    syncing: "bg-blue-50 text-blue-900 border-blue-500",
    online: "bg-emerald-50 text-emerald-900 border-emerald-600",
  }[state];

  const Icon = { offline: CloudOff, syncing: LoaderCircle, online: Check }[state];

  const hi = {
    offline: `ऑफ़लाइन · ${pending} बाकी`,
    syncing: "सिंक हो रहा है",
    online: "ऑनलाइन",
  }[state];

  const en = {
    offline: `Offline · ${pending} pending`,
    syncing: "Syncing",
    online: "Online",
  }[state];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-4 py-2 ${styles} ${className}`}
    >
      <Icon
        aria-hidden="true"
        className={`size-6 shrink-0 ${state === "syncing" ? "animate-spin" : ""}`}
      />
      <span className="flex flex-col leading-tight">
        <span className="text-base font-medium">{hi}</span>
        <span className="text-xs opacity-80">{en}</span>
      </span>
    </div>
  );
}
