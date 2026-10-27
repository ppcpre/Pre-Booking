import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The service worker only runs in production builds; in dev it would cache stale pages.
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default withSerwist(nextConfig);

if (process.env.NODE_ENV === "development") {
  // Gives `next dev` access to Cloudflare bindings defined in wrangler.jsonc.
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
