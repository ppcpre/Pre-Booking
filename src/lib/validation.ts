import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v));

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM, e.g. 14:00");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

export const roleSchema = z.enum(["ADMIN", "MANAGER", "FRONT_DESK", "ACCOUNTANT"]);

export const businessSchema = z.object({
  legal_name: z.string().trim().min(1, "Enter the business name").max(200),
  address: optionalText,
  tax_id: optionalText,
  phone: optionalText,
  hold_hours: z.coerce.number().int().min(1).max(720),
  front_desk_discount_limit_pct: z.coerce.number().min(0).max(100),
});

export const propertySchema = z.object({
  name: z.string().trim().min(1, "Enter the property name").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "Code is 2–6 letters or numbers, e.g. SKV"),
  type: z.enum(["APARTMENT", "HOTEL", "HOUSE", "CONDO", "OTHER"]),
  address: optionalText,
  phone: optionalText,
  check_in_time: time,
  check_out_time: time,
  meter_reading_day: z.coerce.number().int().min(1).max(28),
  grace_days: z.coerce.number().int().min(0).max(60),
  payment_instructions: optionalText,
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
