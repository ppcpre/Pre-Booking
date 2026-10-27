"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { PropertyThumb } from "@/components/property-thumb";
import { InstallMenuItem } from "@/components/pwa";
import { BuildingIcon, BoltIcon, CalendarIcon, CardIcon, DocIcon, GearIcon, HomeIcon, ListIcon, UsersIcon } from "@/components/icons";
import { ROLE_LABEL, type Role } from "@/lib/types";

export type ShellProperty = { code: string; name: string; status: string; units: number; photoUrl: string | null };
type Props = {
  member: { name: string; email: string; role: Role; avatarUrl: string | null };
  properties: ShellProperty[];
  children: ReactNode;
};

function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Which property the current URL is about, if any. */
function currentCode(path: string): string | null {
  const m = path.match(/^\/(?:p|settings\/properties)\/([A-Z0-9]{2,6})(?:\/|$)/);
  return m ? m[1]! : null;
}

function useMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  return { open, setOpen, toggle, root };
}

const SOON = [
  { label: "Calendar", icon: CalendarIcon },
  { label: "Bookings", icon: ListIcon },
  { label: "Payments", icon: CardIcon },
  { label: "Meters", icon: BoltIcon },
  { label: "Documents", icon: DocIcon },
];

export function Shell({ member, properties, children }: Props) {
  const path = usePathname();
  const { open, setOpen, toggle, root } = useMenu();
  useEffect(() => setOpen(null), [path, setOpen]);

  const code = currentCode(path);
  const focused = properties.find((p) => p.code === code) ?? null;
  const isAdmin = member.role === "ADMIN";
  const canManage = member.role === "ADMIN" || member.role === "MANAGER";
  const here = (href: string) => (path === href ? "page" : undefined);
  const avatar = member.avatarUrl ? <img src={member.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(member.name);

  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand"><Logo />pre-booking</Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={here("/")}><HomeIcon />Overview</Link>
          {properties.length > 0 && <div className="nav-h">Properties</div>}
          {properties.map((p) => (
            <Link key={p.code} href={`/p/${p.code}`} aria-current={code === p.code && path.startsWith("/p/") ? "page" : undefined}>
              <PropertyThumb name={p.name} url={p.photoUrl} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </Link>
          ))}
          <div className="nav-h">Daily work</div>
          {SOON.map(({ label, icon: I }) => (
            <span key={label} className="soon" title="Arrives in the next sprint"><I />{label}<em>Soon</em></span>
          ))}
        </nav>
      </aside>

      <div className="col">
        <header className="topbar" ref={root}>
          <Link href="/" className="tb-brand" aria-label="Overview"><Logo /></Link>

          <div className="anchor">
            <button className="propsw" type="button" aria-expanded={open === "prop"} onClick={() => toggle("prop")}>
              {focused ? <PropertyThumb name={focused.name} url={focused.photoUrl} /> : <span className="pthumb"><BuildingIcon /></span>}
              <span className="nm">{focused ? focused.name : "All properties"}</span>
              <span className="chev">▾</span>
            </button>
            {open === "prop" && (
              <div className="pop left">
                <div className="pop-h">Properties</div>
                <Link href="/" aria-current={here("/")}>
                  <span className="pthumb md"><BuildingIcon /></span>All properties<small>{properties.length} {properties.length === 1 ? "property" : "properties"} · overview</small>
                </Link>
                {properties.length > 0 && <div className="pop-sep" />}
                {properties.map((p) => (
                  <Link key={p.code} href={`/p/${p.code}`} aria-current={code === p.code ? "page" : undefined}>
                    <PropertyThumb name={p.name} url={p.photoUrl} size="md" />
                    {p.name}
                    <small>{p.status === "DRAFT" ? "Draft · finish setup" : `${p.units} units`}</small>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="tb-right">
            {canManage && (
              <div className="anchor">
                <button className="ibtn" type="button" aria-label="Settings" aria-expanded={open === "set"} onClick={() => toggle("set")}>
                  <GearIcon />
                </button>
                {open === "set" && (
                  <div className="pop">
                    <div className="pop-h">Settings</div>
                    <Link className="plain" href="/settings/properties">Properties<small>Rooms, units, rates, meters</small></Link>
                    {isAdmin && <Link className="plain" href="/settings/team">Team<small>Who can sign in with Google</small></Link>}
                    {isAdmin && <Link className="plain" href="/settings/business">Business<small>Name and details on documents</small></Link>}
                  </div>
                )}
              </div>
            )}
            <div className="anchor">
              <button className="avatar" type="button" aria-label="Profile" aria-expanded={open === "me"} onClick={() => toggle("me")}>
                {avatar}
              </button>
              {open === "me" && (
                <div className="pop">
                  <div className="me-card">
                    <span className="avatar big">{avatar}</span>
                    <div><b>{member.name}</b><small>{member.email}</small><small>{ROLE_LABEL[member.role]}</small></div>
                  </div>
                  <div className="pop-sep" />
                  <InstallMenuItem />
                  <form action="/auth/signout" method="post" style={{ display: "contents" }}>
                    <button type="submit" className="plain">Sign out</button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Main">
        <Link href="/" aria-current={here("/")}><HomeIcon />Home</Link>
        {focused && (
          <Link href={`/p/${focused.code}`} aria-current={path.startsWith("/p/") ? "page" : undefined}><BuildingIcon />{focused.code}</Link>
        )}
        {canManage && (
          <Link href="/settings/properties" aria-current={path.startsWith("/settings/properties") ? "page" : undefined}><GearIcon />Properties</Link>
        )}
        {isAdmin && <Link href="/settings/team" aria-current={here("/settings/team")}><UsersIcon />Team</Link>}
      </nav>
    </div>
  );
}
