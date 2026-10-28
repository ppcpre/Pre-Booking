import Link from "next/link";
import { ActionDialog } from "@/components/action-dialog";
import { BookingStatusPill, ModeTag, PeriodStatusPill } from "@/components/status";
import { requireMember } from "@/lib/session";
import { getProperty, getUnits } from "@/lib/properties";
import { Corrections, PaymentEdit, PeriodEdit } from "./corrections";
import { getBooking } from "@/lib/bookings";
import { formatTHB, satangToBaht } from "@/lib/money";
import { daysBetween, fmtDate, fmtDateTime, fmtRange, todayISO } from "@/lib/dates";
import { BOOKING_STATUS, METHOD_LABEL, PAYMENT_METHODS, refundSuggestion } from "@/lib/booking-rules";
import { bookingDocuments } from "@/lib/documents";
import { InlineAction } from "@/components/action-form";
import { cancelBooking, checkIn, checkOut, extendStay, issueInvoice, issueReceipt, markNoShow, recordPayment, settleLease, voidPayment } from "../../actions";
import { addDays } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ bk: string }> }) {
  return { title: (await params).bk };
}


export default async function BookingPage({ params, searchParams }: { params: Promise<{ code: string; bk: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code, bk }, sp] = await Promise.all([params, searchParams]);
  const member = await requireMember();
  const p = await getProperty(code);
  const b = await getBooking(bk);
  const [docs, units] = await Promise.all([bookingDocuments(b.id), getUnits(p.id)]);
  const receiptFor = new Map(docs.filter((d) => d.type === "RECEIPT" && d.status === "ISSUED").map((d) => [d.payment_id, d.number]));
  const today = todayISO();
  const base = `/p/${p.code}`;

  const open = b.periods.filter((x) => x.status !== "CANCELLED" && x.status !== "WAIVED" && x.status !== "PAID");
  const owing = open.reduce((n, x) => n + x.balance, 0);
  const dueNow = open.filter((x) => x.due_date <= today || (b.status === "HOLD" && x.due_date <= b.check_in)).reduce((n, x) => n + x.balance, 0);
  const nights = daysBetween(b.check_in, b.check_out);
  const canBook = member.role !== "ACCOUNTANT";
  const canVoid = member.role !== "FRONT_DESK";
  const isManager = member.role === "ADMIN" || member.role === "MANAGER";
  const canPay = !["CANCELLED", "EXPIRED", "NO_SHOW"].includes(b.status);
  const refund = refundSuggestion(b.policy_snapshot?.rules, daysBetween(today, b.check_in), b.paid_amount);
  const hidden = { property_code: p.code, booking_code: b.code, booking_id: b.id };
  const Hidden = () => <>{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
  const guest = b.guest;

  if (b.kind === "BLOCK") {
    return (
      <div className="card">
        <h2>Blocked dates · unit {b.unit?.code}</h2>
        <p style={{ margin: 0 }}>{b.block_reason} · {fmtRange(b.check_in, b.check_out)}</p>
        <div><Link className="btn" href={`${base}/calendar`}>Back to calendar</Link></div>
      </div>
    );
  }

  return (
    <>
      <div className="head">
        <div>
          <div className="crumb"><Link href={`${base}/bookings`}>Bookings</Link> / <span className="code">{b.code}</span></div>
          <h1 style={{ fontSize: 20 }}>{guest?.full_name}{guest?.company_name ? ` · ${guest.company_name}` : ""}</h1>
          <p>Unit {b.unit?.code} · {b.unit?.room_type?.name} · {fmtRange(b.check_in, b.check_out)} · {b.mode === "DAILY" ? `${nights} night${nights > 1 ? "s" : ""}` : `${Math.round(nights / 365)}-year lease`} · {b.adults + b.children} guest{b.adults + b.children > 1 ? "s" : ""} <ModeTag mode={b.mode} /> <BookingStatusPill status={b.status} /></p>
        </div>
        <div className="actions">
          {canPay && owing > 0 && (
            <ActionDialog label={b.status === "HOLD" ? "Take payment" : "Record payment"} title="Record payment" subtitle={`${b.code} · ${formatTHB(owing)} outstanding`}
              action={recordPayment} submitLabel="Save payment" triggerClass="btn primary" withKey openOnLoad={sp.pay === "1"}>
              <Hidden />
              <div className="form">
                <label className="lb">Amount received (฿)<input className="field" name="amount" inputMode="decimal" required defaultValue={satangToBaht(dueNow || owing)} /></label>
                <label className="lb">Date received<input className="field" type="date" name="paid_at" required max={today} defaultValue={today} /></label>
                <label className="lb full">Method
                  <select className="field" name="method" defaultValue="TRANSFER">{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
                <label className="lb">Reference<small>Bank ref or receipt no.</small><input className="field" name="reference" /></label>
                <label className="lb">Note<input className="field" name="note" /></label>
              </div>
              {open.length > 1 && (
                <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
                  <legend className="hint" style={{ padding: "0 4px" }}>Apply to (leave all unticked to pay the oldest first)</legend>
                  {open.slice(0, 12).map((x) => (
                    <label key={x.id} className="check" style={{ border: 0, padding: 0, background: "none" }}>
                      <input type="checkbox" name="period_ids" value={x.id} />{x.seq === 0 ? "Deposit and move-in" : x.label} · {formatTHB(x.balance)}
                    </label>
                  ))}
                </fieldset>
              )}
              {guest?.is_company && (
                <div className="form">
                  <label className="lb">Withholding tax kept by tenant (฿)<small>Counts as paid</small><input className="field" name="wht_amount" inputMode="decimal" placeholder="0" /></label>
                  <label className="lb">WHT certificate no.<input className="field" name="wht_cert_no" /></label>
                </div>
              )}
              <label className="check" style={{ justifySelf: "start" }}><input type="checkbox" name="issue_receipt" value="1" defaultChecked />Issue a receipt</label>
            </ActionDialog>
          )}
          {canBook && b.status === "CONFIRMED" && b.check_in <= today && (
            <ActionDialog label="Check in" title="Check in" subtitle={`${guest?.full_name} · unit ${b.unit?.code}`} action={checkIn} submitLabel="Check in" triggerClass="btn primary">
              <Hidden />
              {dueNow > 0 ? (
                isManager ? (
                  <label className="lb">There is {formatTHB(dueNow)} due. Reason for checking in anyway<input className="field" name="override_reason" required /></label>
                ) : (
                  <div className="notice bad">There is {formatTHB(dueNow)} due. Take payment first, or ask a manager.</div>
                )
              ) : (
                <p className="hint" style={{ margin: 0 }}>Everything due is paid. {b.mode === "YEARLY" ? "Record the move-in meter readings below." : "Check ID and hand over the key."}</p>
              )}
              {b.mode === "YEARLY" && (
                <>
                  <input type="hidden" name="mode" value="YEARLY" />
                  <div className="form">
                    <label className="lb">Water meter now<small>Starting point for the first bill</small><input className="field" name="water" inputMode="decimal" /></label>
                    <label className="lb">Electricity meter now<input className="field" name="electric" inputMode="decimal" /></label>
                  </div>
                </>
              )}
            </ActionDialog>
          )}
          {canBook && b.status === "CHECKED_IN" && (
            <ActionDialog label="Check out" title="Check out" subtitle={`${guest?.full_name} · unit ${b.unit?.code}`} action={checkOut} submitLabel="Check out">
              <Hidden />
              <p className="hint" style={{ margin: 0 }}>
                {today < b.check_out ? `Leaving early: the room becomes free from ${fmtDate(today < b.check_in ? b.check_in : today)}.` : "Departure as planned."}
                {b.mode === "YEARLY" && today < b.check_out ? " Unpaid rent for months after today is cancelled. Deposit settlement comes in a later update." : ""}
                {owing > 0 ? ` Still owed: ${formatTHB(owing)}.` : ""}
              </p>
            </ActionDialog>
          )}
          {canBook && b.mode === "DAILY" && (b.status === "HOLD" || b.status === "CONFIRMED") && b.check_in <= today && (
            <ActionDialog label="No-show" title="Mark as no-show" action={markNoShow} submitLabel="Mark no-show" triggerClass="btn quiet" submitClass="btn danger">
              <Hidden />
              <p className="hint" style={{ margin: 0 }}>The guest didn&apos;t arrive. The room becomes free; payments already taken stay recorded.</p>
            </ActionDialog>
          )}
          {canBook && b.mode === "DAILY" && ["HOLD", "CONFIRMED", "CHECKED_IN"].includes(b.status) && (
            <ActionDialog label="Extend" title="Extend stay" subtitle={`Now checking out ${fmtDate(b.check_out)}`} action={extendStay} submitLabel="Extend" triggerClass="btn">
              <Hidden />
              <label className="lb">New check-out<input className="field" type="date" name="check_out" required min={addDays(b.check_out, 1)} defaultValue={addDays(b.check_out, 1)} /></label>
              <p className="hint" style={{ margin: 0 }}>The extra nights are added at today&apos;s rates and are due now. Any credit the guest has is used first.</p>
            </ActionDialog>
          )}
          {canPay && owing > 0 && (
            <ActionDialog label="Invoice" title="Issue invoice" subtitle={`${b.code} · bill to ${guest?.company_name ?? guest?.full_name}`} action={issueInvoice} submitLabel="Issue invoice" triggerClass="btn">
              <Hidden />
              <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
                <legend className="hint" style={{ padding: "0 4px" }}>Include (leave all unticked for everything due in the next 7 days)</legend>
                {open.slice(0, 14).map((x) => (
                  <label key={x.id} className="check" style={{ border: 0, padding: 0, background: "none" }}>
                    <input type="checkbox" name="period_ids" value={x.id} />{x.seq === 0 ? "Deposit and move-in" : x.label} · due {fmtDate(x.due_date, false)} · {formatTHB(x.balance)}
                  </label>
                ))}
              </fieldset>
            </ActionDialog>
          )}
          {b.mode === "YEARLY" && b.status === "CHECKED_OUT" && b.lease && !b.lease.settled_at && (
            <ActionDialog label="Settle deposit" title="Move-out and deposit" subtitle={`Deposit held ${formatTHB(b.lease.deposit_amount)}`} action={settleLease} submitLabel="Settle deposit" triggerClass="btn primary">
              <Hidden />
              <div className="form">
                <label className="lb">Water meter at move-out<input className="field" name="WATER" inputMode="decimal" /></label>
                <label className="lb">Electricity meter at move-out<input className="field" name="ELECTRIC" inputMode="decimal" /></label>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <span className="lb">Deductions <small>Cleaning, damage, missing keys…</small></span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="form" style={{ gridTemplateColumns: "1fr 130px" }}>
                    <input className="field" name="deduction_description" placeholder={i === 0 ? "Cleaning" : "Description"} aria-label="Deduction description" />
                    <input className="field" name="deduction_amount" inputMode="decimal" placeholder="฿" aria-label="Deduction amount" />
                  </div>
                ))}
              </div>
              <label className="lb">Return the rest by<select className="field" name="refund_method" defaultValue="TRANSFER">{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <p className="hint" style={{ margin: 0 }}>The deposit first pays anything still owed (rent, final utilities, deductions). What&apos;s left is recorded as returned to the tenant.</p>
            </ActionDialog>
          )}
          {canBook && (b.status === "HOLD" || b.status === "CONFIRMED") && (
            <ActionDialog label="Cancel" title="Cancel booking" subtitle={b.code} action={cancelBooking} submitLabel="Cancel booking" triggerClass="btn quiet danger" submitClass="btn danger">
              <Hidden />
              <label className="lb">Reason<input className="field" name="reason" required placeholder="Guest changed plans" /></label>
              {b.paid_amount > 0 && (
                <>
                  <p className="hint" style={{ margin: 0 }}>
                    Paid so far {formatTHB(b.paid_amount)}.{" "}
                    {b.policy_snapshot ? `${b.policy_snapshot.name} policy: refund ${refund.percent}% → ${formatTHB(refund.amount)}.` : "No cancellation policy on this booking."}
                  </p>
                  <div className="form">
                    <label className="lb">Refund given (฿)<input className="field" name="refund" inputMode="decimal" defaultValue={satangToBaht(refund.amount)} /></label>
                    <label className="lb">Refund method<select className="field" name="refund_method" defaultValue="TRANSFER">{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  </div>
                </>
              )}
            </ActionDialog>
          )}
        </div>
      </div>

      {b.status === "HOLD" && b.hold_expires_at && (
        <div className="notice">
          <span><b>Reserved, {formatTHB(dueNow || owing)} to pay.</b> Pay by {fmtDateTime(b.hold_expires_at)} or unit {b.unit?.code} is released. {b.mode === "DAILY" ? "Check-in unlocks once paid." : "The lease confirms once the move-in amount is paid."}</span>
        </div>
      )}
      {(b.status === "CANCELLED" || b.status === "EXPIRED" || b.status === "NO_SHOW") && (
        <div className="notice bad"><span><b>{BOOKING_STATUS[b.status].label}.</b> {b.cancel_reason ?? (b.status === "EXPIRED" ? "Not paid by the pay-by time." : "")}</span></div>
      )}

      <div className="kcards">
        <div className="kcard"><span className="n">{formatTHB(b.total_amount)}</span><span className="l">{b.mode === "YEARLY" ? "Lease total" : "Total"}</span></div>
        <div className="kcard mint"><span className="n">{formatTHB(b.paid_amount)}</span><span className="l">Paid</span></div>
        <div className={`kcard ${owing && b.periods.some((x) => x.status === "OVERDUE") ? "bad" : owing ? "warn" : ""}`}><span className="n">{formatTHB(owing)}</span><span className="l">Outstanding</span><span className="h">{dueNow ? `${formatTHB(dueNow)} due now` : "nothing due now"}</span></div>
        <div className="kcard"><span className="n">{formatTHB(b.credit_balance)}</span><span className="l">Credit</span><span className="h">overpaid, kept for later</span></div>
      </div>

      <div className="block">
        <h2>{b.mode === "YEARLY" ? "Monthly payments" : "Charges"} <span>{b.periods.length} period{b.periods.length > 1 ? "s" : ""}</span></h2>
        <div className="panel tw">
          <table className="t">
            <thead><tr><th>#</th><th>Period</th><th>Due</th><th className="r">Amount</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th><th>Paid on</th>{isManager && <th><span className="sr-only">Edit</span></th>}</tr></thead>
            <tbody>
              {b.periods.map((x) => (
                <tr key={x.id}>
                  <td className="dim">{x.seq}</td>
                  <td>
                    <details>
                      <summary style={{ cursor: "pointer" }}>{x.seq === 0 ? "Deposit and move-in" : x.label}</summary>
                      <div className="hint" style={{ display: "grid", gap: 2, marginTop: 6 }}>
                        {x.lines.map((l, i) => <span key={i}>{l.description} · {formatTHB(l.amount)}</span>)}
                        {x.note && <span>{x.note}</span>}
                      </div>
                    </details>
                  </td>
                  <td>{fmtDate(x.due_date)}</td>
                  <td className="r">{formatTHB(x.total_amount)}</td>
                  <td className="r">{x.paid_amount ? formatTHB(x.paid_amount) : <span className="dim">–</span>}</td>
                  <td className="r">{x.balance && x.status !== "CANCELLED" ? formatTHB(x.balance) : <span className="dim">–</span>}</td>
                  <td><PeriodStatusPill status={x.status} daysLate={x.days_late} /></td>
                  <td>{x.paid_at ? fmtDate(x.paid_at) : <span className="dim">–</span>}</td>
                  {isManager && <td className="r"><PeriodEdit x={x} hidden={hidden} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="split wide">
        <div className="card">
          <h2>Payments received <span>{b.payments.filter((x) => !x.voided_at).length}</span></h2>
          {b.payments.length === 0 ? <span className="hint">No payments yet.</span> : (
            <div className="list">
              {b.payments.map((pay) => (
                <div key={pay.id} className="it" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", opacity: pay.voided_at ? 0.55 : 1 }}>
                  <span style={{ minWidth: 0 }}>
                    <b style={{ textDecoration: pay.voided_at ? "line-through" : undefined }}>{formatTHB(pay.amount)} · {METHOD_LABEL[pay.method] ?? pay.method}{pay.wht_amount ? ` + WHT ${formatTHB(pay.wht_amount)}` : ""}</b>
                    <small>{fmtDate(pay.paid_at)}{pay.reference ? ` · ref ${pay.reference}` : ""}{pay.note ? ` · ${pay.note}` : ""}{pay.voided_at ? ` · void: ${pay.void_reason}` : ""}</small>
                  </span>
                  <span className="actions" style={{ flexWrap: "nowrap" }}>
                  {receiptFor.get(pay.id) ? (
                    <Link className="btn sm quiet" href={`${base}/documents/${receiptFor.get(pay.id)}`}>Receipt</Link>
                  ) : !pay.voided_at && pay.method !== "DEPOSIT" && pay.method !== "CREDIT" ? (
                    <InlineAction action={issueReceipt} fields={{ ...hidden, payment_id: pay.id }} label="Issue receipt" className="btn sm quiet" />
                  ) : null}
                  {!pay.voided_at && canVoid && pay.method !== "DEPOSIT" && pay.method !== "CREDIT" && (
                    <PaymentEdit pay={pay} hidden={hidden} today={today} isCompany={!!guest?.is_company} hasReceipt={receiptFor.has(pay.id)} />
                  )}
                  {!pay.voided_at && canVoid && pay.method !== "DEPOSIT" && pay.method !== "CREDIT" && (
                    <ActionDialog label="Void" title="Void payment" subtitle={`${formatTHB(pay.amount)} on ${fmtDate(pay.paid_at)}`} action={voidPayment} submitLabel="Void payment" triggerClass="btn sm quiet" submitClass="btn danger">
                      <Hidden />
                      <input type="hidden" name="payment_id" value={pay.id} />
                      <label className="lb">Reason<input className="field" name="reason" required placeholder="Entered twice" /></label>
                    </ActionDialog>
                  )}
                  </span>
                </div>
              ))}
              {b.refunds.map((r) => (
                <div key={r.id} className="it" style={{ gridTemplateColumns: "1fr" }}>
                  <span><b>Refund {formatTHB(r.amount)} · {METHOD_LABEL[r.method] ?? r.method}</b><small>{fmtDate(r.refunded_at)} · {r.reason}</small></span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <div className="card">
            <h2>{b.mode === "YEARLY" ? "Tenant" : "Guest"}</h2>
            <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
              <b style={{ fontWeight: 500 }}>{guest?.full_name}</b>
              {guest?.phone && <span>{guest.phone}</span>}
              {guest?.email && <span>{guest.email}</span>}
              {guest?.line_id && <span>LINE {guest.line_id}</span>}
              {guest?.is_company && <span className="hint">Bill to {guest.company_name}{guest.tax_id ? ` · Tax ID ${guest.tax_id}` : ""}{guest.branch ? ` · ${guest.branch}` : ""}</span>}
              {b.note && <span className="hint">Note: {b.note}</span>}
            </div>
          </div>
          {b.lease && (
            <div className="card">
              <h2>Lease</h2>
              <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
                <span>{fmtRange(b.lease.start_date, b.lease.end_date)}</span>
                <span>Rent {formatTHB(b.lease.rent_amount)}/month · paid monthly</span>
                <span>Deposit {formatTHB(b.lease.deposit_amount)} ({b.lease.deposit_months} months) · {b.lease.advance_months} month{b.lease.advance_months === 1 ? "" : "s"} in advance</span>
                <span className="hint">Notice to move out: {b.lease.notice_days} days</span>
                {b.lease.settled_at && <span>Deposit settled: {formatTHB(b.lease.deposit_used)} used · {formatTHB(b.lease.deposit_refunded)} returned</span>}
              </div>
            </div>
          )}
          <div className="card">
            <h2>Documents <span>{docs.length}</span></h2>
            {docs.length === 0 ? <span className="hint">Receipts are issued with payments. Use Invoice to bill what&apos;s due.</span> : (
              <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
                {docs.map((d) => (
                  <Link key={d.id} href={`${base}/documents/${d.number}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", opacity: d.status === "VOID" ? 0.55 : 1 }}>
                    <span><span className="code">{d.number}</span> · {d.type === "INVOICE" ? "Invoice" : "Receipt"}{d.status === "VOID" ? " · void" : ""}</span>
                    <span>{formatTHB(d.total)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <Corrections b={b} hidden={hidden} today={today} isManager={isManager} canBook={canBook} units={units} />
          <div className="card">
            <h2>Activity</h2>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              {b.history.map((h) => (
                <span key={h.id}><span className="dim">{fmtDateTime(h.changed_at)}</span> · {h.from_status === h.to_status ? "Edited" : BOOKING_STATUS[h.to_status].label}{h.reason ? ` — ${h.reason}` : ""}</span>
              ))}
              <span className="dim">Booked via {b.source.replace("_", " ").toLowerCase()} on {fmtDateTime(b.created_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
