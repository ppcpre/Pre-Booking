import { describe, expect, it } from "vitest";
import { bahtToSatang, formatTHB, satangToBaht } from "@/lib/money";
import { expandUnitRange } from "@/lib/units";
import { activationBlockers, setupProgress, stepDone, type SetupStatus } from "@/lib/setup";
import { safeNext } from "@/lib/safe-next";
import { greeting } from "@/lib/greeting";
import { propertySchema, roomTypeSchema } from "@/lib/validation";

describe("money", () => {
  it("converts baht to satang without float errors", () => {
    expect(bahtToSatang("1400")).toBe(140000);
    expect(bahtToSatang("1,400.50")).toBe(140050);
    expect(bahtToSatang("0.1")).toBe(10);
    expect(bahtToSatang("19.99")).toBe(1999);
    expect(bahtToSatang(8.5)).toBe(850);
  });
  it("rejects bad amounts", () => {
    expect(() => bahtToSatang("abc")).toThrow();
    expect(() => bahtToSatang("-5")).toThrow();
    expect(() => bahtToSatang("1.234")).toThrow();
  });
  it("round-trips and formats", () => {
    expect(satangToBaht(140050)).toBe("1400.50");
    expect(satangToBaht(140000)).toBe("1400");
    expect(satangToBaht(null)).toBe("");
    expect(formatTHB(1500000)).toBe("฿15,000");
    expect(formatTHB(null)).toBe("–");
  });
});

describe("unit ranges", () => {
  it("expands numeric ranges", () => {
    expect(expandUnitRange("301", "305")).toEqual(["301", "302", "303", "304", "305"]);
    expect(expandUnitRange("101", "101")).toEqual(["101"]);
  });
  it("keeps leading zeros and prefixes", () => {
    expect(expandUnitRange("008", "011")).toEqual(["008", "009", "010", "011"]);
    expect(expandUnitRange("1", "3", "A")).toEqual(["A1", "A2", "A3"]);
  });
  it("rejects bad input", () => {
    expect(() => expandUnitRange("120", "101")).toThrow(/higher/);
    expect(() => expandUnitRange("1a", "5")).toThrow(/numbers/);
    expect(() => expandUnitRange("1", "1000")).toThrow(/at most/);
  });
});

describe("setup checklist", () => {
  const base: SetupStatus = { room_types: 1, units: 10, missing_rates: 0, needs_utilities: true, utility_rates: 2, staff: 0 };
  it("is ready when everything is set", () => {
    expect(activationBlockers(base)).toEqual([]);
    expect(setupProgress(base)).toEqual({ done: 5, total: 5 });
  });
  it("lists what's missing", () => {
    expect(activationBlockers({ ...base, room_types: 0, units: 0 })).toEqual(["Add at least one room type", "Add units"]);
    expect(activationBlockers({ ...base, missing_rates: 2 })).toEqual(["Set 2 missing rates"]);
    expect(activationBlockers({ ...base, utility_rates: 1 })).toEqual(["Set water and electricity prices for yearly units"]);
  });
  it("doesn't need meters when nothing is rented yearly", () => {
    expect(stepDone("meters", { ...base, needs_utilities: false, utility_rates: 0 })).toBe(true);
  });
});

describe("safeNext", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/p/SKV")).toBe("/p/SKV");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("greeting", () => {
  it("uses Bangkok time", () => {
    expect(greeting(new Date("2026-10-27T01:00:00Z"))).toBe("Good morning"); // 08:00 BKK
    expect(greeting(new Date("2026-10-27T08:00:00Z"))).toBe("Good afternoon"); // 15:00 BKK
    expect(greeting(new Date("2026-10-27T13:00:00Z"))).toBe("Good evening"); // 20:00 BKK
  });
});

describe("validation", () => {
  const ok = { name: "Sukhumvit Residence", code: "skv", type: "APARTMENT", address: "", phone: "", check_in_time: "14:00", check_out_time: "12:00", meter_reading_day: "25", grace_days: "5", payment_instructions: "" };
  it("normalises the property code and blanks", () => {
    const r = propertySchema.parse(ok);
    expect(r.code).toBe("SKV");
    expect(r.address).toBeNull();
    expect(r.meter_reading_day).toBe(25);
  });
  it("rejects bad codes", () => {
    expect(propertySchema.safeParse({ ...ok, code: "SK-1" }).success).toBe(false);
    expect(propertySchema.safeParse({ ...ok, code: "S" }).success).toBe(false);
  });
  it("splits amenities", () => {
    expect(roomTypeSchema.parse({ name: "Studio", max_occupancy: "2", size_sqm: "", amenities: "Air con, Wi-Fi,," }).amenities).toEqual(["Air con", "Wi-Fi"]);
  });
});
