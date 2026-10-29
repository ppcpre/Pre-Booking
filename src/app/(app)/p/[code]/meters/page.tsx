import Link from "next/link";
import { requireMember } from "@/lib/session";
import { getProperty } from "@/lib/properties";
import { meterSheet, type Utility } from "@/lib/meters";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, isISODate, todayISO } from "@/lib/dates";
import { formatTHB } from "@/lib/money";
import { MeterSheet } from "./meter-sheet";

export const metadata = { title: "Meters" };

export default async function MetersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const member = await requireMember();
  const p = await getProperty(code);
  const today = todayISO();
  const date = isISODate(sp.date) && sp.date <= today ? sp.date : today;
  const utility: Utility = sp.utility === "WATER" ? "WATER" : "ELECTRIC";
  const supabase = await createClient();
  const [rows, { data: rate }] = await Promise.all([
    meterSheet(p.id, date, utility),
    supabase.from("utility_rates").select("price_per_unit, minimum_charge").eq("property_id", p.id).eq("utility", utility).lte("effective_from", date).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const base = `/p/${p.code}/meters`;
  const q = (d: string, u: Utility) => `${base}?date=${d}&utility=${u}`;
  const readingDay = `${today.slice(0, 8)}${String(p.meter_reading_day).padStart(2, "0")}`;

  return (
    <>
      <div className="filters" style={{ justifyContent: "space-between" }}>
        <div className="filters">
          <div className="seg">
            <Link href={q(date, "ELECTRIC")} aria-current={utility === "ELECTRIC" ? "page" : undefined}>Electricity</Link>
            <Link href={q(date, "WATER")} aria-current={utility === "WATER" ? "page" : undefined}>Water</Link>
          </div>
          <form className="filters" action={base}>
            <input type="hidden" name="utility" value={utility} />
            <input className="field" type="date" name="date" max={today} defaultValue={date} aria-label="Reading date" style={{ width: 170 }} />
            <button className="btn" type="submit">Go</button>
          </form>
          {readingDay <= today && date !== readingDay && <Link className="btn quiet" href={q(readingDay, utility)}>Reading day ({fmtDate(readingDay, false)})</Link>}
        </div>
        {rate ? (
          <span className="hint">{formatTHB(rate.price_per_unit)} per unit{rate.minimum_charge ? ` · minimum ${formatTHB(rate.minimum_charge)}` : ""}</span>
        ) : (
          <span className="hint">
            No {utility === "WATER" ? "water" : "electricity"} price yet. Readings can be saved now and billed later.{" "}
            {(member.role === "ADMIN" || member.role === "MANAGER") && <Link href={`/settings/properties/${p.code}/meters`}>Set price</Link>}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="empty"><b>No meters to read</b><span>Units rented yearly appear here. Daily stays include utilities.</span></div>
      ) : (
        <MeterSheet
          key={`${date}-${utility}`}
          propertyId={p.id}
          propertyCode={p.code}
          date={date}
          utility={utility}
          rows={rows}
          canEdit={member.role !== "ACCOUNTANT"}
          canCorrect={member.role === "ADMIN" || member.role === "MANAGER"}
          hasPrice={!!rate}
        />
      )}
    </>
  );
}
