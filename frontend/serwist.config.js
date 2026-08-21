// @ts-check
// Serwist "configurator mode": the SW is built by `serwist build` AFTER `next build`,
// so it works with Next 16's Turbopack (no webpack plugin involved).
import { serwist } from "@serwist/next/config";

export default serwist({
  swSrc: "src/lib/offline/sw.ts",
  swDest: "public/sw.js",
});
