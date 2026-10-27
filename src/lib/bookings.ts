import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, PeriodStatus, PolicyRule } from "@/lib/booking-rules";
import type { RentalMode } from "@/lib/types";

export type Guest = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  nationality: string | null;
  is_company: boolean;
  company_name: string | null;
  tax_id: string | null;
  branch: string | null;
  billing_address: string | null;
};

export type BookingRow = {
  id: string;
  code: string;
  property_id: string;
  unit_id: string;
  kind: "RESERVATION" | "BLOCK";
  mode: RentalMode | null;
  status: BookingStatus;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  total_amount: number;
  paid_amount: number;
  credit_balance: number;
  hold_expires_at: string | null;
  source: string;
  note: string | null;
  block_reason: string | null;
  created_at: string;
  guest: { id: string; full_name: string; phone: string | null } | null;
  unit: { code: string } | null;
};

const ROW = "id, code, property_id, unit_id, kind, mode, status, check_in, check_out, adults, children, total_amount, paid_amount, credit_balance, hold_expires_at, source, note, block_reason, created_at, guest:guests(id, full_name, phone), unit:units(code)";

export type PeriodRow = {
  id: string;
  booking_id: string;
  booking_code: string;
  property_id: string;
  seq: number;
  kind: "STAY" | "MOVE_IN" | "RENT" | "ADJUSTMENT";
  label: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: PeriodStatus;
  paid_at: string | null;
  days_late: number;
  note: string | null;
  mode: RentalMode | null;
  unit_id: string;
};

export type Payment = {
  id: string;
  amount: number;
  wht_amount: number;
  wht_cert_no: string | null;
  paid_at: string;
  method: string;
  reference: string | null;
  note: string | null;
  recorded_at: string;
  voided_at: string | null;
  void_reason: string | null;
  booking_id: string;
};

export type BookingDetail = BookingRow & {
  guest: Guest | null;
  unit: { code: string; floor: string | null; room_type: { name: string; max_occupancy: number } | null } | null;
  price_snapshot: Record<string, unknown> | null;
  policy_snapshot: { name: string; rules: PolicyRule[] } | null;
  cancel_reason: string | null;
  actual_check_in: string | null;
  actual_check_out: string | null;
  periods: (PeriodRow & { lines: { description: string; amount: number; charge_type: string }[] })[];
  payments: Payment[];
  refunds: { id: string; amount: number; refunded_at: string; method: string; reason: string }[];
  history: { id: number; from_status: BookingStatus | null; to_status: BookingStatus; reason: string | null; changed_at: string }[];
  lease: { start_date: string; end_date: string; rent_amount: number; deposit_amount: number; deposit_months: number; advance_months: number; notice_days: number } | null;
};

export const getBooking = cache(async (code: string): Promise<BookingDetail> => {
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("*, guest:guests(*), unit:units(code, floor, room_type:room_types(name, max_occupancy))")
    .eq("code", code)
    .maybeSingle();
  if (!b) notFound();
  const [periods, lines, payments, refunds, history, lease] = await Promise.all([
    supabase.from("charge_periods_v").select("*").eq("booking_id", b.id).order("seq"),
    supabase.from("charge_lines").select("period_id, description, amount, charge_type, period:charge_periods!inner(booking_id)").eq("period.booking_id", b.id),
    supabase.from("payments").select("*").eq("booking_id", b.id).order("paid_at", { ascending: false }).order("recorded_at", { ascending: false }),
    supabase.from("refunds").select("id, amount, refunded_at, method, reason").eq("booking_id", b.id),
    supabase.from("booking_status_history").select("id, from_status, to_status, reason, changed_at").eq("booking_id", b.id).order("changed_at"),
    supabase.from("leases").select("*").eq("booking_id", b.id).maybeSingle(),
  ]);
  const byPeriod = new Map<string, { description: string; amount: number; charge_type: string }[]>();
  for (const l of lines.data ?? []) {
    byPeriod.set(l.period_id, [...(byPeriod.get(l.period_id) ?? []), { description: l.description, amount: l.amount, charge_type: l.charge_type }]);
  }
  return {
    ...(b as unknown as BookingDetail),
    periods: ((periods.data ?? []) as PeriodRow[]).map((p) => ({ ...p, lines: byPeriod.get(p.id) ?? [] })),
    payments: (payments.data ?? []) as Payment[],
    refunds: refunds.data ?? [],
    history: (history.data ?? []) as BookingDetail["history"],
    lease: lease.data ?? null,
  };
});

