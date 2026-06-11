// Reads the Google Sheet (Items / Tickets / Config tabs) into AuctionData.
// Read-only, via a service account. Header names are matched forgivingly so
// staff don't have to nail an exact schema.

import { google } from "googleapis";
import type { AuctionData, RegularItem, TicketItem } from "./types";
import { norm, parseConfig } from "./config";
import { parseSheetTime } from "./time";
import { normalizePrivateKey } from "./private-key";
import {
  planConfigWrites,
  planItemWrites,
  planTicketWrites,
  type ConfigWrite,
  type ItemWrite,
  type Row as WriteRow,
  type TicketWrite,
} from "./sheet-write";

export const ITEMS_TAB = process.env.SHEET_ITEMS_TAB || "Items";
export const TICKETS_TAB = process.env.SHEET_TICKETS_TAB || "Tickets";
export const CONFIG_TAB = process.env.SHEET_CONFIG_TAB || "Config";

type Row = (string | number | boolean | null)[];

/** True when all env vars needed to read the sheet are present. */
export function hasSheetCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

function sheetsClient(scope: "read" | "write" = "read") {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    scopes: [
      scope === "write"
        ? "https://www.googleapis.com/auth/spreadsheets"
        : "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
  return google.sheets({ version: "v4", auth });
}

async function readTab(
  client: ReturnType<typeof sheetsClient>,
  spreadsheetId: string,
  tab: string,
): Promise<Row[]> {
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: tab,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    return (res.data.values as Row[]) ?? [];
  } catch {
    // A missing optional tab (e.g. no Tickets) shouldn't sink everything.
    return [];
  }
}

/** Map normalized header name -> column index (first occurrence wins). */
function headerIndex(rows: Row[]): Map<string, number> {
  const map = new Map<string, number>();
  const header = rows[0] ?? [];
  header.forEach((h, i) => {
    const key = norm(String(h ?? ""));
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function pick(row: Row, hi: Map<string, number>, keys: string[]): string | undefined {
  for (const key of keys) {
    const i = hi.get(norm(key));
    if (i !== undefined) {
      const v = row[i];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
  }
  return undefined;
}

function money(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: string | undefined): boolean {
  if (!v) return false;
  return ["true", "yes", "y", "1", "x", "✓"].includes(v.trim().toLowerCase());
}

function parseConfigRows(rows: Row[]): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const row of rows) {
    const key = row?.[0];
    if (key === undefined || key === null || String(key).trim() === "") continue;
    if (norm(String(key)) === "key") continue; // skip a header row
    raw[String(key).trim()] = row[1] === undefined || row[1] === null ? "" : String(row[1]).trim();
  }
  return raw;
}

function parseItems(rows: Row[], eventDateISO: string | undefined, tz: string): RegularItem[] {
  if (rows.length < 2) return [];
  const hi = headerIndex(rows);
  const farFuture = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const items: RegularItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = pick(row, hi, ["id", "itemid", "itemnumber", "itemno", "number", "no", "lot", "item"]);
    const name = pick(row, hi, ["name", "itemname", "title"]);
    if (!id && !name) continue; // blank row

    const resolvedId = id ?? name!;
    items.push({
      id: resolvedId,
      name: name ?? resolvedId,
      description: pick(row, hi, ["description", "desc", "details"]),
      imageUrl: pick(row, hi, ["imageurl", "image", "photo", "picture", "img"]),
      startingBid: money(pick(row, hi, ["startingbid", "startbid", "openingbid", "minimum", "minbid"])),
      currentBid: money(pick(row, hi, ["currentbid", "currenthighbid", "highbid", "bid", "amount"])),
      highBidder: pick(row, hi, ["highbidder", "bidder", "biddername", "winner", "paddle"]),
      baseCloseISO:
        parseSheetTime(
          pick(row, hi, ["closetime", "close", "closes", "closingtime", "endtime", "end", "baseclose"]),
          eventDateISO,
          tz,
        ) ?? farFuture,
      lastBidISO: parseSheetTime(
        pick(row, hi, ["lastbidtime", "lastbid", "bidtime", "timestamp", "updated", "time"]),
        eventDateISO,
        tz,
      ),
      featured: bool(pick(row, hi, ["featured", "feature", "hero"])),
    });
  }
  return items;
}

function parseTickets(rows: Row[], eventDateISO: string | undefined, tz: string): TicketItem[] {
  if (rows.length < 2) return [];
  const hi = headerIndex(rows);
  const tickets: TicketItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const label = pick(row, hi, ["label", "ticket", "ticketnumber", "ticketno", "number", "no", "seat", "name"]);
    const bid = money(pick(row, hi, ["currentbid", "currenthighbid", "highbid", "bid", "amount", "price"]));
    if (!label && bid === undefined) continue; // blank row

    tickets.push({
      group: pick(row, hi, ["group", "ticketgroup", "category", "type"]) ?? "Tickets",
      label: label ?? String(r),
      imageUrl: pick(row, hi, ["imageurl", "image", "photo", "picture", "img"]),
      currentBid: bid,
      highBidder: pick(row, hi, ["highbidder", "bidder", "biddername", "winner", "paddle"]),
      lastBidISO: parseSheetTime(
        pick(row, hi, ["lastbidtime", "lastbid", "bidtime", "timestamp", "updated", "time"]),
        eventDateISO,
        tz,
      ),
      cascadeStartISO: parseSheetTime(
        pick(row, hi, ["cascadestart", "groupstart", "starttime", "groupclosestart", "closestart"]),
        eventDateISO,
        tz,
      ),
    });
  }
  return tickets;
}

