import { describe, expect, it } from "vitest";
import { formatDecimal, formatMetric } from "../src/format";

describe("display formatting", () => {
  it("rounds half up on the absolute value without floating point", () => {
    expect(formatDecimal("201.088679320000")).toBe("201.09");
    expect(formatDecimal("-38.285")).toBe("-38.29");
    expect(formatDecimal("1234567.004")).toBe("1,234,567.00");
    expect(formatDecimal("0.999", 2)).toBe("1.00");
    expect(formatDecimal("-0.001", 2)).toBe("0.00");
    expect(formatDecimal(null)).toBe("—");
  });
  it("renders units explicitly", () => {
    expect(formatMetric("12.000000000000", "COUNT", "USDT")).toBe("12");
    expect(formatMetric("2.01", "PERCENT_POINTS", "USDT")).toBe("2.01%");
    expect(formatMetric(null, "RATIO", "USDT")).toBe("undefined");
  });
});
