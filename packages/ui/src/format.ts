import type { MetricUnit } from "@arf/contracts";

/**
 * Display formatting only. Values arrive as exact decimal strings and are
 * rounded for display here; the stored value is never changed.
 */
export function formatDecimal(value: string | null, places = 2): string {
  if (value === null) return "—";
  const negative = value.startsWith("-");
  const [intPart = "0", frac = ""] = (negative ? value.slice(1) : value).split(".");
  const padded = (frac + "0".repeat(places + 1)).slice(0, places + 1);
  let digits = intPart + padded.slice(0, places);
  if (Number(padded.charAt(places)) >= 5) {
    digits = (BigInt(digits) + 1n).toString().padStart(intPart.length + places, "0");
  }
  const i = digits.slice(0, digits.length - places) || "0";
  const f = places > 0 ? `.${digits.slice(digits.length - places)}` : "";
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const isZero = /^[0,]*$/.test(grouped) && /^\.?0*$/.test(f);
  return `${negative && !isZero ? "-" : ""}${grouped}${f}`;
}

export function formatMetric(value: string | null, unit: MetricUnit, currency: string): string {
  if (value === null) return "undefined";
  switch (unit) {
    case "CURRENCY":
      return `${formatDecimal(value, 2)} ${currency}`;
    case "PERCENT_POINTS":
      return `${formatDecimal(value, 2)}%`;
    case "RATIO":
      return formatDecimal(value, 3);
    case "COUNT":
      return formatDecimal(value, 0);
    case "SECONDS": {
      const hours = Number(value) / 3600;
      return `${hours.toFixed(1)} h`;
    }
  }
}

export function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 10)}…` : "—";
}
