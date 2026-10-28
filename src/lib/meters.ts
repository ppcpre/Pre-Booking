import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/photos";

export type Utility = "WATER" | "ELECTRIC";

export type MeterRow = {
  unitId: string;
  unitCode: string;
  floor: string | null;
  tenant: string | null;
  bookingCode: string | null;
  last: { value: number; date: string } | null;
  current: { id: string; value: number; photoUrl: string | null; billed: boolean } | null;
  avgUse: number | null; // average monthly use of the last 3 readings, for spotting odd numbers
};

/** One row per unit that is rented yearly (or already has a meter), for the reading sheet on a date. */
export async function meterSheet(propertyId: string, date: string, utility: Utility): Promise<MeterRow[]> {
  const supabase = await createClient();
  const [{ data: units }, { data: readings }, { data: meters }, { data: tenants }] = await Promise.all([
    supabase.from("units").select("id, code, floor, allowed_modes, status").eq("property_id", propertyId),
    supabase.from("meter_readings").select("id, unit_id, reading_date, value, photo_path, billed_line_id, meter:meters!inner(utility)").eq("property_id", propertyId).eq("meter.utility", utility).lte("reading_date", date).order("reading_date", { ascending: false }).limit(2000),
    supabase.from("meters").select("unit_id, initial_value, installed_on").eq("utility", utility).is("retired_on", null),
    supabase.from("bookings").select("unit_id, code, guest:guests(full_name)").eq("property_id", propertyId).eq("mode", "YEARLY").in("status", ["CONFIRMED", "CHECKED_IN"]).lte("check_in", date).gt("check_out", date),
  ]);
  const byUnit = new Map<string, { id: string; reading_date: string; value: number; photo_path: string | null; billed_line_id: string | null }[]>();
  for (const r of readings ?? []) byUnit.set(r.unit_id, [...(byUnit.get(r.unit_id) ?? []), r]);
  const photoUrls = await signedUrls("meter-photos", (readings ?? []).filter((r) => r.reading_date === date).map((r) => r.photo_path));
  const meterOf = new Map((meters ?? []).map((m) => [m.unit_id, m]));
  const tenantOf = new Map((tenants ?? []).map((t) => [t.unit_id, t as unknown as { code: string; guest: { full_name: string } | null }]));

  return (units ?? [])
    .filter((u) => (u.allowed_modes as string[]).includes("YEARLY") || meterOf.has(u.id))
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((u) => {
      const list = byUnit.get(u.id) ?? [];
      const today = list.find((r) => r.reading_date === date);
      const before = list.filter((r) => r.reading_date < date);
      const m = meterOf.get(u.id);
      const last = before[0] ? { value: Number(before[0].value), date: before[0].reading_date } : m && m.installed_on < date ? { value: Number(m.initial_value), date: m.installed_on } : null;
      const uses = before.slice(0, 4).map((r) => Number(r.value)).reduce<number[]>((acc, v, i, arr) => (i > 0 ? [...acc, arr[i - 1]! - v] : acc), []).filter((x) => x >= 0);
      const t = tenantOf.get(u.id);
      return {
        unitId: u.id,
        unitCode: u.code,
        floor: u.floor,
        tenant: t?.guest?.full_name ?? null,
        bookingCode: t?.code ?? null,
        last,
        current: today ? { id: today.id, value: Number(today.value), photoUrl: today.photo_path ? photoUrls[today.photo_path] ?? null : null, billed: !!today.billed_line_id } : null,
        avgUse: uses.length ? uses.reduce((a, b) => a + b, 0) / uses.length : null,
      };
    });
}
