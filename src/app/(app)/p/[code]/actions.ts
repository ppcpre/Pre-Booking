"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/session";
import { bahtToSatang } from "@/lib/money";
import { isISODate, todayISO } from "@/lib/dates";
import { rpcMessage } from "@/lib/booking-rules";
import type { ActionResult } from "@/lib/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = z.string().uuid();
const isoDate = z.string().refine(isISODate, "Pick a date");
const mode = z.enum(["DAILY", "YEARLY"]);

function refresh(propertyCode: string, bookingCode?: string) {
  revalidatePath(`/p/${propertyCode}`, "layout");
  revalidatePath("/");
  if (bookingCode) revalidatePath(`/p/${propertyCode}/bookings/${bookingCode}`);
}

// ------------------------------------------------------------------ search & quote
const searchSchema = z.object({
  propertyId: uuid,
  mode,
  start: isoDate,
  end: isoDate.optional(),
  years: z.coerce.number().int().min(1).max(10).default(1),
  guests: z.coerce.number().int().min(1).max(50).default(1),
});

export type AvailableUnit = {
  unit_id: string;
  code: string;
  floor: string | null;
  room_type: string;
  available: boolean;
  reason: string | null;
  total: number | null;
  due_now: number | null;
  rent: number | null;
};

export async function findUnits(input: z.input<typeof searchSchema>): Promise<Result<AvailableUnit[]>> {
  await requireMember();
  const p = searchSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the dates" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("available_units", {
    p_property: p.data.propertyId,
    p_mode: p.data.mode,
    p_start: p.data.start,
    p_end: p.data.mode === "DAILY" ? p.data.end : null,
    p_years: p.data.years,
    p_guests: p.data.guests,
  });
  if (error) return { ok: false, error: rpcMessage(error) };
  return { ok: true, data: data as AvailableUnit[] };
}

const quoteSchema = z.object({
  unitId: uuid,
  mode,
  start: isoDate,
  end: isoDate.optional(),
  years: z.coerce.number().int().min(1).max(10).default(1),
  adults: z.coerce.number().int().min(0).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  extras: z.array(z.object({ description: z.string().trim().min(1).max(80), amount: z.number().int().positive() })).default([]),
  discount: z.number().int().min(0).default(0),
});

export type QuotePeriod = { seq: number; kind: string; label: string; due_date: string; total: number; lines: { description: string; amount: number; charge_type: string }[] };
export type Quote = {
  unit_code: string;
  room_type: string;
  mode: "DAILY" | "YEARLY";
  start: string;
  end: string;
  nights: number | null;
  years: number | null;
  rent: number | null;
  gross: number;
  discount: number;
  total: number;
  due_now: number;
  deposit_months: number | null;
  advance_months: number | null;
  periods: QuotePeriod[];
};

export async function quoteBooking(input: z.input<typeof quoteSchema>): Promise<Result<Quote>> {
  await requireMember();
  const p = quoteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the details" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_booking", {
    p_unit: p.data.unitId,
    p_mode: p.data.mode,
    p_start: p.data.start,
    p_end: p.data.mode === "DAILY" ? p.data.end : null,
    p_years: p.data.years,
    p_adults: p.data.adults,
    p_children: p.data.children,
    p_extras: p.data.extras,
    p_discount: p.data.discount,
  });
  if (error) return { ok: false, error: rpcMessage(error) };
  return { ok: true, data: data as Quote };
}

export type GuestHit = { id: string; full_name: string; phone: string | null; email: string | null; is_company: boolean; company_name: string | null };

export async function searchGuests(q: string): Promise<GuestHit[]> {
  await requireMember();
  const term = q.trim().replace(/[%_,()]/g, " ").trim();
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("guests")
    .select("id, full_name, phone, email, is_company, company_name")
    .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as GuestHit[];
}

// ------------------------------------------------------------------ create
const guestSchema = z.object({
  full_name: z.string().trim().min(1, "Enter the guest's name").max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).optional(),
  line_id: z.string().trim().max(60).optional(),
  nationality: z.string().trim().max(60).optional(),
  is_company: z.boolean().default(false),
  company_name: z.string().trim().max(160).optional(),
  tax_id: z.string().trim().max(30).optional(),
  branch: z.string().trim().max(60).optional(),
  billing_address: z.string().trim().max(500).optional(),
});

