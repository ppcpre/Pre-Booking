import { BOOKING_STATUS, PERIOD_STATUS, type BookingStatus, type PeriodStatus } from "@/lib/booking-rules";

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  const s = BOOKING_STATUS[status];
  return <span className={`st ${s.tone}`}>{s.label}</span>;
}

export function PeriodStatusPill({ status, daysLate }: { status: PeriodStatus; daysLate?: number }) {
  const s = PERIOD_STATUS[status];
  return <span className={`st ${s.tone}`}>{status === "OVERDUE" && daysLate ? `${daysLate} day${daysLate > 1 ? "s" : ""} overdue` : s.label}</span>;
}

export function ModeTag({ mode }: { mode: "DAILY" | "YEARLY" | null }) {
  if (!mode) return null;
  return <span className={`tag ${mode === "YEARLY" ? "y" : ""}`}>{mode === "YEARLY" ? "Yearly" : "Daily"}</span>;
}
