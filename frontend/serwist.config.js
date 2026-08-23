// @ts-check
// Serwist "configurator mode": the SW is built by `serwist build` AFTER `next build`,
// so it works with Next 16's Turbopack (no webpack plugin involved).
import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/lib/offline/sw.ts",
  swDest: "public/sw.js",
  // The precache is what an ASHA pays for, on her data, over a village 2G link,
  // before the app works offline at all. Unbounded it was 3.5 MB / 87 entries,
  // including a 506 KB WebRTC bundle only the patient portal's call sheet uses.
  //
  // Capped by size rather than by route: Next content-hashes chunk filenames with
  // no route in them, so globIgnores cannot tell a doctor-only bundle from an ASHA
  // one. A size cap needs no filename mapping and keeps working as chunks are
  // renamed. Anything skipped is still cached on first visit by runtimeCaching in
  // sw.ts — it is just not downloaded up front by someone who will never open it.
  //
  // ponytail: 250 KB is chosen to exclude exactly the WebRTC bundle while keeping
  // the React and Supabase chunks every ASHA screen genuinely needs. Revisit if a
  // core chunk ever crosses it — the build logs the resulting total.
  maximumFileSizeToCacheInBytes: 250 * 1024,
});
