import type { NextRequest } from "next/server";
import { applyAuctionWrites, hasSheetCredentials } from "@/lib/sheets";

// Writes admin edits back to the Google Sheet. Never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store, max-age=0" },
  });
}

/** Length-independent string compare to avoid leaking the token via timing. */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return json(503, {
      ok: false,
      error:
        "Live editing is disabled. Set ADMIN_TOKEN in your environment (and redeploy) to enable Save to Sheet.",
    });
  }

  const provided = req.headers.get("x-admin-token") ?? "";
  if (!tokenMatches(provided, token)) {
    return json(401, { ok: false, error: "Invalid admin token." });
  }

  if (process.env.AUCTION_DEMO === "1" || !hasSheetCredentials()) {
    return json(400, {
      ok: false,
      error: "No Google Sheet is configured to write to (the app is running in demo mode).",
    });
  }

  let payload: { items?: unknown; tickets?: unknown; config?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Request body was not valid JSON." });
  }

  try {
    const result = await applyAuctionWrites({
      items: Array.isArray(payload?.items) ? (payload.items as never[]) : [],
      tickets: Array.isArray(payload?.tickets) ? (payload.tickets as never[]) : [],
      config:
        payload?.config && typeof payload.config === "object"
          ? (payload.config as never)
          : {},
    });
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let hint: string | undefined;
    if (/permission|forbidden|403/i.test(message)) {
      hint =
        "The service account needs EDITOR access to write. Re-share the sheet with it as Editor (not just Viewer).";
    } else if (/invalid_grant|DECODER|PEM|private key|invalid.*key/i.test(message)) {
      hint = "GOOGLE_PRIVATE_KEY looks malformed — see /api/diag.";
    } else if (/not found|Requested entity/i.test(message)) {
      hint = "GOOGLE_SHEET_ID doesn't match a spreadsheet.";
    }
    return json(500, { ok: false, error: message, hint });
  }
}
