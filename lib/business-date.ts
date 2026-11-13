/**
 * SSR-safe helpers for institute-local business dates.
 *
 * These are pure functions. They must only be called from effects, event
 * handlers, or other client-only code — never during initial render — so that
 * `new Date()` is not evaluated while Next.js prerenders a client component
 * (which fails the production build when Cache Components are enabled).
 */

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** Returns true when the string is a valid IANA time zone accepted by Intl. */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Falls back to the institute default when a stored time zone is invalid. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** Calendar date (YYYY-MM-DD) in the given institute time zone. */
export function dateInTimeZone(date: Date, timeZone: string | null | undefined): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Payroll/summary month (YYYY-MM) in the given institute time zone. */
export function monthInTimeZone(date: Date, timeZone: string | null | undefined): string {
  return dateInTimeZone(date, timeZone).slice(0, 7);
}
