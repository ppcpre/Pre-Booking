import Link from "next/link";
import { BookingStatusPill, ModeTag, PeriodStatusPill } from "@/components/status";
import { requireMember, canManageProperties } from "@/lib/session";
import { getProperty, getSetupStatus } from "@/lib/properties";
import { bookingLabels, todayView } from "@/lib/bookings";
import { activationBlockers, setupReminders } from "@/lib/setup";
import { formatTHB } from "@/lib/money";
import { fmtDate, fmtDateTime, fmtRange, todayISO } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `Today · ${(await params).code}` };
}

export default async function PropertyToday({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const member = await requireMember();
  const p = await getProperty(code);
  const today = todayISO();
  const [status, view] = await Promise.all([getSetupStatus(p.id), todayView([p.id], today)]);
  const labels = await bookingLabels([...new Set(view.due.map((d) => d.booking_id))]);
  const blockers = activationBlockers(status);
  const base = `/p/${p.code}`;
  const owing = (b: { total_amount: number; paid_amount: number }) => Math.max(b.total_amount - b.paid_amount, 0);
  const arrivalsUnpaid = view.arrivals.filter((a) => a.status === "HOLD").length;
  const dueTotal = view.due.reduce((n, d) => n + d.balance, 0);
  const overdue = view.due.filter((d) => d.status === "OVERDUE");

  return (
    <>
      {p.status === "DRAFT" && (
        <div className="notice">
          <span><b>This property is a draft.</b> {blockers.length ? blockers.join(" · ") : "Everything is set — open it from the last setup step."}</span>
          {canManageProperties(member.role) && <Link className="btn sm" href={`/settings/properties/${p.code}/${blockers.length ? "details" : "staff"}`}>Continue setup</Link>}
        </div>
      )}

      {p.status === "ACTIVE" && canManageProperties(member.role) && setupReminders(status).map((r) => (
        <div key={r} className="notice">
          <span>{r}</span>
          <Link className="btn sm" href={`/settings/properties/${p.code}/meters`}>Set prices</Link>
        </div>
      ))}

      <div className="kcards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Link className="kcard mint" href={`${base}/bookings?tab=upcoming`}><span className="n">{view.arrivals.length}</span><span className="l">Arriving today</span><span className="h">{arrivalsUnpaid ? `${arrivalsUnpaid} still to pay` : "all paid"}</span></Link>
        <div className="kcard"><span className="n">{view.departures.length}</span><span className="l">Leaving today</span><span className="h">{fmtDate(today)}</span></div>
        <Link className="kcard" href={`${base}/bookings?tab=inhouse`}><span className="n">{view.inHouse}</span><span className="l">In house</span><span className="h">checked in now</span></Link>
        <Link className={`kcard ${view.reserved.length ? "warn" : ""}`} href={`${base}/bookings?tab=reserved`}><span className="n">{view.reserved.length}</span><span className="l">Reserved, not paid</span><span className="h">{view.reserved[0]?.hold_expires_at ? `next due ${fmtDateTime(view.reserved[0].hold_expires_at)}` : "none waiting"}</span></Link>
        <Link className={`kcard ${overdue.length ? "bad" : ""}`} href={`${base}/payments`}><span className="n">{formatTHB(dueTotal)}</span><span className="l">{overdue.length ? "Due · overdue" : "Due now"}</span><span className="h">{view.due.length} period{view.due.length === 1 ? "" : "s"}</span></Link>
      </div>

      <div className="split">
        <div className="card">
          <h2>Arriving today <span>{view.arrivals.length}</span></h2>
          {view.arrivals.length === 0 ? <span className="hint">No arrivals today.</span> : (
            <div className="list">
              {view.arrivals.map((b) => (
                <Link key={b.id} className="it" href={`${base}/bookings/${b.code}`}>
                  <span className="unit">{b.unit?.code}</span>
                  <span style={{ minWidth: 0 }}><b>{b.guest?.full_name}</b><small><ModeTag mode={b.mode} /> {owing(b) ? `${formatTHB(owing(b))} to pay` : "paid"}</small></span>
                  <BookingStatusPill status={b.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2>Leaving today <span>{view.departures.length}</span></h2>
          {view.departures.length === 0 ? <span className="hint">No departures today.</span> : (
            <div className="list">
              {view.departures.map((b) => (
                <Link key={b.id} className="it" href={`${base}/bookings/${b.code}`}>
                  <span className="unit">{b.unit?.code}</span>
                  <span style={{ minWidth: 0 }}><b>{b.guest?.full_name}</b><small><ModeTag mode={b.mode} /> {owing(b) ? `${formatTHB(owing(b))} owed` : "nothing owed"}</small></span>
                  <BookingStatusPill status={b.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="split wide">
        <div className="block">
          <h2>Payments due <span>confirmed, in-house and departed stays</span></h2>
          {view.due.length === 0 ? <div className="empty"><b>Nothing due</b><span>Rent and stay payments that are due or overdue show here.</span></div> : (
            <div className="panel tw">
              <table className="t">
                <thead><tr><th>Unit</th><th>Guest</th><th>Period</th><th className="r">Balance</th><th>Status</th></tr></thead>
                <tbody>
                  {view.due.map((d) => {
                    const l = labels.get(d.booking_id);
                    return (
                      <tr key={d.id} className="link">
                        <td className="unit"><Link className="rowlink" href={`${base}/bookings/${d.booking_code}`}>{l?.unit}</Link></td>
                        <td>{l?.guest}</td>
                        <td className="hint">{d.label}</td>
                        <td className="r">{formatTHB(d.balance)}</td>
                        <td><PeriodStatusPill status={d.status} daysLate={d.days_late} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <h2>Reserved, not paid <span>released automatically at the pay-by time</span></h2>
          {view.reserved.length === 0 ? <span className="hint">No unpaid reservations.</span> : (
            <div className="list">
              {view.reserved.map((b) => (
                <Link key={b.id} className="it" href={`${base}/bookings/${b.code}`}>
                  <span className="unit">{b.unit?.code}</span>
                  <span style={{ minWidth: 0 }}><b>{b.guest?.full_name}</b><small>{fmtRange(b.check_in, b.check_out)} · {formatTHB(owing(b))}</small></span>
                  <small className="hint">by {b.hold_expires_at ? fmtDateTime(b.hold_expires_at) : "–"}</small>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
