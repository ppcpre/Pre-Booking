import type { Metadata, Viewport } from "next";
import { OfflineBar } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pre-Booking", template: "%s · Pre-Booking" },
  description: "Bookings, leases and payments for your properties.",
  applicationName: "Pre-Booking",
  appleWebApp: { capable: true, title: "Pre-Booking", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1513" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OfflineBar />
        {children}
      </body>
    </html>
  );
}
