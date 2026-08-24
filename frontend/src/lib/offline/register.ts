import { syncNow } from "./outbox";

let started = false;

/** Registers the service worker and drains the outbox whenever connectivity looks back. */
export function startOfflineRuntime() {
  if (started || typeof window === "undefined") return;
  started = true;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // The SW takes over navigations, so a stale precache keeps serving the OLD
        // JS bundle after a deploy — that is how a rotated Supabase key produced
        // "Legacy API keys are disabled" on a login page whose server-side bundle
        // was already correct. skipWaiting/clientsClaim in sw.ts only help once the
        // browser has FETCHED the new worker, so ask it to check on every boot.
        void reg.update();

        // A newly installed worker that is waiting behind the old one means the page
        // is running stale code. Take the update immediately and reload once — the
        // flag stops a reload loop if controllerchange fires again.
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "activated" && navigator.serviceWorker.controller) {
              if (!sessionStorage.getItem("swadhikaar.sw.reloaded")) {
                sessionStorage.setItem("swadhikaar.sw.reloaded", "1");
                window.location.reload();
              }
            }
          });
        });
      })
      .catch(() => {
        // ponytail: no SW (dev, http, unsupported) just means no offline shell; the outbox still works.
      });
    navigator.serviceWorker.addEventListener("message", (e) => {
      if ((e.data as { type?: string } | null)?.type === "outbox-sync") void syncNow();
    });
  }

  const drain = () => {
    if (navigator.onLine) void syncNow();
  };
  window.addEventListener("online", drain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") drain();
  });
  drain();
}

/** Ask the browser to retry for us after the tab is closed. Falls back silently. */
export async function requestBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await reg.sync?.register("outbox-sync");
  } catch {
    // Background Sync is Chromium-only; the online/visibilitychange listeners cover the rest.
  }
}
