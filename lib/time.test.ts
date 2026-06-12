import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { parseSheetTime } from "./time";

const TZ = "America/New_York";
const EVENT_DATE = "2026-06-11";

/** The instant we expect for 5:30:00 PM on the event date, in TZ. */
const expected530 = DateTime.fromISO("2026-06-11T17:30:00", { zone: TZ }).toISO();

describe("parseSheetTime — Google Sheets long date format", () => {
  it("parses the default Sheets display with weekday + 'at' + seconds", () => {
    expect(parseSheetTime("Thursday, June 11, 2026 at 5:30:00 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("parses without the weekday", () => {
    expect(parseSheetTime("June 11, 2026 at 5:30:00 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("parses without the literal 'at'", () => {
    expect(parseSheetTime("Thursday, June 11, 2026 5:30:00 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("parses without seconds", () => {
    expect(parseSheetTime("Thursday, June 11, 2026 at 5:30 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("tolerates non-breaking / narrow no-break spaces", () => {
    // U+202F (narrow no-break) before the meridiem and U+00A0 elsewhere are what
    // Sheets/Intl often emit; both must collapse to plain spaces.
    const nbsp = String.fromCharCode(0x00a0);
    const nnbsp = String.fromCharCode(0x202f);
    const weird = `Thursday,${nbsp}June 11, 2026 at 5:30:00${nnbsp}PM`;
    expect(parseSheetTime(weird, EVENT_DATE, TZ)).toBe(expected530);
  });
});

describe("parseSheetTime — existing formats still work", () => {
  it("passes through ISO 8601, preserving its offset", () => {
    const iso = "2026-06-11T17:30:00.000-04:00";
    expect(parseSheetTime(iso, EVENT_DATE, TZ)).toBe(
      DateTime.fromISO(iso, { setZone: true }).toISO(),
    );
  });

  it("parses the Apps Script stamp format (M/d/yyyy h:mm:ss AM/PM)", () => {
    expect(parseSheetTime("6/11/2026 5:30:00 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("parses the Sheets default 24-hour datetime display", () => {
    expect(parseSheetTime("6/11/2026 17:30:00", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("anchors a clock-only time to the event date", () => {
    expect(parseSheetTime("5:30 PM", EVENT_DATE, TZ)).toBe(expected530);
  });

  it("returns undefined for empty / unparseable values", () => {
    expect(parseSheetTime("", EVENT_DATE, TZ)).toBeUndefined();
    expect(parseSheetTime("not a time", EVENT_DATE, TZ)).toBeUndefined();
  });
});