const createSchema = quoteSchema.extend({
  propertyCode: z.string(),
  guestId: uuid.optional(),
  guest: guestSchema.optional(),
  discountReason: z.string().trim().max(200).optional(),
  payBy: z.string().datetime({ offset: true }).optional(),
  source: z.string().max(30).default("DIRECT"),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(80),
});

export async function createBooking(input: z.input<typeof createSchema>): Promise<Result<{ code: string }>> {
  await requireMember();
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the details" };
  if (!p.data.guestId && !p.data.guest) return { ok: false, error: "Choose or add a guest" };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    p: {
      unit_id: d.unitId,
      mode: d.mode,
      start: d.start,
      end: d.mode === "DAILY" ? d.end : null,
      years: d.years,
      adults: d.adults,
      children: d.children,
      extras: d.extras,
      discount: d.discount,
      discount_reason: d.discountReason ?? null,
      guest_id: d.guestId ?? null,
      guest: d.guestId ? null : d.guest,
      pay_by: d.payBy ?? null, // already an ISO timestamp from the browser
      source: d.source,
      note: d.note ?? null,
      idempotency_key: d.idempotencyKey,
    },
  });
  if (error) return { ok: false, error: rpcMessage(error) };
  const code = (data as { code: string }).code;
  refresh(d.propertyCode, code);
  return { ok: true, data: { code } };
}

// ------------------------------------------------------------------ payments
const paymentSchema = z.object({
  booking_id: uuid,
  property_code: z.string(),
  booking_code: z.string(),
  amount: z.string(),
  wht_amount: z.string().optional(),
  wht_cert_no: z.string().max(60).optional(),
  paid_at: isoDate,
  method: z.enum(["CASH", "TRANSFER", "CHEQUE", "CARD", "OTHER"]),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  idempotency_key: z.string().min(8).max(80),
});

export async function recordPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const raw = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "period_ids").map(([k, v]) => [k, String(v)]));
  const p = paymentSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the payment details" };
  let amount: number;
  let wht = 0;
  try {
    amount = bahtToSatang(p.data.amount);
    if (p.data.wht_amount?.trim()) wht = bahtToSatang(p.data.wht_amount);
  } catch {
    return { error: "Enter amounts like 1500 or 1500.50" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_payment", {
    p: {
      booking_id: p.data.booking_id,
      amount,
      wht_amount: wht,
      wht_cert_no: p.data.wht_cert_no ?? null,
      paid_at: p.data.paid_at,
      method: p.data.method,
      reference: p.data.reference ?? null,
      note: p.data.note ?? null,
      period_ids: fd.getAll("period_ids").map(String),
      idempotency_key: p.data.idempotency_key,
    },
  });
  if (error) return { error: rpcMessage(error) };
  const r = data as { payment_id: string; confirmed?: boolean; credit?: number; duplicate?: boolean };
  if (r.duplicate) return { ok: true, message: "This payment was already saved." };
  const parts = ["Payment saved."];
  if (fd.get("issue_receipt") === "1") {
    const rc = await supabase.rpc("issue_receipt", { p_payment: r.payment_id });
    if (rc.error) parts.push(`Receipt not issued: ${rpcMessage(rc.error)}`);
    else parts.push(`Receipt ${(rc.data as { number: string }).number} issued.`);
  }
  refresh(p.data.property_code, p.data.booking_code);
  if (r.confirmed) parts.push("The booking is now confirmed.");
  if (r.credit && r.credit > 0) parts.push(`฿${(r.credit / 100).toLocaleString("en-US")} kept as credit.`);
  return { ok: true, message: parts.join(" ") };
}

export async function voidPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const id = uuid.safeParse(fd.get("payment_id"));
  if (!id.success) return { error: "Payment not found" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_payment", { p_payment: id.data, p_reason: String(fd.get("reason") ?? "") });
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
  return { ok: true, message: "Payment voided" };
}

