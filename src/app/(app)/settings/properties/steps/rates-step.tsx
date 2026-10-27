import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { getProperty, getRatePlans, getRoomTypes, getUnits } from "@/lib/properties";
import { satangToBaht } from "@/lib/money";
import { saveRates } from "../actions";
import { NextStep } from "./next-link";

export async function RatesStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const [types, units] = await Promise.all([getRoomTypes(p.id), getUnits(p.id)]);
  const rates = await getRatePlans(types.map((t) => t.id));
  const supabase = await createClient();
  const { data: policies } = await supabase.from("cancellation_policies").select("id, name").order("name");

  const used = types.filter((t) => units.some((u) => u.room_type_id === t.id));
  if (used.length === 0) {
    return (
      <div className="empty">
        <b>Add units first</b>
        <span>Rates are set per room type for the ways its units are rented.</span>
        <Link className="btn primary" href={`/settings/properties/${p.code}/units`}>Go to units</Link>
      </div>
    );
  }

  return (
    <>
      {used.map((t, i) => {
        const tUnits = units.filter((u) => u.room_type_id === t.id);
        const daily = tUnits.some((u) => u.allowed_modes.includes("DAILY"));
        const yearly = tUnits.some((u) => u.allowed_modes.includes("YEARLY"));
        const d = rates.find((r) => r.room_type_id === t.id && r.mode === "DAILY");
        const y = rates.find((r) => r.room_type_id === t.id && r.mode === "YEARLY");
        return (
          <ActionForm key={t.id} action={saveRates} submitLabel={`Save ${t.name} rates`} footer={i === used.length - 1 ? <NextStep code={p.code} from="rates" /> : undefined}>
            <h2>{t.name} <span>{tUnits.length} units</span></h2>
            <input type="hidden" name="room_type_id" value={t.id} />
            {daily && (
              <>
                <input type="hidden" name="has_daily" value="1" />
                <div className="form f4">
                  <label className="lb">Nightly rate (฿)<input className="field" name="daily_base_amount" inputMode="decimal" required defaultValue={satangToBaht(d?.base_amount)} placeholder="1400" /></label>
                  <label className="lb">Fri–Sat nights (฿)<small>Optional</small><input className="field" name="daily_weekend_amount" inputMode="decimal" defaultValue={satangToBaht(d?.weekend_amount)} placeholder="1700" /></label>
                  <label className="lb">Min nights<input className="field" name="daily_min_length" type="number" min={1} max={365} required defaultValue={d?.min_length ?? 1} /></label>
                  <label className="lb">Max nights<small>Optional</small><input className="field" name="daily_max_length" type="number" min={1} max={365} defaultValue={d?.max_length ?? ""} /></label>
                  <label className="lb">Cancellation policy
                    <select className="field" name="daily_cancellation_policy_id" defaultValue={d?.cancellation_policy_id ?? ""}>
                      <option value="">None</option>
                      {(policies ?? []).map((pol) => <option key={pol.id} value={pol.id}>{pol.name}</option>)}
                    </select>
                  </label>
                </div>
              </>
            )}
            {daily && yearly && <div style={{ height: 1, background: "var(--line)" }} />}
            {yearly && (
              <>
                <input type="hidden" name="has_yearly" value="1" />
                <div className="form f4">
                  <label className="lb">Monthly rent (฿)<small>Yearly leases are paid monthly</small><input className="field" name="yearly_base_amount" inputMode="decimal" required defaultValue={satangToBaht(y?.base_amount)} placeholder="15000" /></label>
                  <label className="lb">Deposit (months)<input className="field" name="yearly_deposit_months" type="number" min={0} max={12} step="0.5" required defaultValue={y?.deposit_months ?? 2} /></label>
                  <label className="lb">Rent in advance (months)<input className="field" name="yearly_advance_months" type="number" min={0} max={12} required defaultValue={y?.advance_months ?? 1} /></label>
                  <label className="lb">Minimum term (years)<input className="field" name="yearly_min_length" type="number" min={1} max={10} required defaultValue={y?.min_length ?? 1} /></label>
                </div>
              </>
            )}
          </ActionForm>
        );
      })}
    </>
  );
}
