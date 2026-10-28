import Link from "next/link";
import { ActionForm, InlineAction } from "@/components/action-form";
import { requireMember } from "@/lib/session";
import { getProperty, getRoomTypes, getUnits } from "@/lib/properties";
import { calendarBookings } from "@/lib/bookings";
import { addDays, daysBetween, fmtDate, fmtRange, fmtWeekday, isISODate, isWeekend, todayISO } from "@/lib/dates";
import { createBlock, removeBlock } from "../actions";

export const metadata = { title: "Calendar" };

const VIEWS = { "7": "Week", "14": "2 weeks", "31": "Month" } as const;

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const member = await requireMember();
  const p = await getProperty(code);
  const today = todayISO();
  const days = sp.days && sp.days in VIEWS ? Number(sp.days) : 14;
  const from = isISODate(sp.from) ? sp.from : addDays(today, -1);
  const to = addDays(from, days);
  const [types, units, bookings] = await Promise.all([getRoomTypes(p.id), getUnits(p.id), calendarBookings(p.id, from, to)]);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const base = `/p/${p.code}/calendar`;
  const link = (f: string, d = days) => `${base}?from=${f}&days=${d}`;
  const canBook = member.role !== "ACCOUNTANT" && p.status === "ACTIVE";
  const blocks = bookings.filter((b) => b.kind === "BLOCK");

  return (
    <>
      <div className="filters" style={{ justifyContent: "space-between" }}>
        <div className="filters">
          <Link className="btn sm" href={link(addDays(from, -days))} aria-label="Earlier">‹</Link>
          <Link className="btn sm" href={link(addDays(today, -1))}>Today</Link>
          <Link className="btn sm" href={link(addDays(from, days))} aria-label="Later">›</Link>
          <b style={{ fontWeight: 500 }}>{fmtRange(from, addDays(to, -1))}</b>
        </div>
        <div className="seg">
          {Object.entries(VIEWS).map(([d, label]) => (
            <Link key={d} href={link(from, Number(d))} aria-current={Number(d) === days ? "page" : undefined}>{label}</Link>
          ))}
        </div>
      </div>

      {units.length === 0 ? (
        <div className="empty"><b>No units yet</b><span>Add units in the property settings to see them here.</span></div>
      ) : (
        <div className="cal-wrap">
          <div className="cal" style={{ ["--days" as string]: days }}>
            <div className="cal-row head">
              <div className="cal-unit" style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>Unit</div>
              {dates.map((d, i) => (
                <div key={d} className={`cal-day ${d === today ? "today" : ""}`} style={{ gridColumn: i + 2 }}>
                  {fmtWeekday(d)}<b>{Number(d.slice(8))}</b>
                </div>
              ))}
            </div>
            {types.map((t) => {
              const tUnits = units.filter((u) => u.room_type_id === t.id);
              if (tUnits.length === 0) return null;
              return (
                <div key={t.id} style={{ display: "contents" }}>
                  <div className="cal-row group">{t.name}</div>
                  {tUnits.map((u) => (
                    <div key={u.id} className="cal-row">
                      <div className="cal-unit">
                        {u.code}
                        {u.allowed_modes.includes("DAILY") && <span className="tag">D</span>}
                        {u.allowed_modes.includes("YEARLY") && <span className="tag y">Y</span>}
                      </div>
                      {dates.map((d, i) =>
                        canBook && u.status === "ACTIVE" ? (
                          <Link key={d} className={`cal-cell ${isWeekend(d) ? "we" : ""}`} style={{ gridColumn: i + 2 }}
                            href={`/p/${p.code}/bookings/new?unit=${u.id}&start=${d}`} aria-label={`New booking, unit ${u.code}, ${fmtDate(d)}`} />
                        ) : (
                          <span key={d} className={`cal-cell ${isWeekend(d) ? "we" : ""}`} style={{ gridColumn: i + 2 }} />
                        ),
                      )}
                      {bookings.filter((b) => b.unit_id === u.id).map((b) => {
                        const s = Math.max(daysBetween(from, b.check_in), 0);
                        const e = Math.min(daysBetween(from, b.check_out), days);
                        if (e <= s) return null;
                        const label = b.kind === "BLOCK" ? b.block_reason ?? "Blocked" : `${b.guest?.full_name ?? ""}${b.status === "HOLD" ? " · reserved" : ""}`;
                        const cls = `cal-bar ${b.kind === "BLOCK" ? "BLOCK" : b.status} ${b.mode === "YEARLY" ? "YEARLY" : ""}`;
                        const style = { gridColumn: `${s + 2} / span ${e - s}` };
                        return b.kind === "BLOCK" ? (
                          <span key={b.id} className={cls} style={style} title={`${label} · ${fmtRange(b.check_in, b.check_out)}`}>{label}</span>
                        ) : (
                          <Link key={b.id} className={cls} style={style} href={`/p/${p.code}/bookings/${b.code}`} title={`${label} · ${fmtRange(b.check_in, b.check_out)}`}>{label}</Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="legend">
        <span><i style={{ border: "1px dashed var(--amber)" }} />Reserved · not paid</span>
        <span><i style={{ background: "var(--sky-bg)" }} />Confirmed</span>
        <span><i style={{ background: "var(--mint-100)" }} />In house</span>
        <span><i style={{ background: "var(--grey-bg)" }} />Checked out</span>
        <span><i style={{ background: "var(--surface)", borderLeft: "3px solid var(--mint-300)" }} />Yearly lease</span>
        <span><i style={{ background: "repeating-linear-gradient(135deg, var(--grey-bg) 0 4px, var(--surface) 4px 8px)", border: "1px solid var(--line)" }} />Blocked</span>
        {canBook && <span>Tap an empty day to start a booking there (past days too, for stays entered later).</span>}
      </div>

      {canBook && units.length > 0 && (
        <div className="split">
          <ActionForm action={createBlock} submitLabel="Block dates" resetOnSuccess>
            <h2>Block dates <span>Maintenance or owner use. Blocked units can&apos;t be booked.</span></h2>
            <input type="hidden" name="property_code" value={p.code} />
            <div className="form">
              <label className="lb">Unit
                <select className="field" name="unit_id" required>{units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</select>
              </label>
              <label className="lb">Reason<input className="field" name="reason" required placeholder="AC repair" /></label>
              <label className="lb">From<input className="field" type="date" name="start" required defaultValue={today} /></label>
              <label className="lb">Until (free again on)<input className="field" type="date" name="end" required defaultValue={addDays(today, 1)} /></label>
            </div>
          </ActionForm>
          <div className="card">
            <h2>Blocked in this view <span>{blocks.length}</span></h2>
            {blocks.length === 0 ? <span className="hint">No blocked dates in this range.</span> : (
              <div className="list">
                {blocks.map((b) => (
                  <div key={b.id} className="it">
                    <span className="unit">{b.unit?.code}</span>
                    <span><b>{b.block_reason}</b><small>{fmtRange(b.check_in, b.check_out)}</small></span>
                    <InlineAction action={removeBlock} fields={{ booking_id: b.id, property_code: p.code }} label="Remove" className="btn sm quiet" confirmText="Remove this block?" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
