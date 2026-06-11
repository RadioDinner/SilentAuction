// Small, client-safe formatting helpers shared by the dashboard components.

import { DateTime } from "luxon";

/** "$1,500" — em dash when there's no bid yet. */
export function formatMoney(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** "M:SS" or "H:MM:SS"; "CLOSED" once time is up. */
export function formatCountdown(secs: number): string {
  if (secs <= 0) return "CLOSED";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Wall-clock time in the event timezone, e.g. "5:31 PM". */
export function formatClock(iso: string | undefined, tz: string): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: tz });
  return dt.isValid ? dt.toFormat("h:mm a") : "";
}

/** Whole seconds remaining until an ISO time, relative to a server-aligned now. */
export function secsLeft(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return nowMs >= t ? 0 : Math.ceil((t - nowMs) / 1000);
}