// ------------------------------------------------------------------ stay lifecycle
async function lifecycle(fn: string, args: Record<string, unknown>, fd: FormData, okMessage: string): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
  return { ok: true, message: okMessage };
}

export async function checkIn(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const reason = String(fd.get("override_reason") ?? "").trim();
  if (fd.get("mode") === "YEARLY") {
    const num = (k: string) => {
      const v = String(fd.get(k) ?? "").replace(/,/g, "").trim();
      return v === "" ? null : Number(v);
    };
    const water = num("water");
    const electric = num("electric");
    if ([water, electric].some((v) => v !== null && (!Number.isFinite(v) || v < 0))) return { error: "Meter readings must be numbers of 0 or more" };
    return lifecycle("check_in_yearly", { p_booking: String(fd.get("booking_id")), p_water: water, p_electric: electric, p_override_reason: reason || null }, fd, "Checked in");
  }
  return lifecycle("check_in", { p_booking: String(fd.get("booking_id")), p_override_reason: reason || null }, fd, "Checked in");
}

export async function checkOut(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return lifecycle("check_out", { p_booking: String(fd.get("booking_id")) }, fd, "Checked out");
}

export async function markNoShow(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return lifecycle("mark_no_show", { p_booking: String(fd.get("booking_id")) }, fd, "Marked as no-show");
}

export async function cancelBooking(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let refund = 0;
  const raw = String(fd.get("refund") ?? "").trim();
  if (raw) {
    try {
      refund = bahtToSatang(raw);
    } catch {
      return { error: "Enter the refund like 1500 or 0" };
    }
  }
  return lifecycle(
    "cancel_booking",
    { p_booking: String(fd.get("booking_id")), p_reason: String(fd.get("reason") ?? ""), p_refund: refund, p_refund_method: String(fd.get("refund_method") ?? "TRANSFER") },
    fd,
    "Booking cancelled",
  );
}

// ------------------------------------------------------------------ blocks
export async function createBlock(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const p = z.object({ unit_id: uuid, start: isoDate, end: isoDate, reason: z.string().trim().min(1, "Give a reason, e.g. Maintenance").max(200) }).safeParse({
    unit_id: fd.get("unit_id"),
    start: fd.get("start"),
    end: fd.get("end"),
    reason: fd.get("reason"),
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the dates" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_block", { p_unit: p.data.unit_id, p_start: p.data.start, p_end: p.data.end, p_reason: p.data.reason });
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")));
  return { ok: true, message: "Dates blocked" };
}

export async function removeBlock(fd: FormData) {
  await requireMember();
  const supabase = await createClient();
  await supabase.rpc("remove_block", { p_booking: String(fd.get("booking_id")) });
  refresh(String(fd.get("property_code")));
}

// ------------------------------------------------------------------ extend & move-out
export async function extendStay(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const d = isoDate.safeParse(fd.get("check_out"));
  if (!d.success) return { error: "Pick the new check-out date" };
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("extend_stay", { p_booking: String(fd.get("booking_id")), p_new_check_out: d.data });
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
  const r = data as { nights: number; total: number };
  return { ok: true, message: `Added ${r.nights} night${r.nights > 1 ? "s" : ""} · ฿${(r.total / 100).toLocaleString("en-US")} to pay` };
}

export async function settleLease(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const readings: Record<string, number> = {};
  for (const k of ["WATER", "ELECTRIC"]) {
    const v = String(fd.get(k) ?? "").replace(/,/g, "").trim();
    if (v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: "Meter readings must be numbers of 0 or more" };
    readings[k] = n;
  }
  const deductions: { description: string; amount: number }[] = [];
  const descs = fd.getAll("deduction_description").map(String);
  const amts = fd.getAll("deduction_amount").map(String);
  for (let i = 0; i < descs.length; i++) {
    if (!descs[i]!.trim() && !amts[i]!.trim()) continue;
    if (!descs[i]!.trim()) return { error: "Each deduction needs a description" };
    try {
      deductions.push({ description: descs[i]!.trim(), amount: bahtToSatang(amts[i]!) });
    } catch {
      return { error: `Deduction "${descs[i]}": enter an amount like 1500` };
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_lease", {
    p: { booking_id: String(fd.get("booking_id")), readings, deductions, refund_method: String(fd.get("refund_method") ?? "TRANSFER") },
  });
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
  const r = data as { used: number; refund: number; still_owed: number };
  const baht = (n: number) => `฿${(n / 100).toLocaleString("en-US")}`;
  return { ok: true, message: `Deposit settled: ${baht(r.used)} used, ${baht(r.refund)} to return${r.still_owed ? `, ${baht(r.still_owed)} still owed` : ""}.` };
}

// ------------------------------------------------------------------ documents
export async function issueInvoice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const ids = fd.getAll("period_ids").map(String);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_invoice", { p_booking: String(fd.get("booking_id")), p_period_ids: ids.length ? ids : null, p_until: null });
  if (error) return { error: rpcMessage(error) };
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
  return { ok: true, message: `Invoice ${(data as { number: string }).number} issued` };
}

