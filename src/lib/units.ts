export const MAX_UNITS_PER_BATCH = 300;

/**
 * Expands a unit range like 101–120 into codes. Keeps leading zeros ("001"–"012")
 * and adds an optional prefix ("A" + 1–3 → A1, A2, A3).
 */
export function expandUnitRange(from: string, to: string, prefix = ""): string[] {
  const a = from.trim();
  const b = to.trim();
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) throw new Error("From and To must be numbers, e.g. 101 and 120");
  const start = Number(a);
  const end = Number(b);
  if (end < start) throw new Error("To must be the same as or higher than From");
  const count = end - start + 1;
  if (count > MAX_UNITS_PER_BATCH) throw new Error(`Add at most ${MAX_UNITS_PER_BATCH} units at a time`);
  const width = a.length === b.length && a.startsWith("0") ? a.length : 0;
  const p = prefix.trim();
  return Array.from({ length: count }, (_, i) => p + String(start + i).padStart(width, "0"));
}
