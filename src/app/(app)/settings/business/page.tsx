import { ActionForm } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/session";
import { saveBusiness } from "./actions";

export const metadata = { title: "Business" };

export default async function BusinessPage() {
  await requireRole("ADMIN");
  const supabase = await createClient();
  const { data: b } = await supabase.from("business_settings").select("*").single();

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="head"><div><h1>Business</h1><p>Shown on invoices and receipts unless a property sets its own details.</p></div></div>
      <ActionForm action={saveBusiness}>
        <div className="form">
          <label className="lb full">Business name<input className="field" name="legal_name" required defaultValue={b?.legal_name ?? ""} /></label>
          <label className="lb full">Address<textarea className="field" name="address" defaultValue={b?.address ?? ""} /></label>
          <label className="lb">Tax ID<small>Optional</small><input className="field" name="tax_id" inputMode="numeric" defaultValue={b?.tax_id ?? ""} /></label>
          <label className="lb">Phone<input className="field" name="phone" type="tel" defaultValue={b?.phone ?? ""} /></label>
          <label className="lb">Reservation pay-by window (hours)<small>Default for yearly reservations; daily ones are due by check-in</small>
            <input className="field" name="hold_hours" type="number" min={1} max={720} defaultValue={b?.hold_hours ?? 24} />
          </label>
          <label className="lb">Front desk discount limit (%)<small>Bigger discounts need a manager</small>
            <input className="field" name="front_desk_discount_limit_pct" type="number" min={0} max={100} step="0.5" defaultValue={b?.front_desk_discount_limit_pct ?? 10} />
          </label>
        </div>
      </ActionForm>
    </div>
  );
}
