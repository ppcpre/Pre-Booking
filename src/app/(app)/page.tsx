import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { requireMember, canManageProperties } from "@/lib/session";
import { listProperties } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { greeting, todayLabel } from "@/lib/greeting";
import { PROPERTY_TYPE_LABEL, type RentalMode } from "@/lib/types";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const member = await requireMember();
  const props = (await listProperties()).filter((p) => p.status !== "ARCHIVED");
  const urls = await signedPhotoUrls(props.map((p) => p.photo_path));
  const supabase = await createClient();
  const { data: unitRows } = await supabase.from("units").select("property_id, allowed_modes, status");
  const { count: teamCount } = await supabase.from("team_members").select("*", { count: "exact", head: true }).eq("is_active", true);

  const byProp = new Map<string, { daily: number; yearly: number; both: number; maintenance: number }>();
  for (const u of unitRows ?? []) {
    const s = byProp.get(u.property_id) ?? { daily: 0, yearly: 0, both: 0, maintenance: 0 };
    const modes = u.allowed_modes as RentalMode[];
    if (modes.length === 2) s.both++;
    else if (modes[0] === "DAILY") s.daily++;
    else s.yearly++;
    if (u.status === "MAINTENANCE") s.maintenance++;
    byProp.set(u.property_id, s);
  }
  const open = props.filter((p) => p.status === "ACTIVE");
  const drafts = props.filter((p) => p.status === "DRAFT");
  const totalUnits = props.reduce((n, p) => n + p.unit_count, 0);
  const canManage = canManageProperties(member.role);
  const firstName = member.name.split(" ")[0];

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{todayLabel()} · all properties</p>
        </div>
      </div>

      <div className="kcards">
        <div className="kcard mint"><span className="n">{open.length}</span><span className="l">Open properties</span><span className="h">taking bookings</span></div>
        <div className="kcard"><span className="n">{totalUnits}</span><span className="l">Units</span><span className="h">across {props.length} {props.length === 1 ? "property" : "properties"}</span></div>
        <div className={`kcard ${drafts.length ? "warn" : ""}`}><span className="n">{drafts.length}</span><span className="l">Drafts to finish</span><span className="h">{drafts.length ? "finish setup to open" : "nothing pending"}</span></div>
        <div className="kcard"><span className="n">{teamCount ?? "–"}</span><span className="l">Team members</span><span className="h">sign in with Google</span></div>
      </div>

      <div className="block">
        <h2>Properties <span>Choose a property to focus on it</span></h2>
        {props.length === 0 && !canManage ? (
          <div className="empty"><b>No properties yet</b><span>Ask a manager to assign you to a property.</span></div>
        ) : (
          <div className="pgrid">
            {props.map((p) => {
              const s = byProp.get(p.id) ?? { daily: 0, yearly: 0, both: 0, maintenance: 0 };
              const n = Math.max(p.unit_count, 1);
              const draft = p.status === "DRAFT";
              return (
                <Link key={p.id} href={draft && canManage ? `/settings/properties/${p.code}/details` : `/p/${p.code}`} className={`pcard ${draft ? "draft" : ""}`}>
                  <div className="top">
                    <PropertyThumb name={p.name} url={p.photo_path ? urls[p.photo_path] : null} size="lg" />
                    <div style={{ minWidth: 0 }}>
                      <b>{p.name}</b>
                      <small>{draft ? "Draft · not open yet" : PROPERTY_TYPE_LABEL[p.type]} · {p.unit_count} units</small>
                    </div>
                    <span className="go">›</span>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="bar2" aria-hidden="true">
                      <i style={{ width: `${((s.yearly + s.both) / n) * 100}%` }} />
                      <i className="d" style={{ width: `${(s.daily / n) * 100}%` }} />
                    </div>
                    <span className="hint">
                      {p.unit_count === 0 ? "No units yet" : `${s.daily + s.both} open for daily · ${s.yearly + s.both} open for yearly`}
                    </span>
                  </div>
                  <div className="pstats">
                    <div><b>{p.unit_count}</b><small>Units</small></div>
                    <div><b>{s.maintenance}</b><small>Maintenance</small></div>
                    <div><b className="code" style={{ fontSize: 14 }}>{p.code}</b><small>Code</small></div>
                  </div>
                </Link>
              );
            })}
            {canManage && (
              <Link href="/settings/properties/new" className="pcard add">
                <span className="plus">+</span>
                <b style={{ color: "var(--ink)" }}>Add property</b>
                <small>Photo, rooms, rates and meters in 6 steps</small>
              </Link>
            )}
          </div>
        )}
      </div>

      <p className="hint">Arrivals, payments and overdue rent will appear here once bookings are added in the next sprint.</p>
    </div>
  );
}