export async function issueReceipt(fd: FormData) {
  await requireMember();
  const supabase = await createClient();
  await supabase.rpc("issue_receipt", { p_payment: String(fd.get("payment_id")) });
  refresh(String(fd.get("property_code")), String(fd.get("booking_code")));
}

export async function voidDocument(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_document", { p_document: String(fd.get("document_id")), p_reason: String(fd.get("reason") ?? "") });
  if (error) return { error: rpcMessage(error) };
  revalidatePath(`/p/${String(fd.get("property_code"))}`, "layout");
  return { ok: true, message: "Document voided" };
}

// ------------------------------------------------------------------ meters
const readingRow = z.object({ unit_id: uuid, value: z.string(), photo_path: z.string().optional(), allow_lower: z.boolean().default(false) });

export async function saveReadings(input: { propertyCode: string; date: string; utility: "WATER" | "ELECTRIC"; rows: z.input<typeof readingRow>[] }): Promise<Result<{ saved: number; errors: { unit_id: string; error: string }[] }>> {
  await requireMember();
  const date = isoDate.safeParse(input.date);
  if (!date.success) return { ok: false, error: "Pick the reading date" };
  if (date.data > todayISO()) return { ok: false, error: "Readings can't be in the future" };
  const supabase = await createClient();
  let saved = 0;
  const errors: { unit_id: string; error: string }[] = [];
  for (const raw of input.rows) {
    const row = readingRow.safeParse(raw);
    if (!row.success) continue;
    const v = row.data.value.replace(/,/g, "").trim();
    if (v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ unit_id: row.data.unit_id, error: "Enter a number of 0 or more" });
      continue;
    }
    const { error } = await supabase.rpc("save_meter_reading", {
      p_unit: row.data.unit_id,
      p_utility: input.utility,
      p_date: date.data,
      p_value: n,
      p_type: "MONTHLY",
      p_booking: null,
      p_photo: row.data.photo_path || null,
      p_allow_lower: row.data.allow_lower,
    });
    if (error) errors.push({ unit_id: row.data.unit_id, error: rpcMessage(error) });
    else saved++;
  }
  revalidatePath(`/p/${input.propertyCode}/meters`);
  return { ok: true, data: { saved, errors } };
}

