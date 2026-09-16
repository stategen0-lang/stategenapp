import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
