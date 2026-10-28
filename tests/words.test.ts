import { describe, expect, it } from "vitest";
import { amountInWords, numberToWords } from "@/lib/words";
import { METHOD_LABEL, isReceived } from "@/lib/booking-rules";

describe("amount in words", () => {
  it("writes whole baht", () => {
    expect(amountInWords(1000000)).toBe("Ten thousand baht only");
    expect(amountInWords(1624000)).toBe("Sixteen thousand two hundred forty baht only");
    expect(amountInWords(4500000)).toBe("Forty-five thousand baht only");
  });
  it("adds satang", () => {
    expect(amountInWords(140050)).toBe("One thousand four hundred baht and fifty satang");
    expect(amountInWords(5)).toBe("Five satang");
  });
  it("handles big and edge numbers", () => {
    expect(numberToWords(1_250_000)).toBe("one million two hundred fifty thousand");
    expect(numberToWords(0)).toBe("zero");
    expect(amountInWords(0)).toBe("Zero baht only");
    expect(numberToWords(1_000_000_001)).toBe("one billion one");
  });
});

describe("payment methods", () => {
  it("labels internal moves and leaves them out of money received", () => {
    expect(METHOD_LABEL.DEPOSIT).toBe("From deposit");
    expect(isReceived("TRANSFER")).toBe(true);
    expect(isReceived("DEPOSIT")).toBe(false);
    expect(isReceived("CREDIT")).toBe(false);
  });
});
