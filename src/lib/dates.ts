/** Dates of stay are plain "YYYY-MM-DD" strings in Bangkok time. Math is done in UTC to avoid DST/offset surprises. */
const DAY = 86_400_000;

export function todayISO(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUTC(iso) + n * DAY).toISOString().slice(0, 10);
}

export function addYears(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // 29 Feb + 1 year → 28 Feb (same as Postgres).
  const target = new Date(Date.UTC(y! + n, m! - 1, 1));
  const last = new Date(Date.UTC(y! + n, m!, 0)).getUTCDate();
  target.setUTCDate(Math.min(d!, last));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

export function isISODate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUTC(v));
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }));
  return fmtCache.get(key)!;
}

export function fmtDate(iso: string, withYear = true): string {
  return fmt(withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).format(toUTC(iso));
}

export function fmtWeekday(iso: string): string {
  return fmt({ weekday: "short" }).format(toUTC(iso));
}

export function fmtRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDate(start, !sameYear)} – ${fmtDate(end)}`;
}

export function isWeekend(iso: string): boolean {
  const d = new Date(toUTC(iso)).getUTCDay();
  return d === 5 || d === 6; // Fri and Sat nights
}

/** Postgres daterange text "[2030-01-04,2030-01-07)" → start/end (end exclusive). */
export function parseStay(range: string): { start: string; end: string } {
  const m = range.match(/^[[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[)\]]$/);
  if (!m) throw new Error(`Unexpected date range: ${range}`);
  const start = range.startsWith("(") ? addDays(m[1]!, 1) : m[1]!;
  const end = range.endsWith("]") ? addDays(m[2]!, 1) : m[2]!;
  return { start, end };
}

export function fmtDateTime(ts: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(ts));
}