export async function billUtilities(input: { propertyId: string; propertyCode: string; date: string }): Promise<Result<{ billed: number; skipped: number; total: number }>> {
  await requireMember();
  const date = isoDate.safeParse(input.date);
  if (!date.success) return { ok: false, error: "Pick the reading date" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bill_utilities", { p_property: input.propertyId, p_date: date.data });
  if (error) return { ok: false, error: rpcMessage(error) };
  refresh(input.propertyCode);
  return { ok: true, data: data as { billed: number; skipped: number; total: number } };
}

// ------------------------------------------------------------------ corrections (edit past data)
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (fd: FormData, message: string): ActionResult => {
  refresh(s(fd, "property_code"), s(fd, "booking_code"));
  return { ok: true, message };
};
const baht = (n: number) => `฿${(Math.abs(n) / 100).toLocaleString("en-US")}`;

/** Booking details and the guest's contact details. */
export async function updateBookingInfo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const p = z
    .object({
      adults: z.coerce.number().int().min(1, "At least 1 adult").max(50),
      children: z.coerce.number().int().min(0).max(50),
      full_name: z.string().trim().min(1, "Enter the guest's name").max(120),
      phone: z.string().trim().max(40),
      email: z.union([z.literal(""), z.string().trim().email("Check the email")]),
      line_id: z.string().trim().max(60),
      company_name: z.string().trim().max(160),
      tax_id: z.string().trim().max(20),
      branch: z.string().trim().max(60),
      billing_address: z.string().trim().max(400),
      note: z.string().trim().max(500),
      source: z.string().trim().max(20),
    })
    .safeParse(Object.fromEntries(["adults", "children", "full_name", "phone", "email", "line_id", "company_name", "tax_id", "branch", "billing_address", "note", "source"].map((k) => [k, s(fd, k)])));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const supabase = await createClient();
  const guestId = s(fd, "guest_id");
  if (guestId) {
    const company = fd.get("is_company") === "1";
    const { data, error } = await supabase
      .from("guests")
      .update({
        full_name: p.data.full_name,
        phone: p.data.phone || null,
        email: p.data.email || null,
        line_id: p.data.line_id || null,
        is_company: company,
        company_name: company ? p.data.company_name || null : null,
        tax_id: company ? p.data.tax_id || null : null,
        branch: company ? p.data.branch || null : null,
        billing_address: company ? p.data.billing_address || null : null,
      })
      .eq("id", guestId)
      .select("id");
    if (error || !data?.length) return { error: "Couldn't save the guest's details. Only front desk, managers and admins can edit guests." };
  }
  const { error } = await supabase.rpc("update_booking_info", {
    p_booking: s(fd, "booking_id"),
    p: { adults: p.data.adults, children: p.data.children, note: p.data.note, source: p.data.source },
  });
  if (error) return { error: rpcMessage(error) };
  return done(fd, "Details saved");
}

export async function changeDailyStay(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const p = z.object({ unit_id: uuid, start: isoDate, end: isoDate }).safeParse({ unit_id: s(fd, "unit_id"), start: s(fd, "start"), end: s(fd, "end") });
  if (!p.success) return { error: "Pick the unit and dates" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_daily_stay", {
    p_booking: s(fd, "booking_id"),
    p_unit: p.data.unit_id,
    p_start: p.data.start,
    p_end: p.data.end,
    p_reason: s(fd, "reason"),
  });
  if (error) return { error: rpcMessage(error) };
  const d = (data as { difference: number }).difference;
  return done(fd, d === 0 ? "Stay changed. The price is the same." : d > 0 ? `Stay changed. ${baht(d)} more to pay.` : `Stay changed. ${baht(d)} less; anything already paid beyond the new total is kept as credit.`);
}

export async function changeLease(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const p: Record<string, unknown> = { reason: s(fd, "reason") };
  if (s(fd, "unit_id") && s(fd, "unit_id") !== s(fd, "current_unit_id")) p.unit_id = s(fd, "unit_id");
  if (s(fd, "start") && s(fd, "start") !== s(fd, "current_start")) {
    if (!isISODate(s(fd, "start"))) return { error: "Pick the move-in date" };
    p.start = s(fd, "start");
  }
  if (s(fd, "months") && s(fd, "months") !== s(fd, "current_months")) {
    const m = Number(s(fd, "months"));
    if (!Number.isInteger(m) || m < 1 || m > 120) return { error: "Lease length must be 1 to 120 months" };
    p.months = m;
  }
  if (s(fd, "rent") && s(fd, "rent") !== s(fd, "current_rent")) {
    try {
      p.rent = bahtToSatang(s(fd, "rent"));
    } catch {
      return { error: "Enter the rent like 15000" };
    }
    if (s(fd, "rent_from")) p.rent_from = s(fd, "rent_from");
  }
  if (Object.keys(p).length === 1) return { error: "Nothing was changed" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_lease", { p_booking: s(fd, "booking_id"), p });
  if (error) return { error: rpcMessage(error) };
  const r = data as { skipped_paid_months: number };
  return done(fd, `Lease changed.${r.skipped_paid_months ? ` ${r.skipped_paid_months} month${r.skipped_paid_months > 1 ? "s" : ""} already paid kept the old rent.` : ""}`);
}

export async function addCharge(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  let amount: number;
  try {
    amount = bahtToSatang(s(fd, "amount"));
  } catch {
    return { error: "Enter the amount like 500" };
  }
  if (amount <= 0) return { error: "Enter an amount more than 0" };
  if (s(fd, "kind") === "DISCOUNT") amount = -amount;
  const due = s(fd, "due_date");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_charge", {
    p_booking: s(fd, "booking_id"),
    p_period: s(fd, "period_id") || null,
    p_description: s(fd, "description"),
    p_amount: amount,
    p_due: isISODate(due) ? due : null,
    p_reason: s(fd, "reason") || null,
  });
  if (error) return { error: rpcMessage(error) };
  return done(fd, amount < 0 ? `Discount of ${baht(amount)} added` : `Charge of ${baht(amount)} added`);
}

