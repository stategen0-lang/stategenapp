import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve the marketing landing page at /landingpage without duplicating it:
  // proxy to the standalone landing site (its own repo/deploy). The app itself
  // stays at the domain root.
  async rewrites() {
    return [
      { source: "/landingpage", destination: "https://stategen.vercel.app/" },
      { source: "/landingpage/:path*", destination: "https://stategen.vercel.app/:path*" },
    ];
  },
  experimental: {
    // How long a prefetched static page stays in the browser's router cache.
    // The default is 5 minutes, so an agent who switched to another app for a
    // while came back to a nav bar that had to fetch every tab again over a cold
    // mobile connection — the "nav lags after I come back" report.
    //
    // Safe to keep long: the dashboard pages are a static frame with no user
    // data (data loads from the API and the on-device cache), so a cached copy
    // is never someone's stale information.
    staleTimes: {
      static: 30 * 60,
    },
  },
};

export default nextConfig;
