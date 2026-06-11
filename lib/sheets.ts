// Reads the Google Sheet (Items / Tickets / Config tabs) into AuctionData.
// Read-only, via a service account. Header names are matched forgivingly so
// staff don't have to nail an exact schema.

import { google } from "googleapis";
import type { AuctionData, RegularItem, TicketItem } from "./types";
import { norm, parseConfig } from "./config";
import { parseSheetTime } from "./time";

const ITEMS_TAB = process.env.SHEET_ITEMS_TAB || "Items";
const TICKETS_TAB = process.env.SHEET_TICKETS_TAB || "Tickets";
const CONFIG_TAB = process.env.SHEET_CONFIG_TAB || "Config";

type Row = (string | number | boolean | null)[];

/** True when all env vars needed to read the sheet are present. */
export function hasSheetCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
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
