import { ActionDialog } from "@/components/action-dialog";
import { formatTHB, satangToBaht } from "@/lib/money";
import { fmtDate, monthsBetween, parseStay, toLocalInput } from "@/lib/dates";
import { BOOKING_SOURCES, METHOD_LABEL, PAYMENT_METHODS } from "@/lib/booking-rules";
import type { BookingDetail, Payment } from "@/lib/bookings";
import type { Unit } from "@/lib/types";
import { addCharge, changeDailyStay, changeLease, correctPeriod, correctStatus, editPayment, updateBookingInfo } from "../../actions";

type Ctx = { b: BookingDetail; hidden: Record<string, string>; today: string; isManager: boolean; canBook: boolean };

const Hidden = ({ hidden, extra }: { hidden: Record<string, string>; extra?: Record<string, string> }) => (
  <>{Object.entries({ ...hidden, ...extra }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
);

const Reason = ({ placeholder = "What happened", optional }: { placeholder?: string; optional?: boolean }) => (
  <label className="lb full">Reason{optional ? <small>Optional</small> : <small>Saved in the booking&apos;s activity</small>}
    <input className="field" name="reason" required={!optional} placeholder={placeholder} />
  </label>
);

const fieldset = { border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8 } as const;

/** "Fix or change" card: every correction asks for a reason and is written to the activity log. */
export function Corrections({ b, hidden, today, isManager, canBook, units }: Ctx & { units: Unit[] }) {
  const g = b.guest;
  const closed = ["CANCELLED", "EXPIRED", "NO_SHOW"].includes(b.status);
  const past = b.status === "CHECKED_IN" || b.status === "CHECKED_OUT" || b.check_in < today;
  const canMoveDaily = b.mode === "DAILY" && !closed && (isManager || (canBook && !past));
  const leaseOpen = b.mode === "YEARLY" && b.lease && !b.lease.settled_at && !closed;
  const openPeriods = b.periods.filter((x) => x.status !== "CANCELLED" && x.status !== "WAIVED");
  const dailyUnits = units.filter((u) => u.allowed_modes.includes("DAILY") && (u.status === "ACTIVE" || u.id === b.unit_id));
  const yearlyUnits = units.filter((u) => u.allowed_modes.includes("YEARLY") && (u.status === "ACTIVE" || u.id === b.unit_id));
  const months = b.lease ? monthsBetween(b.lease.start_date, b.lease.end_date) : 0;
  const rentPaid = b.periods.some((x) => x.kind === "RENT" && x.paid_amount > 0);
  const nextUnpaidRent = b.periods.find((x) => x.kind === "RENT" && x.paid_amount === 0 && x.status !== "CANCELLED");

  if (!canBook && !isManager) return null;

  return (
    <div className="card">
      <h2>Fix or change <span>{isManager ? "every change needs a reason" : "some changes need a manager"}</span></h2>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        {canBook && (
          <ActionDialog label="Edit details" title="Edit details" subtitle={b.code} action={updateBookingInfo} submitLabel="Save" triggerClass="btn sm">
            <Hidden hidden={hidden} extra={{ guest_id: g?.id ?? "" }} />
            <div className="form">
              <label className="lb full">{b.mode === "YEARLY" ? "Tenant" : "Guest"} name<input className="field" name="full_name" required defaultValue={g?.full_name ?? ""} /></label>
              <label className="lb">Phone<input className="field" name="phone" inputMode="tel" defaultValue={g?.phone ?? ""} /></label>
              <label className="lb">Email<input className="field" name="email" type="email" defaultValue={g?.email ?? ""} /></label>
              <label className="lb">LINE ID<input className="field" name="line_id" defaultValue={g?.line_id ?? ""} /></label>
              <label className="lb">Booked via
                <select className="field" name="source" defaultValue={b.source}>{BOOKING_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label className="lb">Adults<input className="field" name="adults" type="number" min={1} max={b.unit?.room_type?.max_occupancy ?? 50} required defaultValue={b.adults} /></label>
              <label className="lb">Children<input className="field" name="children" type="number" min={0} max={50} defaultValue={b.children} /></label>
            </div>
            <fieldset style={fieldset}>
              <legend className="hint" style={{ padding: "0 4px" }}>Company billing (shown on invoices and receipts)</legend>
              <label className="check" style={{ border: 0, padding: 0, background: "none" }}><input type="checkbox" name="is_company" value="1" defaultChecked={g?.is_company} />Bill to a company</label>
              <div className="form">
                <label className="lb">Company name<input className="field" name="company_name" defaultValue={g?.company_name ?? ""} /></label>
                <label className="lb">Tax ID<input className="field" name="tax_id" inputMode="numeric" defaultValue={g?.tax_id ?? ""} /></label>
                <label className="lb">Branch<input className="field" name="branch" placeholder="Head office" defaultValue={g?.branch ?? ""} /></label>
                <label className="lb">Billing address<input className="field" name="billing_address" defaultValue={g?.billing_address ?? ""} /></label>
              </div>
            </fieldset>
            <label className="lb">Note<input className="field" name="note" defaultValue={b.note ?? ""} /></label>
            <p className="hint" style={{ margin: 0 }}>Guest details are shared by all of this guest&apos;s bookings. Documents already issued keep the old details; void and reissue them if needed.</p>
          </ActionDialog>
        )}

        {canMoveDaily && (
          <ActionDialog label="Change dates or unit" title="Change dates or unit" subtitle={`Now unit ${b.unit?.code} · ${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}`} action={changeDailyStay} submitLabel="Change stay" triggerClass="btn sm">
            <Hidden hidden={hidden} />
            <div className="form">
              <label className="lb full">Unit
                <select className="field" name="unit_id" defaultValue={b.unit_id}>{dailyUnits.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</select>
              </label>
              <label className="lb">Check-in<input className="field" type="date" name="start" required defaultValue={b.check_in} /></label>
              <label className="lb">Check-out<input className="field" type="date" name="end" required defaultValue={b.check_out} /></label>
              <Reason placeholder="Guest left a day early" />
            </div>
            <p className="hint" style={{ margin: 0 }}>Nights are re-priced at the unit&apos;s daily rate (weekend rate on Fri and Sat); extra charges and discounts stay. If more was paid than the new total, the difference is kept as credit; credit is used for anything now owed. {past && "Changing a stay that has started or ended needs a manager."}</p>
          </ActionDialog>
        )}

        {leaseOpen && isManager && b.lease && (
          <ActionDialog label="Change lease" title="Change lease" subtitle={`${fmtDate(b.lease.start_date)} – ${fmtDate(b.lease.end_date)} · ${formatTHB(b.lease.rent_amount)}/month`} action={changeLease} submitLabel="Save lease" triggerClass="btn sm">
            <Hidden hidden={hidden} extra={{ current_unit_id: b.unit_id, current_start: b.lease.start_date, current_months: String(months), current_rent: satangToBaht(b.lease.rent_amount) }} />
            <div className="form">
              <label className="lb">Unit
                <select className="field" name="unit_id" defaultValue={b.unit_id}>{yearlyUnits.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</select>
              </label>
              <label className="lb">Move-in date{rentPaid && <small>Locked: rent has been paid</small>}
                <input className="field" type="date" name="start" defaultValue={b.lease.start_date} readOnly={rentPaid} />
              </label>
              <label className="lb">Length (months)<small>Ends {fmtDate(b.lease.end_date)}</small><input className="field" type="number" name="months" min={1} max={120} defaultValue={months} /></label>
              <label className="lb">Monthly rent (฿)<input className="field" name="rent" inputMode="decimal" defaultValue={satangToBaht(b.lease.rent_amount)} /></label>
              <label className="lb">New rent applies from<small>Months starting on or after this date</small>
                <input className="field" type="date" name="rent_from" defaultValue={nextUnpaidRent?.period ? parseStay(nextUnpaidRent.period).start : today} />
              </label>
              <Reason placeholder="Tenant asked to extend 6 months" />
            </div>
            <p className="hint" style={{ margin: 0 }}>A shorter lease removes unpaid months at the end. Months already paid keep their rent. To move the move-in date after rent is paid, void those payments first.</p>
          </ActionDialog>
        )}

        {canBook && (!closed || isManager) && (
          <ActionDialog label="Add charge or discount" title="Add charge or discount" subtitle={b.code} action={addCharge} submitLabel="Add" triggerClass="btn sm">
            <Hidden hidden={hidden} />
            <div className="form">
              <label className="lb">Type
                <select className="field" name="kind" defaultValue="FEE">
                  <option value="FEE">Charge (guest pays more)</option>
                  {isManager && <option value="DISCOUNT">Discount (guest pays less)</option>}
                </select>
              </label>
              <label className="lb">Amount (฿)<input className="field" name="amount" inputMode="decimal" required /></label>
              <label className="lb full">Description<small>Shown on invoices</small><input className="field" name="description" required placeholder="Extra bed, late check-out, broken glass…" /></label>
              <label className="lb">Add to
                <select className="field" name="period_id" defaultValue="">
                  <option value="">A separate charge</option>
                  {openPeriods.map((x) => <option key={x.id} value={x.id}>{x.seq === 0 ? "Deposit and move-in" : x.label}</option>)}
                </select>
              </label>
              <label className="lb">Due (separate charge)<input className="field" type="date" name="due_date" defaultValue={today} /></label>
              <Reason optional placeholder="Why" />
            </div>
            {!isManager && <p className="hint" style={{ margin: 0 }}>Discounts need a manager.</p>}
          </ActionDialog>
        )}

        {isManager && b.status === "CHECKED_IN" && (
          <ActionDialog label="Undo check-in" title="Undo check-in" subtitle="The booking goes back to Confirmed" action={correctStatus} submitLabel="Undo check-in" triggerClass="btn sm quiet">
            <Hidden hidden={hidden} extra={{ action: "undo_check_in" }} />
            <Reason placeholder="Checked in the wrong booking" />
            {b.mode === "YEARLY" && <p className="hint" style={{ margin: 0 }}>Move-in meter readings that aren&apos;t billed yet are removed; take them again at check-in.</p>}
          </ActionDialog>
        )}
        {isManager && b.status === "CHECKED_OUT" && !b.lease?.settled_at && (
          <ActionDialog label="Undo check-out" title="Undo check-out" subtitle="The guest is in house again" action={correctStatus} submitLabel="Undo check-out" triggerClass="btn sm quiet">
            <Hidden hidden={hidden} extra={{ action: "undo_check_out" }} />
            <Reason placeholder="Pressed check-out by mistake" />
            <p className="hint" style={{ margin: 0 }}>The original check-out date comes back, and months cancelled for leaving early are reopened. Not possible if the unit has been booked since.</p>
          </ActionDialog>
        )}
        {isManager && closed && (
          <ActionDialog label="Reopen booking" title="Reopen booking" subtitle={`${b.code} · ${b.status.toLowerCase().replace("_", "-")}`} action={correctStatus} submitLabel="Reopen" triggerClass="btn sm">
            <Hidden hidden={hidden} extra={{ action: "reopen" }} />
            <Reason placeholder="Cancelled by mistake" />
            <p className="hint" style={{ margin: 0 }}>The booking becomes Confirmed (or Checked out if its dates have passed) and its charges are open again. Refunds already given stay recorded. Not possible if the unit has been booked for these dates since.</p>
          </ActionDialog>
        )}
        {isManager && (b.status === "CHECKED_IN" || b.status === "CHECKED_OUT") && (
          <ActionDialog label="Fix arrival/departure time" title="Arrival and departure times" subtitle="Bangkok time" action={correctStatus} submitLabel="Save times" triggerClass="btn sm quiet">
            <Hidden hidden={hidden} extra={{ action: "set_times" }} />
            <div className="form">
              <label className="lb">Checked in at<input className="field" type="datetime-local" name="check_in_at" defaultValue={toLocalInput(b.actual_check_in)} /></label>
              {b.status === "CHECKED_OUT" && <label className="lb">Checked out at<input className="field" type="datetime-local" name="check_out_at" defaultValue={toLocalInput(b.actual_check_out)} /></label>}
              <Reason placeholder="Recorded late" />
            </div>
          </ActionDialog>
        )}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {isManager
          ? "Use the Edit button on a period to change its due date, waive it or remove a charge. Payments can be edited under Payments received."
          : "Changes to past stays, money already billed and payments need a manager."}
      </p>
    </div>
  );
}

/** Per-period "Edit" for managers: due date, waive, remove a charge. */
export function PeriodEdit({ x, hidden }: { x: BookingDetail["periods"][number]; hidden: Record<string, string> }) {
  const state = x.status === "WAIVED" ? "WAIVED" : x.status === "CANCELLED" ? "CANCELLED" : "OPEN";
  return (
    <ActionDialog label="Edit" title={x.seq === 0 ? "Deposit and move-in" : x.label} subtitle={`${formatTHB(x.total_amount)} · paid ${formatTHB(x.paid_amount)}`} action={correctPeriod} submitLabel="Save" triggerClass="btn sm quiet">
      <Hidden hidden={hidden} extra={{ period_id: x.id, current_due: x.due_date, current_state: state }} />
      <div className="form">
        <label className="lb">Due date<input className="field" type="date" name="due_date" defaultValue={x.due_date} /></label>
        <label className="lb">Status
          <select className="field" name="state" defaultValue={state}>
            <option value="OPEN">Open (to be paid)</option>
            {(state === "OPEN" || state === "WAIVED") && <option value="WAIVED">Waived (not charged)</option>}
            {state === "CANCELLED" && <option value="CANCELLED">Cancelled</option>}
          </select>
        </label>
        {x.lines.length > 0 && (
          <label className="lb full">Remove a charge<small>Meter charges removed here can be billed again from the Meters page</small>
            <select className="field" name="remove_line" defaultValue="">
              <option value="">Keep all charges</option>
              {x.lines.map((l) => <option key={l.id} value={l.id}>{l.description} · {formatTHB(l.amount)}</option>)}
            </select>
          </label>
        )}
        <Reason placeholder="Agreed with the guest" />
      </div>
      <p className="hint" style={{ margin: 0 }}>If the period ends up costing less than what was paid on it, the difference is kept as the guest&apos;s credit.</p>
    </ActionDialog>
  );
}

/** Edit date, method and reference of a payment; its receipt is reissued. */
export function PaymentEdit({ pay, hidden, today, isCompany, hasReceipt }: { pay: Payment; hidden: Record<string, string>; today: string; isCompany: boolean; hasReceipt: boolean }) {
  return (
    <ActionDialog label="Edit" title="Edit payment" subtitle={`${formatTHB(pay.amount)} · ${METHOD_LABEL[pay.method] ?? pay.method} on ${fmtDate(pay.paid_at)}`} action={editPayment} submitLabel="Save payment" triggerClass="btn sm quiet">
      <Hidden hidden={hidden} extra={{ payment_id: pay.id }} />
      <div className="form">
        <label className="lb">Date received<input className="field" type="date" name="paid_at" required max={today} defaultValue={pay.paid_at} /></label>
        <label className="lb">Method
          <select className="field" name="method" defaultValue={pay.method}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="lb">Reference<input className="field" name="reference" defaultValue={pay.reference ?? ""} /></label>
        <label className="lb">Note<input className="field" name="note" defaultValue={pay.note ?? ""} /></label>
        {isCompany && <label className="lb">WHT certificate no.<input className="field" name="wht_cert_no" defaultValue={pay.wht_cert_no ?? ""} /></label>}
        <Reason placeholder="Wrong date entered" />
      </div>
      <p className="hint" style={{ margin: 0 }}>To change the amount, void this payment and record it again.{hasReceipt ? " The receipt is voided and a new one is issued with the new details." : ""}</p>
    </ActionDialog>
  );
}
