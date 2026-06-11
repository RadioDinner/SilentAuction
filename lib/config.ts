// Turn the sheet's Config tab (a flat list of Key/Value rows) into a typed,
// defaulted AuctionConfig.

import type { AuctionConfig } from "./types";
import { parseEventDate, parseSheetTime } from "./time";

const DEFAULTS = {
  eventName: "Silent Auction",
  timezone: "America/Chicago",
  extensionWindowSeconds: 60,
  ticketCountdownSeconds: 180,
  urgentThresholdSeconds: 120,
};

/** Normalize a key/header for forgiving lookups: lowercase, alnum only. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildLookup(raw: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    if (k) map.set(norm(k), v);
  }
  return (keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = map.get(norm(key));
      if (v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return undefined;
  };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse raw Config key/value pairs into an AuctionConfig.
 * Accepts both *_seconds and *_minutes variants for durations.
 */
export function parseConfig(raw: Record<string, string>): AuctionConfig {
  const get = buildLookup(raw);

  // Read a duration that may be given in seconds or minutes.
  const duration = (
    secKeys: string[],
    minKeys: string[],
    fallback: number,
  ): number => {
    const s = num(get(secKeys));
    if (s !== undefined) return s;
    const m = num(get(minKeys));
    if (m !== undefined) return m * 60;
    return fallback;
  };

  const timezone = get(["timezone", "tz", "time_zone"]) ?? DEFAULTS.timezone;
  const eventDateISO = parseEventDate(get(["event_date", "date"]), timezone);

  const windowSeconds = duration(
    ["extension_window_seconds", "anti_snipe_seconds"],
    ["extension_window_minutes", "anti_snipe_minutes"],
    DEFAULTS.extensionWindowSeconds,
  );

  const ticketCountdownSeconds = duration(
    ["ticket_countdown_seconds"],
    ["ticket_countdown_minutes"],
    DEFAULTS.ticketCountdownSeconds,
  );

  const urgentThresholdSeconds = duration(
    ["urgent_threshold_seconds", "urgent_seconds"],
    ["urgent_threshold_minutes"],
    DEFAULTS.urgentThresholdSeconds,
  );

  const ticketCascadeStartISO = parseSheetTime(
    get(["ticket_cascade_start", "tickets_start", "cascade_start"]),
    eventDateISO,
    timezone,
  );

  return {
    eventName: get(["event_name", "title"]) ?? DEFAULTS.eventName,
    timezone,
    eventDateISO,
    extensionWindowSeconds: windowSeconds,
    ticketCountdownSeconds,
    urgentThresholdSeconds,
    ticketCascadeStartISO,
    featuredItemId: get(["featured_item_id", "featured_item"]) || undefined,
  };
}
