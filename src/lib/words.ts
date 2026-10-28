const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"]];

function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) {
    out.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    out.push(ONES[n]!);
  }
  return out.join(" ");
}

export function numberToWords(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${under1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(under1000(n));
  return parts.join(" ");
}

/** "Ten thousand baht only" / "One hundred baht and fifty satang" — the wording printed on receipts. */
export function amountInWords(satang: number): string {
  const sign = satang < 0 ? "minus " : "";
  const abs = Math.abs(Math.round(satang));
  const baht = Math.floor(abs / 100);
  const st = abs % 100;
  const text = st === 0 ? `${numberToWords(baht)} baht only` : `${baht ? `${numberToWords(baht)} baht and ` : ""}${numberToWords(st)} satang`;
  const full = sign + text;
  return full.charAt(0).toUpperCase() + full.slice(1);
}
