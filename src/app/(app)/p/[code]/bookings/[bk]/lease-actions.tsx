import { ActionDialog } from "@/components/action-dialog";
import { formatTHB, satangToBaht } from "@/lib/money";
import { addMonths, daysBetween, fmtDate } from "@/lib/dates";
import type { BookingDetail } from "@/lib/bookings";
import { giveNotice, renewLease, withdrawNotice } from "../../actions";

type Props = { b: BookingDetail; hidden: Record<string, string>; today: string; isManager: boolean; canBook: boolean };

const Hidden = ({ hidden }: { hidden: Record<string, string> }) => <>{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;

/** Lease card: term, rent, deposit, notice status, and renew / notice buttons. */
export function LeaseCard({ b, hidden, today, isManager, canBook }: Props) {
  const le = b.lease!;
  const active = b.status === "CONFIRMED" || b.status === "CHECKED_IN";
  const left = daysBetween(today, le.end_date);
  const noticeDays = le.move_out_on && le.notice_given_on ? daysBetween(le.notice_given_on, le.move_out_on) : null;

  return (
    <div className="card">
      <h2>Lease {le.renewed_count > 0 && <span>renewed {le.renewed_count}×</span>}</h2>
      <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
        <span>{fmtDate(le.start_date)} – {fmtDate(le.end_date)}</span>
        <span>Rent {formatTHB(le.rent_amount)}/month · paid monthly</span>
        <span>Deposit {formatTHB(le.deposit_amount)} ({le.deposit_months} months) · {le.advance_months} month{le.advance_months === 1 ? "" : "s"} in advance</span>
        <span className="hint">Notice to move out: {le.notice_days} days</span>
        {active && !le.move_out_on && left >= 0 && left <= 60 && <span className="st warn" style={{ justifySelf: "start" }}>Ends in {left} day{left === 1 ? "" : "s"} — renew or take notice</span>}
        {le.move_out_on && (
          <span className="notice" style={{ margin: "4px 0 0" }}>
            <span>
              <b>Moving out {fmtDate(le.move_out_on)}</b>
              {le.notice_given_on && <> · notice given {fmtDate(le.notice_given_on)}{noticeDays !== null && noticeDays < le.notice_days ? ` (${le.notice_days - noticeDays} days short)` : ""}</>}
            </span>
          </span>
        )}
        {le.settled_at && <span>Deposit settled: {formatTHB(le.deposit_used)} used · {formatTHB(le.deposit_refunded)} returned</span>}
      </div>

      {active && (
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          {isManager && !le.move_out_on && (
            <ActionDialog label="Renew lease" title="Renew lease" subtitle={`Now ends ${fmtDate(le.end_date)}`} action={renewLease} submitLabel="Renew" triggerClass="btn sm primary">
              <Hidden hidden={hidden} />
              <div className="form">
                <label className="lb">Add (months)<small>New end: {fmtDate(addMonths(le.end_date, 12))} for 12</small><input className="field" type="number" name="months" min={1} max={60} defaultValue={12} required /></label>
                <label className="lb">Monthly rent from {fmtDate(le.end_date, false)} (฿)<input className="field" name="rent" inputMode="decimal" defaultValue={satangToBaht(le.rent_amount)} /></label>
                <label className="lb">Deposit top-up (฿)<small>Optional, e.g. when rent goes up. Due {fmtDate(le.end_date)}</small><input className="field" name="deposit_topup" inputMode="decimal" placeholder="0" /></label>
                <label className="lb">Note<small>Optional</small><input className="field" name="reason" placeholder="Renewed at 5% higher rent" /></label>
              </div>
              <p className="hint" style={{ margin: 0 }}>Same booking and deposit; new monthly bills are added after the current end date. Refused if the unit is already booked after that date.</p>
            </ActionDialog>
          )}
          {canBook && (
            <ActionDialog label={le.move_out_on ? "Change move-out" : "Notice to move out"} title="Notice to move out" subtitle={`Agreed notice: ${le.notice_days} days`} action={giveNotice} submitLabel="Save notice" triggerClass="btn sm">
              <Hidden hidden={hidden} />
              <div className="form">
                <label className="lb">Notice given on<input className="field" type="date" name="notice_date" max={today} defaultValue={le.notice_given_on ?? today} required /></label>
                <label className="lb">Moving out on<small>The unit is free from this date. Lease ends {fmtDate(le.end_date)}</small>
                  <input className="field" type="date" name="move_out" max={le.end_date} defaultValue={le.move_out_on ?? le.end_date} required />
                </label>
                <label className="lb full">Reason<small>Optional</small><input className="field" name="reason" placeholder="Moving for work" /></label>
              </div>
              <p className="hint" style={{ margin: 0 }}>Unpaid rent for months starting on or after the move-out date is cancelled, and the unit can be booked from that date. Check the tenant out and settle the deposit on the day.</p>
            </ActionDialog>
          )}
          {canBook && le.move_out_on && (
            <ActionDialog label="Withdraw notice" title="Withdraw notice" subtitle="The tenant is staying to the end of the lease" action={withdrawNotice} submitLabel="Withdraw notice" triggerClass="btn sm quiet">
              <Hidden hidden={hidden} />
              <label className="lb">Reason<small>Optional</small><input className="field" name="reason" placeholder="Changed plans" /></label>
            </ActionDialog>
          )}
        </div>
      )}
    </div>
  );
}
