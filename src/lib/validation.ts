import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v));

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM, e.g. 14:00");
/** Blank or missing → the default, so optional fields can be left empty. */
const orDefault = <T extends z.ZodTypeAny>(schema: T, fallback: z.input<T>) =>
  z.preprocess((v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? fallback : v), schema);

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

export const roleSchema = z.enum(["ADMIN", "MANAGER", "FRONT_DESK", "ACCOUNTANT"]);

export const businessSchema = z.object({
  legal_name: z.string().trim().min(1, "Enter the business name").max(200),
  address: optionalText,
  tax_id: optionalText,
  phone: optionalText,
  hold_hours: orDefault(z.coerce.number().int().min(1).max(720), 24),
  front_desk_discount_limit_pct: orDefault(z.coerce.number().min(0).max(100), 10),
});

export const propertySchema = z.object({
  name: z.string().trim().min(1, "Enter the property name").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "Code is 2–6 letters or numbers, e.g. SKV"),
  type: orDefault(z.enum(["APARTMENT", "HOTEL", "HOUSE", "CONDO", "OTHER"]), "APARTMENT"),
  address: orDefault(optionalText, ""),
  phone: orDefault(optionalText, ""),
  check_in_time: orDefault(time, "14:00"),
  check_out_time: orDefault(time, "12:00"),
  meter_reading_day: orDefault(z.coerce.number().int().min(1, "Meter reading day is 1–28").max(28, "Meter reading day is 1–28"), 25),
  grace_days: orDefault(z.coerce.number().int().min(0).max(60, "Grace days are 0–60"), 5),
  payment_instructions: orDefault(optionalText, ""),
});

export const roomTypeSchema = z.object({
  name: z.string().trim().min(1, "Enter a name, e.g. Studio").max(80),
  max_occupancy: z.coerce.number().int().min(1).max(50),
  size_sqm: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0), "Size must be a positive number"),
  amenities: z
    .string()
    .trim()
    .transform((v) => (v === "" ? [] : v.split(",").map((s) => s.trim()).filter(Boolean))),
});

export const modesSchema = z
  .array(z.enum(["DAILY", "YEARLY"]))
  .min(1, "Choose Daily, Yearly or both");

/** Reads a FormData into a plain object (last value wins, except keys listed as arrays). */
export function formToObject(fd: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    out[key] = arrays.includes(key) ? fd.getAll(key).map(String) : String(fd.get(key) ?? "");
  }
  for (const key of arrays) if (!(key in out)) out[key] = [];
  return out;
}

export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the form and try again";
}
