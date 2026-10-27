import { describe, expect, it } from "vitest";
import { addDays, addYears, daysBetween, fmtRange, isWeekend, parseStay, todayISO } from "@/lib/dates";
import { refundSuggestion, rpcMessage } from "@/lib/booking-rules";

describe("dates", () => {
  it("adds days across months and years", () => {
    expect(addDays("2030-01-31", 1)).toBe("2030-02-01");
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
  });
  it("adds years like Postgres (29 Feb → 28 Feb)", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2031-01-31", 1)).toBe("2032-01-31");
  });
  it("counts nights", () => {
    expect(daysBetween("2030-01-04", "2030-01-07")).toBe(3);
    expect(daysBetween("2030-03-30", "2030-04-02")).toBe(3);
  });
  it("knows Friday and Saturday nights", () => {
    expect(isWeekend("2030-01-04")).toBe(true); // Fri
    expect(isWeekend("2030-01-05")).toBe(true); // Sat
    expect(isWeekend("2030-01-06")).toBe(false); // Sun
  });
  it("parses Postgres date ranges", () => {
    expect(parseStay("[2030-01-04,2030-01-07)")).toEqual({ start: "2030-01-04", end: "2030-01-07" });
    expect(parseStay("[2030-01-04,2030-01-06]")).toEqual({ start: "2030-01-04", end: "2030-01-07" });
  });
  it("formats ranges", () => {
    expect(fmtRange("2030-01-04", "2030-01-07")).toBe("4 Jan – 7 Jan 2030");
    expect(fmtRange("2030-12-30", "2031-01-02")).toBe("30 Dec 2030 – 2 Jan 2031");
  });
  it("uses Bangkok for today", () => {
    expect(todayISO(new Date("2030-01-04T18:30:00Z"))).toBe("2030-01-05"); // 01:30 in Bangkok
  });
});

describe("refund suggestion", () => {
  const strict = [
    { days_before: 14, refund_percent: 100 },
    { days_before: 7, refund_percent: 50 },
    { days_before: 0, refund_percent: 0 },
  ];
  it("picks the rule the cancellation meets", () => {
    expect(refundSuggestion(strict, 20, 480000)).toMatchObject({ percent: 100, amount: 480000 });
    expect(refundSuggestion(strict, 10, 480000)).toMatchObject({ percent: 50, amount: 240000 });
    expect(refundSuggestion(strict, 2, 480000)).toMatchObject({ percent: 0, amount: 0 });
  });
  it("gives nothing without a policy", () => {
    expect(refundSuggestion(null, 30, 100000).amount).toBe(0);
  });
});

describe("rpc errors", () => {
  it("shows our own messages and hides internal ones", () => {
    expect(rpcMessage({ code: "P0001", message: "Unit 101 was just booked" })).toBe("Unit 101 was just booked");
    expect(rpcMessage({ code: "42501", message: "permission denied for table bookings" })).toBe("Something went wrong. Try again.");
    expect(rpcMessage({ code: "23P01" })).toMatch(/just booked/);
  });
});