/** Fetch and parse the whole auction from the configured Google Sheet. */
export async function getAuctionDataFromSheet(): Promise<AuctionData> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const client = sheetsClient();

  const [itemRows, ticketRows, configRows] = await Promise.all([
    readTab(client, spreadsheetId, ITEMS_TAB),
    readTab(client, spreadsheetId, TICKETS_TAB),
    readTab(client, spreadsheetId, CONFIG_TAB),
  ]);

  const config = parseConfig(parseConfigRows(configRows));
  const items = parseItems(itemRows, config.eventDateISO, config.timezone);
  const tickets = parseTickets(ticketRows, config.eventDateISO, config.timezone);

  return { config, items, tickets };
}

export interface SheetDiagnostics {
  hasCredentials: boolean;
  ok: boolean;
  error?: string;
  sheetIdMasked?: string;
  serviceAccountEmail?: string;
  spreadsheetTitle?: string;
  /** Actual tab names found in the spreadsheet. */
  tabsFound?: string[];
  /** Tab names the app looks for. */
  tabsExpected: { items: string; tickets: string; config: string };
  counts?: {
    itemRows: number;
    ticketRows: number;
    configRows: number;
    parsedItems: number;
    parsedTickets: number;
  };
  hint?: string;
}

/**
 * Self-diagnosis for the Google Sheet connection. Surfaced at /api/diag so the
 * deployed app can report exactly why data isn't loading without anyone needing
 * to read the sheet directly.
 */
