import Link from "next/link";
import { BookingStatusPill, ModeTag } from "@/components/status";
import { requireMember } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { listBookings, type BookingTab } from "@/lib/bookings";
import { formatTHB } from "@/lib/money";
import { daysBetween, fmtDateTime, fmtRange, todayISO } from "@/lib/dates";

export const metadata = { title: "Bookings" };

const TABS: [BookingTab, string][] = [
  ["upcoming", "Upcoming"],
  ["reserved", "Reserved"],
  ["inhouse", "In house"],
  ["past", "Past"],
  ["cancelled", "Cancelled"],
];

export default async function BookingsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  await requireMember();
  const p = await getProperty(code);
  const tab = (TABS.find(([t]) => t === sp.tab)?.[0] ?? "upcoming") as BookingTab;
  const q = sp.q ?? "";
  const rows = await listBookings(p.id, tab, q, todayISO());
  const base = `/p/${p.code}/bookings`;

  return (
    <>
      <div className="filters" style={{ justifyContent: "space-between" }}>
        <div className="seg">
          {TABS.map(([t, label]) => (
            <Link key={t} href={`${base}?tab=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={t === tab ? "page" : undefined}>{label}</Link>
          ))}
        </div>
        <form className="filters" action={base}>
          <input type="hidden" name="tab" value={tab} />
          <input className="field" name="q" defaultValue={q} placeholder="Name, phone, unit or code" style={{ width: 240 }} aria-label="Search bookings" />
          <button className="btn" type="submit">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <b>{q ? "No bookings match" : "Nothing here yet"}</b>
          <span>{tab === "reserved" ? "Unpaid reservations appear here until they are paid or released." : "Bookings appear here as you add them."}</span>
        </div>
      ) : (
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>Booking</th><th>Unit</th><th>Guest</th><th>Stay</th><th>Status</th><th className="r">Total</th><th className="r">To pay</th>{tab === "reserved" && <th>Pay by</th>}</tr></thead>
            <tbody>
              {rows.map((b) => {
                const owing = Math.max(b.total_amount - b.paid_amount, 0);
                const nights = daysBetween(b.check_in, b.check_out);
                return (
                  <tr key={b.id} className="link">
                    <td><Link className="rowlink code" href={`${base}/${b.code}`}>{b.code}</Link></td>
                    <td className="unit">{b.unit?.code}</td>
                    <td><Link className="rowlink" href={`${base}/${b.code}`}>{b.guest?.full_name}</Link><div className="hint">{b.guest?.phone}</div></td>
                    <td><ModeTag mode={b.mode} /> {fmtRange(b.check_in, b.check_out)}<div className="hint">{b.mode === "DAILY" ? `${nights} night${nights > 1 ? "s" : ""}` : `${Math.round(nights / 365)} year lease`}</div></td>
                    <td><BookingStatusPill status={b.status} /></td>
                    <td className="r">{formatTHB(b.total_amount)}</td>
                    <td className="r" style={{ color: owing ? "var(--ink)" : "var(--muted)" }}>{owing ? formatTHB(owing) : "–"}</td>
                    {tab === "reserved" && <td className="hint">{b.hold_expires_at ? fmtDateTime(b.hold_expires_at) : "–"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
