import { describe, expect, it } from "vitest";
import { formatNaira, nairaToKobo } from "./money";
import { engineError } from "./jobs";

describe("money", () => {
  it("formats kobo as whole naira", () => {
    expect(formatNaira(400000)).toBe("₦4,000");
    expect(formatNaira("104000")).toBe("₦1,040");
    expect(formatNaira(null)).toBe("—");
  });

  it("converts naira to kobo without float drift", () => {
    expect(nairaToKobo(2500)).toBe(250000);
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });
});

describe("engine errors", () => {
  it("maps database codes to customer wording", () => {
    expect(engineError({ message: "OUTSIDE_ZONE" })).toMatch(/outside our current service area/);
    expect(engineError({ message: "weird" })).toBe("Something went wrong. Please try again.");
  });
});
