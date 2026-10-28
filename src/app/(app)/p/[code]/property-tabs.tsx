"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function PropertyTabs({ code }: { code: string }) {
  const path = usePathname();
  const base = `/p/${code}`;
  const tabs = [
    { href: base, label: "Today", match: (p: string) => p === base },
    { href: `${base}/calendar`, label: "Calendar", match: (p: string) => p.startsWith(`${base}/calendar`) },
    { href: `${base}/bookings`, label: "Bookings", match: (p: string) => p.startsWith(`${base}/bookings`) },
    { href: `${base}/payments`, label: "Payments", match: (p: string) => p.startsWith(`${base}/payments`) },
    { href: `${base}/meters`, label: "Meters", match: (p: string) => p.startsWith(`${base}/meters`) },
    { href: `${base}/documents`, label: "Documents", match: (p: string) => p.startsWith(`${base}/documents`) },
  ];
  return (
    <nav className="tabs" aria-label="Property">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.match(path) ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
