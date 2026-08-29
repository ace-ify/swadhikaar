import type { NextConfig } from "next";

// Every role folder is a layout with no index page, so the bare path 404s for all five.
// Nobody noticed because login always sent people to a specific screen -- until
// /patient/dashboard was deleted and both the bare path and every old bookmark landed on
// a 404. Fixed for all five rather than just the one that was reported: they are the same
// missing route, and the next person to type /admin would have found the same wall.
//
// Temporary redirects on purpose. `permanent: true` is a 308 that browsers cache hard,
// so if any of these landing screens moves later, a cached 308 would keep sending people
// to the old one with no way to clear it.
const ROLE_HOME: Record<string, string> = {
  "/patient": "/patient/sos",
  "/patient/dashboard": "/patient/sos", // deleted; kept so old links still work
  "/admin": "/admin/dashboard",
  "/doctor": "/doctor/dashboard",
  "/asha": "/asha/dashboard",
  "/facility": "/facility/inbox",
};

const nextConfig: NextConfig = {
  async redirects() {
    return Object.entries(ROLE_HOME).map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default nextConfig;