export type BookingTab = "upcoming" | "reserved" | "inhouse" | "past" | "cancelled";

export async function listBookings(propertyId: string, tab: BookingTab, q: string, today: string): Promise<BookingRow[]> {
  const supabase = await createClient();
  let query = supabase.from("bookings").select(ROW).eq("property_id", propertyId).eq("kind", "RESERVATION").limit(200);
  switch (tab) {
    case "upcoming":
      query = query.in("status", ["HOLD", "CONFIRMED"]).gte("check_in", today).order("check_in");
      break;
    case "reserved":
      query = query.eq("status", "HOLD").order("hold_expires_at");
      break;
    case "inhouse":
      query = query.eq("status", "CHECKED_IN").order("check_out");
      break;
    case "past":
      query = query.in("status", ["CHECKED_OUT", "NO_SHOW"]).order("check_out", { ascending: false });
      break;
    case "cancelled":
      query = query.in("status", ["CANCELLED", "EXPIRED"]).order("created_at", { ascending: false });
      break;
  }
  const { data } = await query;
  let rows = (data ?? []) as unknown as BookingRow[];
  const needle = q.trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) =>
      [r.code, r.guest?.full_name, r.guest?.phone, r.unit?.code].some((v) => v?.toLowerCase().includes(needle)),
    );
  }
  return rows;
}

/** Stays and blocks overlapping [from, to) for the calendar. */
export async function calendarBookings(propertyId: string, from: string, to: string): Promise<BookingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(ROW)
    .eq("property_id", propertyId)
    .in("status", ["HOLD", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"])
    .lt("check_in", to)
    .gt("check_out", from);
  return (data ?? []) as unknown as BookingRow[];
}

/** Everything the "Today" view of one or more properties needs. */
export async function todayView(propertyIds: string[], today: string) {
  const supabase = await createClient();
  if (propertyIds.length === 0) {
    return { arrivals: [], departures: [], inHouse: 0, reserved: [], due: [] as (PeriodRow & { guest_name?: string; unit_code?: string })[] };
  }
  const [arrivals, departures, inHouse, reserved, due] = await Promise.all([
    supabase.from("bookings").select(ROW).in("property_id", propertyIds).eq("kind", "RESERVATION").eq("check_in", today).in("status", ["HOLD", "CONFIRMED", "CHECKED_IN"]).order("check_in"),
    supabase.from("bookings").select(ROW).in("property_id", propertyIds).eq("kind", "RESERVATION").eq("check_out", today).in("status", ["CHECKED_IN", "CHECKED_OUT"]),
    supabase.from("bookings").select("id", { count: "exact", head: true }).in("property_id", propertyIds).eq("kind", "RESERVATION").eq("status", "CHECKED_IN"),
    supabase.from("bookings").select(ROW).in("property_id", propertyIds).eq("status", "HOLD").order("hold_expires_at").limit(50),
    supabase.from("charge_periods_v").select("*").in("property_id", propertyIds).in("status", ["DUE", "PARTIAL", "OVERDUE"]).in("booking_status", ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]).order("due_date").limit(100),
  ]);
  return {
    arrivals: (arrivals.data ?? []) as unknown as BookingRow[],
    departures: (departures.data ?? []) as unknown as BookingRow[],
    inHouse: inHouse.count ?? 0,
    reserved: (reserved.data ?? []) as unknown as BookingRow[],
    due: (due.data ?? []) as PeriodRow[],
  };
}

/** Guest name and unit code for a set of bookings (used next to period rows). */
export async function bookingLabels(bookingIds: string[]) {
  if (bookingIds.length === 0) return new Map<string, { guest: string; unit: string; code: string }>();
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select("id, code, guest:guests(full_name), unit:units(code)").in("id", bookingIds);
  return new Map(
    (data ?? []).map((b) => {
      const row = b as unknown as { id: string; code: string; guest: { full_name: string } | null; unit: { code: string } | null };
      return [row.id, { guest: row.guest?.full_name ?? "", unit: row.unit?.code ?? "", code: row.code }];
    }),
  );
}

export async function recentPayments(propertyId: string, limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*, booking:bookings!inner(code, property_id, guest:guests(full_name), unit:units(code))")
    .eq("booking.property_id", propertyId)
    .order("recorded_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as (Payment & { booking: { code: string; guest: { full_name: string } | null; unit: { code: string } | null } })[];
}
