import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { BookingStatusPill, ModeTag, PeriodStatusPill } from "@/components/status";
import { requireMember, canManageProperties } from "@/lib/session";
import { listProperties } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { bookingLabels, todayView } from "@/lib/bookings";
import { greeting, todayLabel } from "@/lib/greeting";
import { formatTHB } from "@/lib/money";
import { fmtDateTime, todayISO } from "@/lib/dates";
import { PROPERTY_TYPE_LABEL } from "@/lib/types";

export const metadata = { title: "Overview" };

const short = (satang: number) => (satang >= 100_000_00 ? `฿${Math.round(satang / 100_000)}k` : formatTHB(satang));

export default async function Overview() {
  const member = await requireMember();
  const props = (await listProperties()).filter((p) => p.status !== "ARCHIVED");
  const ids = props.map((p) => p.id);
  const today = todayISO();
  const supabase = await createClient();
  const [urls, view, tonight] = await Promise.all([
    signedPhotoUrls(props.map((p) => p.photo_path)),
    todayView(ids, today),
    ids.length
      ? supabase.from("bookings").select("property_id").in("property_id", ids).eq("kind", "RESERVATION")
          .in("status", ["HOLD", "CONFIRMED", "CHECKED_IN"]).lte("check_in", today).gt("check_out", today)
      : Promise.resolve({ data: [] as { property_id: string }[] }),
  ]);
  const labels = await bookingLabels([...new Set(view.due.map((d) => d.booking_id))]);
  const byId = new Map(props.map((p) => [p.id, p]));
  const count = <T extends { property_id: string }>(rows: T[], pid: string) => rows.filter((r) => r.property_id === pid).length;
  const occupied = (tonight.data ?? []) as { property_id: string }[];
  const overdue = view.due.filter((d) => d.status === "OVERDUE");
  const openUnits = props.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + p.unit_count, 0);
  const unpaidArrivals = view.arrivals.filter((a) => a.status === "HOLD");
  const canManage = canManageProperties(member.role);
  const firstName = member.name.split(" ")[0];
  const thumb = (pid: string) => {
    const p = byId.get(pid);
    return p ? <PropertyThumb name={p.name} url={p.photo_path ? urls[p.photo_path] : null} /> : null;
  };

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{todayLabel()} · all properties</p>
        </div>
      </div>

      <div className="kcards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <div className="kcard mint"><span className="n">{view.arrivals.length}</span><span className="l">Arrivals today</span><span className="h">{unpaidArrivals.length ? `${unpaidArrivals.length} still to pay` : "all paid"}</span></div>
        <div className="kcard"><span className="n">{view.departures.length}</span><span className="l">Departures today</span><span className="h">{view.inHouse} in house now</span></div>
        <div className="kcard"><span className="n">{occupied.length}<small> / {openUnits}</small></span><span className="l">Occupied tonight</span><span className="h">{openUnits ? `${Math.round((occupied.length / openUnits) * 100)}% of open units` : "no open units yet"}</span></div>
        <div className={`kcard ${view.reserved.length ? "warn" : ""}`}><span className="n">{view.reserved.length}</span><span className="l">Reserved, not paid</span><span className="h">{view.reserved[0]?.hold_expires_at ? `next due ${fmtDateTime(view.reserved[0].hold_expires_at)}` : "none waiting"}</span></div>
        <div className={`kcard ${overdue.length ? "bad" : ""}`}><span className="n">{formatTHB(overdue.reduce((n, d) => n + d.balance, 0))}</span><span className="l">Overdue</span><span className="h">{overdue.length} period{overdue.length === 1 ? "" : "s"}</span></div>
      </div>

      <div className="block">
        <h2>Properties <span>Choose a property to focus on it</span></h2>
        {props.length === 0 && !canManage ? (
          <div className="empty"><b>No properties yet</b><span>Ask a manager to assign you to a property.</span></div>
        ) : (
          <div className="pgrid">
            {props.map((p) => {
              const draft = p.status === "DRAFT";
              const occ = count(occupied, p.id);
              const pct = p.unit_count ? Math.round((occ / p.unit_count) * 100) : 0;
              const late = overdue.filter((d) => d.property_id === p.id).reduce((n, d) => n + d.balance, 0);
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
                  {draft ? (
                    <span className="hint">Finish setup to start taking bookings.</span>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ink-2)" }}>
                          <span>Occupied tonight</span><b style={{ color: "var(--ink)" }}>{occ} / {p.unit_count} · {pct}%</b>
                        </div>
                        <div className="bar2" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                      </div>
                      <div className="pstats" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                        <div><b>{count(view.arrivals, p.id)}</b><small>Arrivals</small></div>
                        <div><b>{count(view.departures, p.id)}</b><small>Departures</small></div>
                        <div><b style={{ color: count(view.reserved, p.id) ? "var(--amber)" : undefined }}>{count(view.reserved, p.id)}</b><small>Unpaid</small></div>
                        <div><b style={{ color: late ? "var(--coral)" : undefined }}>{late ? short(late) : "–"}</b><small>Overdue</small></div>
                      </div>
                    </>
                  )}
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

      {(view.due.length > 0 || unpaidArrivals.length > 0 || view.arrivals.length > 0) && (
        <div className="split wide">
          <div className="card">
            <h2>Needs attention <span>all properties</span></h2>
            {unpaidArrivals.length === 0 && view.due.length === 0 ? <span className="hint">Nothing needs attention.</span> : (
              <div className="list">
                {unpaidArrivals.map((b) => {
                  const p = byId.get(b.property_id);
                  return (
                    <Link key={b.id} className="it" href={`/p/${p?.code}/bookings/${b.code}?pay=1`}>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{thumb(b.property_id)}<span className="unit">{b.unit?.code}</span></span>
                      <span style={{ minWidth: 0 }}><b>{b.guest?.full_name} arrives today</b><small>{p?.name} · {formatTHB(b.total_amount - b.paid_amount)} to pay before check-in</small></span>
                      <span className="btn sm">Take payment</span>
                    </Link>
                  );
                })}
                {view.due.slice(0, 12).map((d) => {
                  const p = byId.get(d.property_id);
                  const l = labels.get(d.booking_id);
                  return (
                    <Link key={d.id} className="it" href={`/p/${p?.code}/bookings/${d.booking_code}`}>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{thumb(d.property_id)}<span className="unit">{l?.unit}</span></span>
                      <span style={{ minWidth: 0 }}><b>{l?.guest} · {formatTHB(d.balance)}</b><small>{p?.name} · {d.seq === 0 ? "Deposit and move-in" : d.label}</small></span>
                      <PeriodStatusPill status={d.status} daysLate={d.days_late} />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <div className="card">
            <h2>Arriving today <span>{view.arrivals.length}</span></h2>
            {view.arrivals.length === 0 ? <span className="hint">No arrivals today.</span> : (
              <div className="list">
                {view.arrivals.map((b) => (
                  <Link key={b.id} className="it" href={`/p/${byId.get(b.property_id)?.code}/bookings/${b.code}`}>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{thumb(b.property_id)}<span className="unit">{b.unit?.code}</span></span>
                    <span style={{ minWidth: 0 }}><b>{b.guest?.full_name}</b><small><ModeTag mode={b.mode} /> {byId.get(b.property_id)?.name}</small></span>
                    <BookingStatusPill status={b.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
