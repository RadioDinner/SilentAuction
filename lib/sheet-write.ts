// Pure planning for writing admin edits BACK to the Google Sheet.
//
// The admin console can push the current bid / bidder / time fields (and a few
// settings) to the sheet so one person drives the live TV. To stay robust we:
//   * locate columns by header NAME (same forgiving aliases the reader uses),
//     not by fixed position, so column reordering doesn't matter;
//   * locate rows by identity (item id, or ticket group+label), so we only ever
//     touch the row that changed;
//   * emit a cell update ONLY when the new value actually differs from what's in
//     the sheet, so re-saving is idempotent and we never clobber unrelated edits.
//
// This module is pure (no IO): given the rows already read from a tab plus the
// desired values, it returns the list of A1 cell updates to apply. The actual
// read + batchUpdate lives in lib/sheets.ts.

import { DateTime } from "luxon";
import { norm } from "./config";
import { formatSheetTime, parseSheetTime } from "./time";

export type Cell = string | number;
export type Row = (string | number | boolean | null)[];

/** A single A1-addressed cell (or range) to write. */
export interface CellUpdate {
  /** Tab-qualified A1 range, e.g. "'Items'!E5". */
  range: string;
  values: Cell[][];
}

export interface ItemWrite {
  id: string;
  name?: string;
  currentBid?: number | null;
  highBidder?: string | null;
  lastBidISO?: string | null;
  baseCloseISO?: string | null;
}

export interface TicketWrite {
  group: string;
  label: string;
  currentBid?: number | null;
  highBidder?: string | null;
  lastBidISO?: string | null;
  cascadeStartISO?: string | null;
}

export interface ConfigWrite {
  eventName?: string;
  extensionWindowSeconds?: number;
  ticketCountdownSeconds?: number;
  urgentThresholdSeconds?: number;
  featuredItemId?: string;
}

export interface PlanReport {
  updates: CellUpdate[];
  /** Rows present in the payload that couldn't be found in the sheet. */
  unmatched: string[];
  /** Managed fields with no matching column / key in the sheet. */
  skipped: string[];
}

// Column aliases — kept in lockstep with the reader (lib/sheets.ts, lib/config.ts).
const ITEM_COLS = {
  id: ["id", "itemid", "itemnumber", "itemno", "number", "no", "lot", "item"],
  name: ["name", "itemname", "title"],
  currentBid: ["currentbid", "currenthighbid", "highbid", "bid", "amount"],
  highBidder: ["highbidder", "bidder", "biddername", "winner", "paddle"],
  lastBid: ["lastbidtime", "lastbid", "bidtime", "timestamp", "updated", "time"],
  close: ["closetime", "close", "closes", "closingtime", "endtime", "end", "baseclose"],
};
const TICKET_COLS = {
  group: ["group", "ticketgroup", "category", "type"],
  label: ["label", "ticket", "ticketnumber", "ticketno", "number", "no", "seat", "name"],
  currentBid: ["currentbid", "currenthighbid", "highbid", "bid", "amount", "price"],
  highBidder: ["highbidder", "bidder", "biddername", "winner", "paddle"],
  lastBid: ["lastbidtime", "lastbid", "bidtime", "timestamp", "updated", "time"],
  cascade: ["cascadestart", "groupstart", "starttime", "groupclosestart", "closestart"],
};
// Config keys: only the *seconds* spellings, so we never write a seconds value
// into a key the reader would interpret as minutes.
const CONFIG_KEYS: { field: keyof ConfigWrite; canonical: string; aliases: string[] }[] = [
  { field: "eventName", canonical: "event_name", aliases: ["event_name", "title"] },
  {
    field: "extensionWindowSeconds",
    canonical: "extension_window_seconds",
    aliases: ["extension_window_seconds", "anti_snipe_seconds"],
  },
  {
    field: "ticketCountdownSeconds",
    canonical: "ticket_countdown_seconds",
    aliases: ["ticket_countdown_seconds"],
  },
  {
    field: "urgentThresholdSeconds",
    canonical: "urgent_threshold_seconds",
    aliases: ["urgent_threshold_seconds", "urgent_seconds"],
  },
  {
    field: "featuredItemId",
    canonical: "featured_item_id",
    aliases: ["featured_item_id", "featured_item"],
  },
];

