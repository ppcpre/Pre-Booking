"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { bahtToSatang } from "@/lib/money";
import { expandUnitRange } from "@/lib/units";
import { activationBlockers, type SetupStatus } from "@/lib/setup";
import { PHOTO_BUCKET } from "@/lib/photos";
import { firstError, formToObject, modesSchema, propertySchema, roomTypeSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";

const manager = () => requireRole("ADMIN", "MANAGER");
const uuid = z.string().uuid();

function refresh(code: string) {
  revalidatePath("/", "layout");
  revalidatePath(`/settings/properties/${code}`, "layout");
  revalidatePath(`/p/${code}`);
}

async function codeOf(propertyId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("properties").select("code").eq("id", propertyId).single();
  if (!data) throw new Error("Property not found");
  return data.code;
}

// ------------------------------------------------------------------ details
export async function createProperty(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const parsed = propertySchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("properties").insert(parsed.data).select("id, code").single();
  if (error) return { error: error.code === "23505" ? `Code ${parsed.data.code} is already used by another property` : "Couldn't create the property. Try again." };
  await audit(me.userId, "property.create", "property", data.id, parsed.data);
  refresh(data.code);
  redirect(`/settings/properties/${data.code}/rooms`);
}

export async function updateDetails(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const parsed = propertySchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const oldCode = await codeOf(id);
  const supabase = await createClient();
  const { error } = await supabase.from("properties").update(parsed.data).eq("id", id);
  if (error) return { error: error.code === "23505" ? `Code ${parsed.data.code} is already used by another property` : "Couldn't save. Try again." };
  await audit(me.userId, "property.update", "property", id, parsed.data);
  refresh(oldCode);
  if (oldCode !== parsed.data.code) redirect(`/settings/properties/${parsed.data.code}/details`);
  return { ok: true, message: "Saved" };
}

/** Called by the photo uploader after the file is in storage. Removes the previous photo. */
export async function setPropertyPhoto(propertyId: string, path: string): Promise<ActionResult> {
  await manager();
  const id = uuid.parse(propertyId);
  if (!path.startsWith(`${id}/`)) return { error: "Upload failed. Try again." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("properties").select("photo_path, code").eq("id", id).single();
  const { error } = await supabase.from("properties").update({ photo_path: path }).eq("id", id);
  if (error) return { error: "Couldn't save the photo. Try again." };
  if (before?.photo_path && before.photo_path !== path) await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_path]);
  refresh(before?.code ?? "");
  return { ok: true, message: "Photo updated" };
}

export async function removePropertyPhoto(fd: FormData) {
  await manager();
  const id = uuid.parse(fd.get("property_id"));
  const supabase = await createClient();
  const { data: before } = await supabase.from("properties").select("photo_path, code").eq("id", id).single();
  await supabase.from("properties").update({ photo_path: null }).eq("id", id);
  if (before?.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([before.photo_path]);
  refresh(before?.code ?? "");
}

// ------------------------------------------------------------------ room types
export async function addRoomType(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const parsed = roomTypeSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("room_types").insert({ ...parsed.data, property_id: id }).select("id").single();
  if (error) return { error: error.code === "23505" ? `There is already a room type called ${parsed.data.name}` : "Couldn't add the room type. Try again." };
  await audit(me.userId, "room_type.create", "room_type", data.id, parsed.data);
  refresh(await codeOf(id));
  return { ok: true, message: `Added ${parsed.data.name}` };
}

export async function deleteRoomType(fd: FormData) {
  const me = await manager();
  const id = uuid.parse(fd.get("id"));
  const supabase = await createClient();
  const { data: rt } = await supabase.from("room_types").select("property_id").eq("id", id).single();
  // Units reference the room type (on delete restrict), so this only succeeds when it has no units.
  await supabase.from("room_types").delete().eq("id", id);
  await audit(me.userId, "room_type.delete", "room_type", id);
  if (rt) refresh(await codeOf(rt.property_id));
}

// ------------------------------------------------------------------ units
const unitBatchSchema = z.object({
  from: z.string(),
  to: z.string(),
  prefix: z.string().max(6).default(""),
  floor: z.string().trim().max(10).transform((v) => (v === "" ? null : v)),
  room_type_id: uuid,
  modes: modesSchema,
});

export async function addUnits(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const parsed = unitBatchSchema.safeParse(formToObject(fd, ["modes"]));
  if (!parsed.success) return { error: firstError(parsed.error) };
  let codes: string[];
  try {
    codes = expandUnitRange(parsed.data.from, parsed.data.to || parsed.data.from, parsed.data.prefix);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase.from("units").select("code").eq("property_id", id).in("code", codes);
  const taken = new Set((existing ?? []).map((u) => u.code));
  const fresh = codes.filter((c) => !taken.has(c));
  if (fresh.length === 0) return { error: "All of these units already exist" };
  const { error } = await supabase.from("units").insert(
    fresh.map((code) => ({ property_id: id, room_type_id: parsed.data.room_type_id, code, floor: parsed.data.floor, allowed_modes: parsed.data.modes })),
  );
  if (error) return { error: "Couldn't add the units. Try again." };
  await audit(me.userId, "unit.bulk_create", "property", id, { codes: fresh });
  refresh(await codeOf(id));
  const skipped = codes.length - fresh.length;
  return { ok: true, message: `Added ${fresh.length} unit${fresh.length > 1 ? "s" : ""}${skipped ? ` · skipped ${skipped} that already exist` : ""}` };
}

const unitUpdateSchema = z.object({
  id: uuid,
  modes: modesSchema,
  status: z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]),
  room_type_id: uuid,
});

