import DecimalBase from "decimal.js";

/** Isolated Decimal constructor so global configuration of other packages cannot change results. */
export const D = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

/** Storage scale matches numeric(38, 12) in the database. */
export const STORAGE_SCALE = 12;

export function toStorage(value: Dec): string {
  return value.toDecimalPlaces(STORAGE_SCALE).toFixed();
}
