import type { Property } from "@/lib/types";
import { PROPERTY_TYPE_LABEL } from "@/lib/types";

/** Shared by "New property" and the Details step. */
export function DetailsFields({ p }: { p?: Property }) {
  return (
    <div className="form">
      <label className="lb">Property name<input className="field" name="name" required maxLength={120} defaultValue={p?.name} placeholder="Sukhumvit Residence" /></label>
      <label className="lb">Code<small>2–6 letters or numbers. Starts every booking and receipt number, e.g. SKV-RC-2026-00001</small>
        <input className="field" name="code" required pattern="[A-Za-z0-9]{2,6}" maxLength={6} defaultValue={p?.code} placeholder="SKV" style={{ textTransform: "uppercase" }} />
      </label>
      <label className="lb">Type
        <select className="field" name="type" defaultValue={p?.type ?? "APARTMENT"}>
          {Object.entries(PROPERTY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="lb">Phone<input className="field" name="phone" type="tel" defaultValue={p?.phone ?? ""} /></label>
      <label className="lb full">Address<textarea className="field" name="address" defaultValue={p?.address ?? ""} /></label>
      <label className="lb">Check-in time<input className="field" name="check_in_time" type="time" required defaultValue={p?.check_in_time?.slice(0, 5) ?? "14:00"} /></label>
      <label className="lb">Check-out time<input className="field" name="check_out_time" type="time" required defaultValue={p?.check_out_time?.slice(0, 5) ?? "12:00"} /></label>
      <label className="lb">Meter reading day<small>Day of the month you read water and electricity meters</small>
        <input className="field" name="meter_reading_day" type="number" min={1} max={28} required defaultValue={p?.meter_reading_day ?? 25} />
      </label>
      <label className="lb">Grace days for rent<small>Days after the due date before rent counts as overdue</small>
        <input className="field" name="grace_days" type="number" min={0} max={60} required defaultValue={p?.grace_days ?? 5} />
      </label>
      <label className="lb full">How to pay<small>Bank account or PromptPay details printed on invoices</small>
        <textarea className="field" name="payment_instructions" defaultValue={p?.payment_instructions ?? ""} placeholder="Kasikorn Bank 123-4-56789-0 · Sukhumvit Residence Co., Ltd." />
      </label>
    </div>
  );
}