export async function updateUnit(fd: FormData) {
  const me = await manager();
  const result = unitUpdateSchema.safeParse(formToObject(fd, ["modes"]));
  if (!result.success) return; // e.g. both Daily and Yearly unticked: keep the unit as it was
  const parsed = result.data;
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .update({ allowed_modes: parsed.modes, status: parsed.status, room_type_id: parsed.room_type_id })
    .eq("id", parsed.id)
    .select("property_id")
    .single();
  await audit(me.userId, "unit.update", "unit", parsed.id, parsed);
  if (data) refresh(await codeOf(data.property_id));
}

export async function deleteUnit(fd: FormData) {
  const me = await manager();
  const id = uuid.parse(fd.get("id"));
  const supabase = await createClient();
  const { data } = await supabase.from("units").delete().eq("id", id).select("property_id, code").single();
  await audit(me.userId, "unit.delete", "unit", id, data);
  if (data) refresh(await codeOf(data.property_id));
}

// ------------------------------------------------------------------ rates
const money = (label: string) =>
  z.string().transform((v, ctx) => {
    try {
      return bahtToSatang(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}: enter an amount like 1500` });
      return z.NEVER;
    }
  });
const optionalMoney = (label: string) =>
  z.string().transform((v, ctx) => {
    if (v.trim() === "") return null;
    try {
      return bahtToSatang(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}: enter an amount like 1500` });
      return z.NEVER;
    }
  });

const dailySchema = z.object({
  base_amount: money("Nightly rate").refine((v) => v > 0, "Nightly rate must be more than 0"),
  weekend_amount: optionalMoney("Fri–Sat rate"),
  min_length: z.coerce.number().int().min(1, "Minimum stay is at least 1 night").max(365),
  max_length: z.string().transform((v) => (v.trim() === "" ? null : Number(v))),
  cancellation_policy_id: z.string().transform((v) => (v === "" ? null : v)),
});
const yearlySchema = z.object({
  base_amount: money("Monthly rent").refine((v) => v > 0, "Monthly rent must be more than 0"),
  min_length: z.coerce.number().int().min(1).max(10),
  deposit_months: z.coerce.number().min(0).max(12),
  advance_months: z.coerce.number().int().min(0).max(12),
});

/** Saves the Daily and/or Yearly rate of one room type. Field names are prefixed "daily_" and "yearly_". */
export async function saveRates(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const roomTypeId = uuid.parse(fd.get("room_type_id"));
  const pick = (prefix: string) =>
    Object.fromEntries([...fd.keys()].filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), String(fd.get(k) ?? "")]));
  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];

  if (fd.get("has_daily") === "1") {
    const d = dailySchema.safeParse(pick("daily_"));
    if (!d.success) return { error: firstError(d.error) };
    if (d.data.max_length !== null && d.data.max_length < d.data.min_length) return { error: "Maximum stay must be at least the minimum stay" };
    rows.push({ room_type_id: roomTypeId, mode: "DAILY", ...d.data, deposit_months: null, advance_months: null, is_active: true });
  }
  if (fd.get("has_yearly") === "1") {
    const y = yearlySchema.safeParse(pick("yearly_"));
    if (!y.success) return { error: firstError(y.error) };
    rows.push({ room_type_id: roomTypeId, mode: "YEARLY", ...y.data, weekend_amount: null, max_length: null, cancellation_policy_id: null, is_active: true });
  }
  if (rows.length === 0) return { error: "Nothing to save" };
  const { data: saved, error } = await supabase.from("rate_plans").upsert(rows, { onConflict: "room_type_id,mode" }).select("room_type_id");
  if (error || !saved?.length) return { error: "Couldn't save the rates. Try again." };
  await audit(me.userId, "rates.save", "room_type", roomTypeId, rows);
  const { data: rt } = await supabase.from("room_types").select("property_id").eq("id", roomTypeId).single();
  if (rt) refresh(await codeOf(rt.property_id));
  return { ok: true, message: "Rates saved" };
}