export async function getDiagnostics(): Promise<SheetDiagnostics> {
  const tabsExpected = { items: ITEMS_TAB, tickets: TICKETS_TAB, config: CONFIG_TAB };

  if (!hasSheetCredentials()) {
    const missing = [
      !process.env.GOOGLE_SHEET_ID && "GOOGLE_SHEET_ID",
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !process.env.GOOGLE_PRIVATE_KEY && "GOOGLE_PRIVATE_KEY",
    ].filter(Boolean);
    return {
      hasCredentials: false,
      ok: false,
      tabsExpected,
      error: `Missing env var(s): ${missing.join(", ")}`,
      hint: "Set these in Vercel → Project → Settings → Environment Variables, then redeploy.",
    };
  }

  const sheetId = process.env.GOOGLE_SHEET_ID!;
  const sheetIdMasked =
    sheetId.length > 10 ? `${sheetId.slice(0, 5)}…${sheetId.slice(-4)}` : sheetId;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  try {
    const client = sheetsClient();
    const meta = await client.spreadsheets.get({ spreadsheetId: sheetId });
    const tabsFound = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter(Boolean);

    const [itemRows, ticketRows, configRows] = await Promise.all([
      readTab(client, sheetId, ITEMS_TAB),
      readTab(client, sheetId, TICKETS_TAB),
      readTab(client, sheetId, CONFIG_TAB),
    ]);
    const config = parseConfig(parseConfigRows(configRows));
    const items = parseItems(itemRows, config.eventDateISO, config.timezone);
    const tickets = parseTickets(ticketRows, config.eventDateISO, config.timezone);

    let hint: string | undefined;
    if (!tabsFound.includes(ITEMS_TAB)) {
      hint = `No tab named "${ITEMS_TAB}" was found. Your tabs are: ${tabsFound.join(", ")}. Rename your items tab to exactly "${ITEMS_TAB}".`;
    } else if (items.length === 0) {
      hint = `The "${ITEMS_TAB}" tab has no data rows the app could read. Make sure the header row is row 1 (ID, Name, …) and items start on row 2.`;
    }

    return {
      hasCredentials: true,
      ok: true,
      sheetIdMasked,
      serviceAccountEmail,
      spreadsheetTitle: meta.data.properties?.title ?? undefined,
      tabsFound,
      tabsExpected,
      counts: {
        itemRows: itemRows.length,
        ticketRows: ticketRows.length,
        configRows: configRows.length,
        parsedItems: items.length,
        parsedTickets: tickets.length,
      },
      hint,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let hint: string | undefined;
    if (/not found|Requested entity/i.test(message)) {
      hint = "The GOOGLE_SHEET_ID looks wrong — no spreadsheet with that ID. Copy the part between /d/ and /edit in the sheet URL.";
    } else if (/permission|forbidden|403/i.test(message)) {
      hint = `The sheet isn't shared with the service account. Share it (Viewer) with ${serviceAccountEmail}.`;
    } else if (/invalid_grant|DECODER|PEM|private key|invalid.*key/i.test(message)) {
      hint =
        "GOOGLE_PRIVATE_KEY is malformed. In the Vercel field, paste ONLY the private_key value from the JSON (the -----BEGIN…END----- block with its \\n sequences) — no surrounding quotes. Then redeploy.";
    }
    return {
      hasCredentials: true,
      ok: false,
      sheetIdMasked,
      serviceAccountEmail,
      tabsExpected,
      error: message,
      hint,
    };
  }
}

export interface AuctionWritePayload {
  items: ItemWrite[];
  tickets: TicketWrite[];
  config: ConfigWrite;
}

export interface AuctionWriteResult {
  ok: boolean;
  /** Total cells written. */
  updatedCells: number;
  itemUpdates: number;
  ticketUpdates: number;
  settingUpdates: number;
  /** Payload rows that didn't match anything in the sheet. */
  unmatched: string[];
  /** Managed fields/keys with no column or row to write to. */
  skipped: string[];
}

/**
 * Write the admin's bid / time / settings edits back to the Google Sheet.
 * Reads the current tabs, plans the minimal set of cell changes (pure, in
 * sheet-write.ts), then applies them with one batchUpdate. RAW input keeps our
 * formatted time strings from being re-coerced by Sheets, so they round-trip.
 */
export async function applyAuctionWrites(
  payload: AuctionWritePayload,
): Promise<AuctionWriteResult> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const client = sheetsClient("write");

  const [itemRows, ticketRows, configRows] = await Promise.all([
    readTab(client, spreadsheetId, ITEMS_TAB),
    readTab(client, spreadsheetId, TICKETS_TAB),
    readTab(client, spreadsheetId, CONFIG_TAB),
  ]);

  // Config drives timezone / event date used to format and compare times.
  const config = parseConfig(parseConfigRows(configRows));

  const itemPlan = planItemWrites(
    itemRows as WriteRow[],
    payload.items,
    ITEMS_TAB,
    config.eventDateISO,
    config.timezone,
  );
  const ticketPlan = planTicketWrites(
    ticketRows as WriteRow[],
    payload.tickets,
    TICKETS_TAB,
    config.eventDateISO,
    config.timezone,
  );
  const configPlan = planConfigWrites(configRows as WriteRow[], payload.config, CONFIG_TAB);

  const updates = [...itemPlan.updates, ...ticketPlan.updates, ...configPlan.updates];

  if (updates.length > 0) {
    await client.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map((u) => ({ range: u.range, values: u.values })),
      },
    });
  }

  return {
    ok: true,
    updatedCells: updates.length,
    itemUpdates: itemPlan.updates.length,
    ticketUpdates: ticketPlan.updates.length,
    settingUpdates: configPlan.updates.length,
    unmatched: [...itemPlan.unmatched, ...ticketPlan.unmatched],
    skipped: [...itemPlan.skipped, ...ticketPlan.skipped, ...configPlan.skipped],
  };
}
