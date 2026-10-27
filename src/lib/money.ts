/** Amounts are stored in satang (1 baht = 100 satang) to avoid rounding errors. */
export function bahtToSatang(input: string | number): number {
  const text = typeof input === "number" ? String(input) : input.replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount like 1500 or 1500.50");
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function satangToBaht(satang: number | null | undefined): string {
  if (satang == null) return "";
  const whole = Math.trunc(satang / 100);
  const frac = Math.abs(satang % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function formatTHB(satang: number | null | undefined): string {
  if (satang == null) return "–";
  return `฿${fmt.format(satang / 100)}`;
}
