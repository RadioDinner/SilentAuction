import type { NextRequest } from "next/server";
import { cascadeItemCloses, computeState, normalizeConfig, planItemCascadeWriteback } from "@/lib/auction";
import { buildDemoData } from "@/lib/demo";
import { applyAuctionWrites, getAuctionSnapshot, hasSheetCredentials } from "@/lib/sheets";
import { observeBid } from "@/lib/bid-memory";
import type { AuctionData, AuctionState } from "@/lib/types";

// Always computed fresh per request; never cached at the edge.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Later of an existing ISO time and an epoch-ms candidate, as ISO. */
function laterISO(iso: string | undefined, ms: number): string {
  const cur = iso ? Date.parse(iso) : NaN;
  return new Date(Number.isNaN(cur) ? ms : Math.max(cur, ms)).toISOString();
}

/**
 * Drive the anti-snipe extension from a bid going UP, even when the sheet's
 * "Last Bid Time" is blank — without writing anything back to the sheet. The
 * server remembers each row's last bid in memory; when it increases we stamp
 * "now" as the bid time so the active card extends to a full minute.
 */
function applyObservedBids(data: AuctionData, nowMs: number): void {
  for (const it of data.items) {
    const at = observeBid(`item:${it.id}`, it.currentBid, nowMs);
    if (at != null) it.lastBidISO = laterISO(it.lastBidISO, at);
  }
  for (const t of data.tickets) {
    const at = observeBid(`ticket:${t.group}::${t.label}`, t.currentBid, nowMs);
    if (at != null) t.lastBidISO = laterISO(t.lastBidISO, at);
  }
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const forceDemo =
    process.env.AUCTION_DEMO === "1" ||
    req.nextUrl.searchParams.get("demo") === "1";

  let state: AuctionState;

  if (forceDemo || !hasSheetCredentials()) {
    const warning =
      !forceDemo && !hasSheetCredentials()
        ? "No Google Sheet configured — showing demo data. Set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY."
        : undefined;
    const data = buildDemoData(now);
    const cfg = normalizeConfig(data.config);
    data.items = cascadeItemCloses(data.items, cfg, now);
    state = computeState(data, now, "demo", warning);
  } else {
    try {
      // Cached + coalesced: all viewers share one Sheets API call per few
      // seconds (Google's read quota is 60/min); a failed refresh serves the
      // last good snapshot with staleError set instead of throwing.
      const { data, fetchedAtMs, staleError } = await getAuctionSnapshot(now);
      let warn: string | undefined;
      if (staleError) {
        // A brief blip (e.g. a quota hiccup) self-heals — only warn once the
        // data we're showing is genuinely old.
        const ageSec = Math.round((now - fetchedAtMs) / 1000);
        if (ageSec > 60) {
          warn = `Live sheet reads are failing (${staleError}) — showing data from ${ageSec}s ago.`;
        }
      } else if (data.items.length === 0 && data.tickets.length === 0) {
        warn =
          "Connected to the sheet but found no items or tickets. Check that tabs are named exactly Items / Tickets / Config with headers in row 1. Visit /api/diag for details.";
      } else if (data.items.length === 0) {
        warn =
          "Connected to the sheet but the Items tab returned no rows. Confirm the tab is named exactly 'Items' with a header row. Visit /api/diag for details.";
      } else if (data.tickets.length === 0) {
        warn =
          "Connected to the sheet but the Tickets tab returned no rows. Confirm the tab is named exactly 'Tickets'. Visit /api/diag for details.";
      }

      const cfg = normalizeConfig(data.config);

      // A bid that only changes Current Bid (no Last Bid Time) still triggers
      // the display-only anti-snipe extension — without writing to the sheet.
      applyObservedBids(data, now);

      // Anti-snipe + stagger: persist the new close times back to the sheet
      // (opt-in) so the cascade compounds per bid and the sheet stays the truth.
      if (process.env.AUCTION_WRITEBACK === "1") {
        const changes = planItemCascadeWriteback(data.items, cfg, now);
        if (changes.length > 0) {
          try {
            await applyAuctionWrites({
              items: changes.map((c) => ({ id: c.id, baseCloseISO: c.newCloseISO })),
              tickets: [],
              config: {},
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            warn = /permission|forbidden|403/i.test(message)
              ? "Close-time write-back failed — the service account needs Editor access to the sheet."
              : `Close-time write-back failed: ${message}`;
          }
        }
      }

      // Show the cascaded closes immediately, whether or not the write landed.
      data.items = cascadeItemCloses(data.items, cfg, now);
      state = computeState(data, now, "sheet", warn);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const data = buildDemoData(now);
      data.items = cascadeItemCloses(data.items, normalizeConfig(data.config), now);
      state = computeState(data, now, "demo", `Sheet read failed: ${message}. Showing demo data.`);
    }
  }

  return new Response(JSON.stringify(state), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