/** Due date / waive a period, and optionally remove one of its charges. */
export async function correctPeriod(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const reason = s(fd, "reason");
  if (!reason) return { error: "Give a reason for the change" };
  const supabase = await createClient();
  const p: Record<string, unknown> = { reason };
  if (s(fd, "due_date") && s(fd, "due_date") !== s(fd, "current_due")) p.due_date = s(fd, "due_date");
  const waive = s(fd, "state");
  if (waive && waive !== s(fd, "current_state")) p.waive = waive === "WAIVED";
  const line = s(fd, "remove_line");
  if (Object.keys(p).length === 1 && !line) return { error: "Nothing was changed" };
  if (Object.keys(p).length > 1) {
    const { error } = await supabase.rpc("update_period", { p_period: s(fd, "period_id"), p });
    if (error) return { error: rpcMessage(error) };
  }
  if (line) {
    const { error } = await supabase.rpc("remove_charge", { p_line: line, p_reason: reason });
    if (error) return { error: rpcMessage(error) };
  }
  return done(fd, "Saved");
}

export async function editPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const paidAt = s(fd, "paid_at");
  if (!isISODate(paidAt)) return { error: "Pick the date received" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("edit_payment", {
    p_payment: s(fd, "payment_id"),
    p: { paid_at: paidAt, method: s(fd, "method"), reference: s(fd, "reference"), note: s(fd, "note"), wht_cert_no: s(fd, "wht_cert_no"), reason: s(fd, "reason") },
  });
  if (error) return { error: rpcMessage(error) };
  const rc = (data as { receipt: string | null }).receipt;
  return done(fd, rc ? `Payment updated. The old receipt is void; new receipt ${rc}.` : "Payment updated");
}

export async function correctStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const action = s(fd, "action");
  if (!["undo_check_in", "undo_check_out", "reopen", "set_times"].includes(action)) return { error: "Choose what to correct" };
  // Times are entered in Bangkok time.
  const t = (k: string) => (s(fd, k) ? `${s(fd, k)}:00+07:00` : null);
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_status", {
    p_booking: s(fd, "booking_id"),
    p_action: action,
    p: { reason: s(fd, "reason"), check_in_at: t("check_in_at"), check_out_at: t("check_out_at") },
  });
  if (error) return { error: rpcMessage(error) };
  const label: Record<string, string> = { undo_check_in: "Check-in undone", undo_check_out: "Check-out undone", reopen: "Booking reopened", set_times: "Times corrected" };
  return done(fd, label[action]!);
}

export async function correctMeterReading(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireMember();
  const del = fd.get("delete") === "1";
  let value: number | null = null;
  if (!del) {
    value = Number(s(fd, "value").replace(/,/g, ""));
    if (!s(fd, "value") || !Number.isFinite(value) || value < 0) return { error: "Enter a reading of 0 or more" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_meter_reading", { p_reading: s(fd, "reading_id"), p_value: value, p_reason: s(fd, "reason") });
  if (error) return { error: rpcMessage(error) };
  revalidatePath(`/p/${s(fd, "property_code")}`, "layout");
  return { ok: true, message: del ? "Reading deleted and bills updated" : "Reading corrected and bills updated" };
}
