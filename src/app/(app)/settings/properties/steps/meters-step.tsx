import { ActionForm } from "@/components/action-form";
import { createClient } from "@/lib/supabase/server";
import { getProperty, getUnits } from "@/lib/properties";
import { satangToBaht } from "@/lib/money";
import { saveUtilities } from "../actions";
import { NextStep } from "./next-link";

export async function MetersStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const units = (await getUnits(p.id)).filter((u) => u.allowed_modes.includes("YEARLY"));
  const supabase = await createClient();
  const [{ data: rates }, { data: meters }] = await Promise.all([
    supabase.from("utility_rates").select("utility, price_per_unit, minimum_charge, effective_from").eq("property_id", p.id).order("effective_from", { ascending: false }),
    units.length
      ? supabase.from("meters").select("unit_id, utility, initial_value").in("unit_id", units.map((u) => u.id)).is("retired_on", null)
      : Promise.resolve({ data: [] as { unit_id: string; utility: string; initial_value: number }[] }),
  ]);
  const latest = (u: "WATER" | "ELECTRIC") => (rates ?? []).find((r) => r.utility === u);
  const start = (unitId: string, u: string) => (meters ?? []).find((m) => m.unit_id === unitId && m.utility === u)?.initial_value ?? "";
  const w = latest("WATER");
  const e = latest("ELECTRIC");

  return (
    <ActionForm action={saveUtilities} footer={<NextStep code={p.code} from="meters" />}>
      <input type="hidden" name="property_id" value={p.id} />
      <h2>Water and electricity <span>Optional — you can open the property now and set these later. Needed only before billing yearly tenants by meter. Daily stays include utilities.</span></h2>
      <div className="form f4">
        <label className="lb">Water, per unit (฿)<input className="field" name="water_price" inputMode="decimal" defaultValue={satangToBaht(w?.price_per_unit)} placeholder="18" /></label>
        <label className="lb">Water minimum (฿/month)<input className="field" name="water_min" inputMode="decimal" defaultValue={satangToBaht(w?.minimum_charge)} placeholder="100" /></label>
        <label className="lb">Electricity, per unit (฿)<input className="field" name="electric_price" inputMode="decimal" defaultValue={satangToBaht(e?.price_per_unit)} placeholder="8" /></label>
        <label className="lb">Electricity minimum (฿/month)<input className="field" name="electric_min" inputMode="decimal" defaultValue={satangToBaht(e?.minimum_charge)} placeholder="0" /></label>
      </div>
      {units.length > 0 ? (
        <>
          <h2>Starting meter readings <span>Optional now. Each tenant&apos;s move-in reading is taken at check-in.</span></h2>
          <div className="panel tw">
            <table className="t">
              <thead><tr><th>Unit</th><th>Floor</th><th className="r">Water</th><th className="r">Electricity</th></tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="unit">{u.code}</td>
                    <td>{u.floor ?? "–"}</td>
                    <td className="r"><input className="field" style={{ width: 120, textAlign: "right" }} name={`start_WATER_${u.id}`} inputMode="decimal" defaultValue={start(u.id, "WATER")} aria-label={`Water meter ${u.code}`} /></td>
                    <td className="r"><input className="field" style={{ width: 120, textAlign: "right" }} name={`start_ELECTRIC_${u.id}`} inputMode="decimal" defaultValue={start(u.id, "ELECTRIC")} aria-label={`Electricity meter ${u.code}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="hint">No units are rented yearly, so there are no meters to set up. You can still save prices for later.</p>
      )}
    </ActionForm>
  );
}
