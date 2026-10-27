import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pre-Booking",
    short_name: "Pre-Booking",
    description: "Bookings, leases and payments for your properties.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#2c6a55",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-192.png", sizes: "192x192", type: "image/png", purpose: "monochrome" },
    ],
    shortcuts: [
      { name: "Overview", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Properties", url: "/settings/properties", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
