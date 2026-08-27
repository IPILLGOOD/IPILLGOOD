/** Calendar dates are YYYY-MM-DD in Seoul; instants must include an explicit offset. */
export const SEOUL_TIME_ZONE = "Asia/Seoul" as const;
const DAY_MS = 86_400_000;
const calendarPattern = /^\d{4}-\d{2}-\d{2}$/;

function calendarTimestamp(dateKey: string) {
  if (!calendarPattern.test(dateKey)) throw new RangeError("Expected a calendar date (YYYY-MM-DD).");
  const timestamp = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== dateKey) throw new RangeError("Invalid calendar date.");
  return timestamp;
}

function instant(value: string | Date) {
  if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new RangeError("An instant must include a time zone.");
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid instant.");
  return date;
}

export function dateKeyInTimeZone(value: Date, timeZone: string = SEOUL_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant(value));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dateKeyInSeoul(value: string | Date = new Date()) {
  if (typeof value === "string" && calendarPattern.test(value)) {
    calendarTimestamp(value);
    return value;
  }
  return dateKeyInTimeZone(instant(value));
}

export function formatInSeoul(value: string | Date, options: Intl.DateTimeFormatOptions) {
  const date = typeof value === "string" && calendarPattern.test(value)
    ? new Date(calendarTimestamp(value) - 9 * 60 * 60 * 1000)
    : instant(value);
  return new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: SEOUL_TIME_ZONE }).format(date);
}

export function calendarDayDifference(start: string, end: string) {
  return (calendarTimestamp(end) - calendarTimestamp(start)) / DAY_MS;
}

export function addCalendarDays(dateKey: string, days: number) {
  if (!Number.isInteger(days)) throw new RangeError("Expected whole calendar days.");
  return new Date(calendarTimestamp(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

export function seoulTimeLabel(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: SEOUL_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(instant(value));
  return `${parts.find((part) => part.type === "hour")!.value}:${parts.find((part) => part.type === "minute")!.value}`;
}

/** Inclusive Seoul calendar dates, represented as an inclusive/exclusive UTC interval. */
export function seoulDateRange(endDate: string, days: number) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("Expected a positive day count.");
  const startDate = addCalendarDays(endDate, 1 - days);
  return {
    startDate, endDate,
    startInclusive: new Date(calendarTimestamp(startDate) - 9 * 60 * 60 * 1000).toISOString(),
    endExclusive: new Date(calendarTimestamp(addCalendarDays(endDate, 1)) - 9 * 60 * 60 * 1000).toISOString(),
  };
}
