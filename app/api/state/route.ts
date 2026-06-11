import type { NextRequest } from "next/server";
import { computeState } from "@/lib/auction";
import { buildDemoData } from "@/lib/demo";
import { getAuctionDataFromSheet, hasSheetCredentials } from "@/lib/sheets";
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
    state = computeState(buildDemoData(now), now, "demo", warning);
  } else {
    try {
      const data = await getAuctionDataFromSheet();
      state = computeState(data, now, "sheet");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state = computeState(
        buildDemoData(now),
        now,
        "demo",
        `Sheet read failed: ${message}. Showing demo data.`,
      );
    }
  }

  return new Response(JSON.stringify(state), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
