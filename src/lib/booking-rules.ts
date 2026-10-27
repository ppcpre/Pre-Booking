export type BookingStatus = "HOLD" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW" | "EXPIRED";
export type PeriodStatus = "UPCOMING" | "DUE" | "PARTIAL" | "OVERDUE" | "PAID" | "WAIVED" | "CANCELLED";
export type Tone = "ok" | "warn" | "bad" | "idle" | "info";

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  HOLD: { label: "Reserved", tone: "warn" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  CHECKED_IN: { label: "In house", tone: "ok" },
  CHECKED_OUT: { label: "Checked out", tone: "idle" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
  NO_SHOW: { label: "No-show", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "idle" },
};

export const PERIOD_STATUS: Record<PeriodStatus, { label: string; tone: Tone }> = {
  UPCOMING: { label: "Upcoming", tone: "idle" },
  DUE: { label: "Due", tone: "info" },
  PARTIAL: { label: "Part paid", tone: "warn" },
  OVERDUE: { label: "Overdue", tone: "bad" },
  PAID: { label: "Paid", tone: "ok" },
  WAIVED: { label: "Waived", tone: "idle" },
  CANCELLED: { label: "Cancelled", tone: "idle" },
};

export const PAYMENT_METHODS = [
  ["TRANSFER", "Transfer"],
  ["CASH", "Cash"],
  ["CARD", "Card"],
  ["CHEQUE", "Cheque"],
  ["OTHER", "Other"],
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number][0];

export const BOOKING_SOURCES = [
  ["WALK_IN", "Walk-in"],
  ["PHONE", "Phone"],
  ["LINE", "LINE"],
  ["DIRECT", "Email / other"],
  ["AIRBNB", "Airbnb"],
  ["BOOKING_COM", "Booking.com"],
  ["AGODA", "Agoda"],
] as const;

export type PolicyRule = { days_before: number; refund_percent: number };

/**
 * Refund the cancellation policy allows: the first rule (largest days_before first)
 * whose threshold the cancellation meets. No policy → no automatic refund.
 */
export function refundSuggestion(rules: PolicyRule[] | null | undefined, daysBeforeArrival: number, paid: number) {
  const sorted = [...(rules ?? [])].sort((a, b) => b.days_before - a.days_before);
  const rule = sorted.find((r) => daysBeforeArrival >= r.days_before);
  const percent = rule?.refund_percent ?? 0;
  return { percent, amount: Math.floor((paid * percent) / 100), rule: rule ?? null };
}

/** Friendly message from a Supabase RPC error: our functions raise readable P0001 messages. */
export function rpcMessage(error: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Try again."): string {
  if (!error) return fallback;
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "23P01") return "Those dates were just booked. Choose another unit or dates.";
  return fallback;
}
