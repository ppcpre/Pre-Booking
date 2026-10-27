import Link from "next/link";
import { ModeTag, PeriodStatusPill } from "@/components/status";
import { requireMember } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { bookingLabels, recentPayments, todayView } from "@/lib/bookings";
import { formatTHB } from "@/lib/money";
import { fmtDate, todayISO } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/booking-rules";

export const metadata = { title: "Payments" };
const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS) as Record<string, string>;

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  await requireMember();
  const p = await getProperty(code);
  const tab = sp.tab === "received" ? "received" : "outstanding";
  const base = `/p/${p.code}`;

  const view = tab === "outstanding" ? await todayView([p.id], todayISO()) : null;
  const due = view?.due ?? [];
  const labels = await bookingLabels([...new Set(due.map((d) => d.booking_id))]);
  const payments = tab === "received" ? await recentPayments(p.id, 100) : [];
  const buckets = [
    { label: "Due", match: (d: (typeof due)[number]) => d.status !== "OVERDUE" },
    { label: "1–30 days late", match: (d: (typeof due)[number]) => d.status === "OVERDUE" && d.days_late <= 30 },
    { label: "31–60 days late", match: (d: (typeof due)[number]) => d.status === "OVERDUE" && d.days_late > 30 && d.days_late <= 60 },
    { label: "60+ days late", match: (d: (typeof due)[number]) => d.status === "OVERDUE" && d.days_late > 60 },
  ];
  const byMethod = new Map<string, number>();
  for (const pay of payments) if (!pay.voided_at) byMethod.set(pay.method, (byMethod.get(pay.method) ?? 0) + pay.amount);

  return (
    <>
      <div className="seg" style={{ justifySelf: "start" }}>
        <Link href={`${base}/payments`} aria-current={tab === "outstanding" ? "page" : undefined}>Outstanding</Link>
        <Link href={`${base}/payments?tab=received`} aria-current={tab === "received" ? "page" : undefined}>Received</Link>
      </div>

      {tab === "outstanding" ? (
        <>
          <div className="kcards">
            {buckets.map((bk, i) => {
              const rows = due.filter(bk.match);
              return (
                <div key={bk.label} className={`kcard ${i > 0 && rows.length ? "bad" : ""}`}>
                  <span className="n">{formatTHB(rows.reduce((n, d) => n + d.balance, 0))}</span>
                  <span className="l">{bk.label}</span>
                  <span className="h">{rows.length} period{rows.length === 1 ? "" : "s"}</span>
                </div>
              );
            })}
          </div>
          {due.length === 0 ? (
            <div className="empty"><b>Nothing outstanding</b><span>Confirmed and in-house stays with money due show here.</span></div>
          ) : (
            <div className="panel tw">
              <table className="t">
                <thead><tr><th>Unit</th><th>Guest</th><th>Period</th><th>Due</th><th className="r">Balance</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {due.map((d) => {
                    const l = labels.get(d.booking_id);
                    return (
                      <tr key={d.id}>
                        <td className="unit">{l?.unit}</td>
                        <td>{l?.guest} <ModeTag mode={d.mode} /></td>
                        <td className="hint">{d.seq === 0 ? "Deposit and move-in" : d.label}</td>
                        <td>{fmtDate(d.due_date)}</td>
                        <td className="r">{formatTHB(d.balance)}</td>
                        <td><PeriodStatusPill status={d.status} daysLate={d.days_late} /></td>
                        <td className="r"><Link className="btn sm" href={`${base}/bookings/${d.booking_code}?pay=1`}>Record</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">Unpaid reservations are not listed here; they are on the Today and Bookings → Reserved views.</p>
        </>
      ) : (
        <>
          <div className="kcards">
            {[...byMethod.entries()].map(([m, amt]) => (
              <div key={m} className="kcard"><span className="n">{formatTHB(amt)}</span><span className="l">{METHOD_LABEL[m] ?? m}</span><span className="h">last {payments.length} payments</span></div>
            ))}
          </div>
          {payments.length === 0 ? (
            <div className="empty"><b>No payments yet</b></div>
          ) : (
            <div className="panel tw">
              <table className="t">
                <thead><tr><th>Date</th><th>Booking</th><th>Guest</th><th>Method</th><th>Reference</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {payments.map((pay) => (
                    <tr key={pay.id} style={{ opacity: pay.voided_at ? 0.5 : 1 }}>
                      <td>{fmtDate(pay.paid_at)}</td>
                      <td><Link className="rowlink code" href={`${base}/bookings/${pay.booking.code}`}>{pay.booking.code}</Link></td>
                      <td>{pay.booking.guest?.full_name} <span className="dim">· {pay.booking.unit?.code}</span></td>
                      <td>{METHOD_LABEL[pay.method] ?? pay.method}{pay.voided_at ? " · void" : ""}</td>
                      <td className="hint">{pay.reference ?? "–"}</td>
                      <td className="r" style={{ textDecoration: pay.voided_at ? "line-through" : undefined }}>{formatTHB(pay.amount + pay.wht_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
