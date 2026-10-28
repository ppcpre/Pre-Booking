import { redirect } from "next/navigation";
import { requireMember } from "@/lib/session";
import { getProperty, getUnits } from "@/lib/properties";
import { isISODate, todayISO } from "@/lib/dates";
import { NewBooking } from "./new-booking";

export const metadata = { title: "New booking" };

export default async function NewBookingPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const member = await requireMember();
  const p = await getProperty(code);
  if (member.role === "ACCOUNTANT" || p.status !== "ACTIVE") redirect(`/p/${p.code}`);
  const units = await getUnits(p.id);
  const today = todayISO();
  const prefUnit = units.find((u) => u.id === sp.unit);
  const start = isISODate(sp.start) ? sp.start : today;
  const modes = new Set(units.flatMap((u) => u.allowed_modes));
  return (
    <NewBooking
      property={{ id: p.id, code: p.code, name: p.name, checkIn: p.check_in_time.slice(0, 5) }}
      today={today}
      initial={{
        mode: prefUnit && !prefUnit.allowed_modes.includes("DAILY") ? "YEARLY" : "DAILY",
        start,
        unitId: prefUnit?.id ?? null,
      }}
      modes={{ daily: modes.has("DAILY"), yearly: modes.has("YEARLY") }}
    />
  );
}
