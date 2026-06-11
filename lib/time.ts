// Timezone-aware parsing of the loose time values people type into a sheet.
//
// Staff enter close times as plain clock times ("5:30 PM") or full dates pasted
// from Google Sheets ("Thursday, June 11, 2026 at 5:30:00 PM"); the Apps Script
// stamps bid times as full ISO strings. This turns any of them into a single
// canonical ISO string (with offset) anchored to the event's timezone.

import { DateTime } from "luxon";

const DATETIME_FORMATS = [
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "M/d/yyyy h:mm:ss a",
  "M/d/yyyy h:mm a",
  "M/d/yyyy H:mm:ss",
  "M/d/yyyy H:mm",
  "M/d/yy h:mm a",
  // Google Sheets' long date display, e.g. "Thursday, June 11, 2026 at 5:30:00 PM"
  // (with and without the weekday, the literal "at", and the seconds).
  "EEEE, MMMM d, yyyy 'at' h:mm:ss a",
  "EEEE, MMMM d, yyyy 'at' h:mm a",
  "MMMM d, yyyy 'at' h:mm:ss a",
  "MMMM d, yyyy 'at' h:mm a",
  "EEEE, MMMM d, yyyy h:mm:ss a",
  "EEEE, MMMM d, yyyy h:mm a",
  "MMMM d, yyyy h:mm:ss a",
  "MMMM d, yyyy h:mm a",
];

const TIME_ONLY_FORMATS = [
  "h:mm:ss a",
  "h:mm a",
  "h:mma",
  "ha",
  "H:mm:ss",
  "H:mm",
  "HH:mm",
];

/**
 * Parse a sheet cell into an ISO timestamp string, or undefined.
 *
 * @param raw          the cell value (string or number)
 * @param eventDateISO ISO date ("YYYY-MM-DD") used to anchor clock-only times
 * @param tz           IANA timezone the clock times are expressed in
 */
export function parseSheetTime(
  raw: unknown,
  eventDateISO: string | undefined,
  tz: string,
): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  // Collapse any whitespace — including the non-breaking / narrow no-break
  // spaces Sheets and some locales emit before AM/PM — to single plain spaces,
  // so the format strings below can match. JS \s covers U+00A0 and U+202F.
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return undefined;

  // 1) Already ISO 8601 (Apps Script stamps, or anyone pasting ISO).
  const iso = DateTime.fromISO(s, { setZone: true });
  if (iso.isValid) return iso.toISO() ?? undefined;

  // 2) A full date + time in a common locale format.
  for (const fmt of DATETIME_FORMATS) {
    const dt = DateTime.fromFormat(s, fmt, { zone: tz });
    if (dt.isValid) return dt.toISO() ?? undefined;
  }

  // 3) A clock time only — stamp it onto the event date.
  const base = eventDateISO
    ? DateTime.fromISO(eventDateISO, { zone: tz })
    : DateTime.now().setZone(tz);
  const anchor = base.isValid ? base : DateTime.now().setZone(tz);
  for (const fmt of TIME_ONLY_FORMATS) {
    const t = DateTime.fromFormat(s, fmt, { zone: tz });
    if (t.isValid) {
      const merged = anchor.set({
        hour: t.hour,
        minute: t.minute,
        second: t.second,
        millisecond: 0,
      });
      return merged.toISO() ?? undefined;
    }
  }

  return undefined;
}

/**
 * Format an ISO instant as a sheet-friendly local datetime string in `tz`.
 * The output ("M/d/yyyy h:mm:ss a") is one of the DATETIME_FORMATS above, so a
 * value written by this function round-trips cleanly back through
 * parseSheetTime. Returns "" for a missing/invalid input.
 */
export function formatSheetTime(iso: string | undefined | null, tz: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(tz);
  if (!dt.isValid) return "";
  return dt.toFormat("M/d/yyyy h:mm:ss a");
}

/** Parse a date like "2026-06-11" or "6/11/2026" to an ISO date string. */
export function parseEventDate(
  raw: unknown,
  tz: string,
): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  const iso = DateTime.fromISO(s, { zone: tz });
  if (iso.isValid) return iso.toISODate() ?? undefined;

  for (const fmt of ["M/d/yyyy", "M/d/yy", "MM/dd/yyyy", "yyyy/MM/dd"]) {
    const dt = DateTime.fromFormat(s, fmt, { zone: tz });
    if (dt.isValid) return dt.toISODate() ?? undefined;
  }
  return undefined;
}
