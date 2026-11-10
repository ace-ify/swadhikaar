"use client";

import DispatchPage from "@/app/admin/dispatch/page";

/**
 * Door 4: /dispatch — 108 Emergency EMS Terminal (Tablet / MDT Display)
 * Canonical entry point for EMS dispatchers, ambulance routing, and real-time SBAR handoff.
 */
export default function Door4Dispatch() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="bg-rose-950/60 border-b border-rose-800/50 px-4 py-2 flex items-center justify-between text-xs font-mono">
        <span className="flex items-center gap-2 text-rose-300 font-bold">
          <span className="size-2 rounded-full bg-rose-500 animate-ping" />
          DOOR 4: 108 EMERGENCY EMS TERMINAL (CAD / MDT)
        </span>
        <span className="text-slate-400">Reactive Cross-Door Bus Active</span>
      </div>
      <DispatchPage />
    </div>
  );
}

