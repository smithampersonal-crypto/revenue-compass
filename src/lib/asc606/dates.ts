/**
 * Timezone-free calendar-date utilities.
 *
 * Dates are plain "YYYY-MM-DD" strings. Where a JS Date is used it is
 * constructed and read through Date.UTC only, so the browser's local timezone
 * can never affect an accounting result.
 */

import type { IsoDate, MonthKey } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateError";
  }
}

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new DateError(`invalid month ${month}`);
  }
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1]!;
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

export function parseIsoDate(value: IsoDate): CalendarDate {
  if (!isValidIsoDate(value)) throw new DateError(`invalid calendar date "${value}"`);
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

export function toIsoDate(date: CalendarDate): IsoDate {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(
    date.day,
  ).padStart(2, "0")}`;
}

/** Days since 1970-01-01, computed in UTC only. */
export function dayIndex(value: IsoDate): number {
  const { year, month, day } = parseIsoDate(value);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Exclusive difference: daysBetween("2027-01-01", "2027-01-02") === 1. */
export function daysBetween(start: IsoDate, end: IsoDate): number {
  return dayIndex(end) - dayIndex(start);
}

/** Inclusive service-day count: both endpoints count. */
export function inclusiveDayCount(start: IsoDate, end: IsoDate): number {
  const days = daysBetween(start, end) + 1;
  if (days <= 0) throw new DateError(`end date "${end}" precedes start date "${start}"`);
  return days;
}

export function monthKeyOf(value: IsoDate): MonthKey {
  if (!isValidIsoDate(value)) throw new DateError(`invalid calendar date "${value}"`);
  return value.slice(0, 7);
}

export function parseMonthKey(month: MonthKey): { year: number; month: number } {
  if (!MONTH_KEY_PATTERN.test(month)) throw new DateError(`invalid month key "${month}"`);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) throw new DateError(`invalid month key "${month}"`);
  return { year, month: monthNumber };
}

export function monthStart(month: MonthKey): IsoDate {
  const { year, month: m } = parseMonthKey(month);
  return toIsoDate({ year, month: m, day: 1 });
}

export function monthEnd(month: MonthKey): IsoDate {
  const { year, month: m } = parseMonthKey(month);
  return toIsoDate({ year, month: m, day: daysInMonth(year, m) });
}

export function nextMonth(month: MonthKey): MonthKey {
  const { year, month: m } = parseMonthKey(month);
  const y = m === 12 ? year + 1 : year;
  const nm = m === 12 ? 1 : m + 1;
  return `${String(y).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** Inclusive list of month keys spanning two dates. */
export function enumerateMonths(start: IsoDate, end: IsoDate): MonthKey[] {
  if (dayIndex(end) < dayIndex(start)) {
    throw new DateError(`end date "${end}" precedes start date "${start}"`);
  }
  return monthRange(monthKeyOf(start), monthKeyOf(end));
}

/** Every month key from first to last inclusive. */
export function monthRange(first: MonthKey, last: MonthKey): MonthKey[] {
  parseMonthKey(first);
  parseMonthKey(last);
  if (last < first) throw new DateError(`month "${last}" precedes "${first}"`);
  const months: MonthKey[] = [];
  let current = first;
  for (;;) {
    months.push(current);
    if (current === last) break;
    current = nextMonth(current);
  }
  return months;
}

/** Number of days a [start, end] inclusive service period overlaps a month. */
export function overlapDaysInMonth(month: MonthKey, start: IsoDate, end: IsoDate): number {
  const periodStart = Math.max(dayIndex(start), dayIndex(monthStart(month)));
  const periodEnd = Math.min(dayIndex(end), dayIndex(monthEnd(month)));
  const days = periodEnd - periodStart + 1;
  return days > 0 ? days : 0;
}

/**
 * Maximum supported accounting horizon, in inclusive calendar months (20 years).
 * A longer span is treated as unsupported input, never calculated.
 */
export const MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS = 240;

/** Absolute month ordinal: year * 12 + (month - 1). */
export function monthIndexOf(month: MonthKey): number {
  const { year, month: m } = parseMonthKey(month);
  return year * 12 + (m - 1);
}

/**
 * Inclusive month count between two month keys, computed arithmetically —
 * no month list is ever constructed.
 */
export function inclusiveMonthCount(first: MonthKey, last: MonthKey): number {
  return monthIndexOf(last) - monthIndexOf(first) + 1;
}

/** True when the inclusive span exceeds the supported accounting horizon. */
export function exceedsSupportedHorizon(first: MonthKey, last: MonthKey): boolean {
  return inclusiveMonthCount(first, last) > MAX_SUPPORTED_ACCOUNTING_HORIZON_MONTHS;
}

/** Same check for a [start, end] date period, without enumerating months. */
export function datePeriodExceedsSupportedHorizon(start: IsoDate, end: IsoDate): boolean {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return false;
  return exceedsSupportedHorizon(monthKeyOf(start), monthKeyOf(end));
}

/**
 * Accounting horizon helper (spec A2). Revenue recognition is limited to the PO
 * recognition periods; later phases widen the accounting range to also cover
 * unconditional-right months that fall outside the service term.
 */
export function accountingHorizon(
  monthSets: readonly (readonly MonthKey[])[],
): { firstMonth: MonthKey; lastMonth: MonthKey } | null {
  const all = monthSets.flat();
  if (all.length === 0) return null;
  return {
    firstMonth: all.reduce((a, b) => (a < b ? a : b)),
    lastMonth: all.reduce((a, b) => (a > b ? a : b)),
  };
}
