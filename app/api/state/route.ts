import type { NextRequest } from "next/server";
import { cascadeItemCloses, computeState, normalizeConfig, planItemCascadeWriteback } from "@/lib/auction";
import { buildDemoData } from "@/lib/demo";
import { applyAuctionWrites, getAuctionDataFromSheet, hasSheetCredentials } from "@/lib/sheets";
import type { AuctionState } from "@/lib/types";

// Always computed fresh per request; never cached at the edge.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
      const data = await getAuctionDataFromSheet();
      let warn: string | undefined;
      if (data.items.length === 0 && data.tickets.length === 0) {
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