// ---- low-level helpers ----------------------------------------------------

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colLetter(index: number): string {
  let s = "";
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Tab-qualify an A1 cell, single-quoting the tab name (doubling any quotes). */
function a1(tab: string, cell: string): string {
  return `'${tab.replace(/'/g, "''")}'!${cell}`;
}

function headerIndex(rows: Row[]): Map<string, number> {
  const map = new Map<string, number>();
  (rows[0] ?? []).forEach((h, i) => {
    const key = norm(String(h ?? ""));
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function resolveCol(hi: Map<string, number>, aliases: string[]): number | undefined {
  for (const a of aliases) {
    const i = hi.get(norm(a));
    if (i !== undefined) return i;
  }
  return undefined;
}

function cellStr(row: Row, i: number | undefined): string {
  if (i === undefined) return "";
  const v = row[i];
  return v === undefined || v === null ? "" : String(v).trim();
}

function moneyEq(cell: string, val: number | null | undefined): boolean {
  const trimmed = cell.trim();
  const n = Number(trimmed.replace(/[^0-9.\-]/g, ""));
  const existing = trimmed === "" || !Number.isFinite(n) ? undefined : n;
  const target = val == null ? undefined : val;
  return existing === target;
}

function strEq(cell: string, val: string | null | undefined): boolean {
  return cell.trim() === (val ?? "").trim();
}

function timeEq(
  cell: string,
  iso: string | null | undefined,
  eventDateISO: string | undefined,
  tz: string,
): boolean {
  const existing = parseSheetTime(cell, eventDateISO, tz);
  const target = iso ?? undefined;
  if (!existing && !target) return true;
  if (!existing || !target) return false;
  return DateTime.fromISO(existing).toMillis() === DateTime.fromISO(target).toMillis();
}

// ---- planners -------------------------------------------------------------

export function planItemWrites(
  rows: Row[],
  items: ItemWrite[],
  tab: string,
  eventDateISO: string | undefined,
  tz: string,
): PlanReport {
  const updates: CellUpdate[] = [];
  const unmatched: string[] = [];
  const skipped = new Set<string>();
  if (rows.length === 0) {
    items.forEach((it) => unmatched.push(`Item ${it.id}`));
    return { updates, unmatched, skipped: [] };
  }

  const hi = headerIndex(rows);
  const col = {
    id: resolveCol(hi, ITEM_COLS.id),
    name: resolveCol(hi, ITEM_COLS.name),
    currentBid: resolveCol(hi, ITEM_COLS.currentBid),
    highBidder: resolveCol(hi, ITEM_COLS.highBidder),
    lastBid: resolveCol(hi, ITEM_COLS.lastBid),
    close: resolveCol(hi, ITEM_COLS.close),
  };

  // Map identity -> 1-based sheet row. Mirror the reader's id resolution
  // (id, else name) and also index by name so a payload id == name still hits.
  const rowOf = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = cellStr(row, col.id);
    const name = cellStr(row, col.name);
    const resolved = id || name;
    if (!resolved) continue;
    if (!rowOf.has(resolved)) rowOf.set(resolved, r + 1);
    if (name && !rowOf.has(name)) rowOf.set(name, r + 1);
  }

  for (const it of items) {
    const sheetRow = rowOf.get(it.id) ?? (it.name ? rowOf.get(it.name) : undefined);
    if (!sheetRow) {
      unmatched.push(`Item ${it.id}`);
      continue;
    }
    const row = rows[sheetRow - 1];
    const put = (ci: number | undefined, label: string, eq: boolean, value: Cell) => {
      if (ci === undefined) {
        skipped.add(`Items: no "${label}" column`);
        return;
      }
      if (eq) return;
      updates.push({ range: a1(tab, `${colLetter(ci)}${sheetRow}`), values: [[value]] });
    };
    put(col.currentBid, "Current Bid", moneyEq(cellStr(row, col.currentBid), it.currentBid), it.currentBid ?? "");
    put(col.highBidder, "High Bidder", strEq(cellStr(row, col.highBidder), it.highBidder), it.highBidder ?? "");
    put(
      col.lastBid,
      "Last Bid Time",
      timeEq(cellStr(row, col.lastBid), it.lastBidISO, eventDateISO, tz),
      formatSheetTime(it.lastBidISO, tz),
    );
    put(
      col.close,
      "Close Time",
      timeEq(cellStr(row, col.close), it.baseCloseISO, eventDateISO, tz),
      formatSheetTime(it.baseCloseISO, tz),
    );
  }

  return { updates, unmatched, skipped: [...skipped] };
}

export function planTicketWrites(
  rows: Row[],
  tickets: TicketWrite[],
  tab: string,
  eventDateISO: string | undefined,
  tz: string,
): PlanReport {
  const updates: CellUpdate[] = [];
  const unmatched: string[] = [];
  const skipped = new Set<string>();
  if (rows.length === 0) {
    tickets.forEach((t) => unmatched.push(`Ticket ${t.group} ${t.label}`));
    return { updates, unmatched, skipped: [] };
  }

  const hi = headerIndex(rows);
  const col = {
    group: resolveCol(hi, TICKET_COLS.group),
    label: resolveCol(hi, TICKET_COLS.label),
    currentBid: resolveCol(hi, TICKET_COLS.currentBid),
    highBidder: resolveCol(hi, TICKET_COLS.highBidder),
    lastBid: resolveCol(hi, TICKET_COLS.lastBid),
    cascade: resolveCol(hi, TICKET_COLS.cascade),
  };

  const key = (group: string, label: string) => `${norm(group)} ${norm(label)}`;
  const rowOf = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const group = cellStr(row, col.group) || "Tickets";
    const label = cellStr(row, col.label) || String(r);
    const k = key(group, label);
    if (!rowOf.has(k)) rowOf.set(k, r + 1);
  }

  for (const t of tickets) {
    const sheetRow = rowOf.get(key(t.group || "Tickets", t.label));
    if (!sheetRow) {
      unmatched.push(`Ticket ${t.group} ${t.label}`);
      continue;
    }
    const row = rows[sheetRow - 1];
    const put = (ci: number | undefined, label: string, eq: boolean, value: Cell) => {
      if (ci === undefined) {
        skipped.add(`Tickets: no "${label}" column`);
        return;
      }
      if (eq) return;
      updates.push({ range: a1(tab, `${colLetter(ci)}${sheetRow}`), values: [[value]] });
    };
    put(col.currentBid, "Current Bid", moneyEq(cellStr(row, col.currentBid), t.currentBid), t.currentBid ?? "");
    put(col.highBidder, "High Bidder", strEq(cellStr(row, col.highBidder), t.highBidder), t.highBidder ?? "");
    put(
      col.lastBid,
      "Last Bid Time",
      timeEq(cellStr(row, col.lastBid), t.lastBidISO, eventDateISO, tz),
      formatSheetTime(t.lastBidISO, tz),
    );
    put(
      col.cascade,
      "Cascade Start",
      timeEq(cellStr(row, col.cascade), t.cascadeStartISO, eventDateISO, tz),
      formatSheetTime(t.cascadeStartISO, tz),
    );
  }

  return { updates, unmatched, skipped: [...skipped] };
}

/**
 * Plan Config writes. The Config tab is a flat key/value list (col A = key,
 * col B = value). We update the value cell of an existing key only; a setting
 * whose key isn't present is reported as skipped rather than appended, to keep
 * writes minimal and predictable.
 */
export function planConfigWrites(rows: Row[], config: ConfigWrite, tab: string): PlanReport {
  const updates: CellUpdate[] = [];
  const skipped: string[] = [];

  // First-match map of normalized key -> 1-based row, skipping a header row.
  const rowOf = new Map<string, number>();
  rows.forEach((row, r) => {
    const k = norm(String(row?.[0] ?? ""));
    if (!k || k === "key") return;
    if (!rowOf.has(k)) rowOf.set(k, r + 1);
  });

  for (const spec of CONFIG_KEYS) {
    const value = config[spec.field];
    if (value === undefined) continue;

    let sheetRow: number | undefined;
    for (const alias of spec.aliases) {
      const hit = rowOf.get(norm(alias));
      if (hit !== undefined) {
        sheetRow = hit;
        break;
      }
    }
    if (sheetRow === undefined) {
      // Don't report a missing row for an empty optional setting (e.g. no feature).
      if (String(value).trim() !== "") skipped.push(`Settings: no "${spec.canonical}" row`);
      continue;
    }

    const existing = cellStr(rows[sheetRow - 1], 1);
    const isNum = typeof value === "number";
    const eq = isNum ? moneyEq(existing, value as number) : strEq(existing, String(value));
    if (eq) continue;

    updates.push({
      range: a1(tab, `B${sheetRow}`),
      values: [[isNum ? (value as number) : String(value)]],
    });
  }

  return { updates, unmatched: [], skipped };
}