// ------------------------------------------------------------------ meters & utility prices
export async function saveUtilities(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const supabase = await createClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

  const rates = [];
  for (const utility of ["WATER", "ELECTRIC"] as const) {
    const key = utility.toLowerCase();
    if (String(fd.get(`${key}_price`) ?? "").trim() === "") continue; // optional: set later
    try {
      rates.push({
        property_id: id,
        utility,
        price_per_unit: bahtToSatang(String(fd.get(`${key}_price`) ?? "")),
        minimum_charge: String(fd.get(`${key}_min`) ?? "").trim() === "" ? 0 : bahtToSatang(String(fd.get(`${key}_min`))),
        effective_from: today,
      });
    } catch {
      return { error: `${utility === "WATER" ? "Water" : "Electricity"}: enter a price per unit like 18 or 8.50` };
    }
  }
  if (rates.length) {
    const { error } = await supabase.from("utility_rates").upsert(rates, { onConflict: "property_id,utility,effective_from" });
    if (error) return { error: "Couldn't save the prices. Try again." };
  }

  // Starting meter readings, one pair per unit: field names "start_WATER_<unitId>" / "start_ELECTRIC_<unitId>".
  const { data: units } = await supabase.from("units").select("id").eq("property_id", id);
  const unitIds = new Set((units ?? []).map((u) => u.id));
  const { data: meters } = await supabase.from("meters").select("id, unit_id, utility").in("unit_id", [...unitIds]).is("retired_on", null);
  const known = new Map((meters ?? []).map((m) => [`${m.utility}_${m.unit_id}`, m.id]));
  for (const [key, raw] of fd.entries()) {
    const m = key.match(/^start_(WATER|ELECTRIC)_([0-9a-f-]{36})$/);
    const value = String(raw).trim().replace(/,/g, "");
    if (!m || value === "" || !unitIds.has(m[2]!)) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { error: "Meter readings must be positive numbers" };
    const existing = known.get(`${m[1]}_${m[2]}`);
    if (existing) await supabase.from("meters").update({ initial_value: n }).eq("id", existing);
    else await supabase.from("meters").insert({ unit_id: m[2], utility: m[1], initial_value: n });
  }
  await audit(me.userId, "utilities.save", "property", id, rates);
  refresh(await codeOf(id));
  return { ok: true, message: "Saved" };
}

// ------------------------------------------------------------------ staff & status
export async function saveStaff(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const emails = fd.getAll("emails").map(String);
  const supabase = await createClient();
  const { data: current } = await supabase.from("property_staff").select("email").eq("property_id", id);
  const now = new Set((current ?? []).map((r) => r.email));
  const want = new Set(emails);
  const add = [...want].filter((e) => !now.has(e));
  const remove = [...now].filter((e) => !want.has(e) && e !== me.email); // never remove yourself here
  if (add.length) await supabase.from("property_staff").insert(add.map((email) => ({ property_id: id, email })));
  if (remove.length) await supabase.from("property_staff").delete().eq("property_id", id).in("email", remove);
  await audit(me.userId, "property.staff", "property", id, { add, remove });
  refresh(await codeOf(id));
  return { ok: true, message: "Staff saved" };
}

export async function activateProperty(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const supabase = await createClient();
  const { data: status } = await supabase.rpc("property_setup_status", { pid: id });
  const blockers = activationBlockers(status as SetupStatus);
  if (blockers.length) return { error: `Not ready yet: ${blockers.join(", ")}` };
  const { error } = await supabase.from("properties").update({ status: "ACTIVE" }).eq("id", id);
  if (error) return { error: "Couldn't open the property. Try again." };
  await audit(me.userId, "property.activate", "property", id);
  const code = await codeOf(id);
  refresh(code);
  redirect(`/p/${code}`);
}

/** One-button version for the setup header. */
export async function openProperty(fd: FormData) {
  await activateProperty({}, fd);
}

export async function setPropertyStatus(fd: FormData) {
  const me = await manager();
  const id = uuid.parse(fd.get("property_id"));
  const status = z.enum(["DRAFT", "ARCHIVED"]).parse(fd.get("status"));
  const supabase = await createClient();
  await supabase.from("properties").update({ status }).eq("id", id);
  await audit(me.userId, `property.${status.toLowerCase()}`, "property", id);
  refresh(await codeOf(id));
}
