// Server-only, in-memory "a bid just happened" detector.
//
// Bids are entered by editing "Current Bid" in the sheet. We do NOT write
// anything back to the sheet, so if "Last Bid Time" isn't filled in the engine
// has no timestamp to drive the anti-snipe extension. This remembers the last
// bid we saw for each row IN MEMORY and, when a bid increases, reports the
// moment we first saw the new amount — so the active "Now Closing" card can
// extend to a full minute from that bid with nothing written to the sheet.
//
// Caveat: this memory is per server instance and not durable. On a fresh start
// the first time we see each row is taken as a BASELINE (no extension); only
// later increases extend. A redeploy / cold start resets the baseline. That's
// fine for a single-day event served from one dashboard endpoint, and it never
// writes to the sheet.

export interface BidObservation {
  bid: number;
  /** Epoch ms when this (higher) bid was first observed; 0 = baseline only. */
  atMs: number;
}

const store = new Map<string, BidObservation>();

/**
 * Note the current bid for `id` and return the epoch ms to treat as its "last
 * bid" — i.e. when a higher bid has been observed since this instance started —
 * or null to leave the timestamp to whatever the sheet provided.
 *
 * The returned time is sticky: once a higher bid is seen it keeps reporting that
 * moment on later (unchanged) polls, so the extended close stays put and counts
 * down until the next increase.
 */
export function observeBid(
  id: string,
  bid: number | undefined,
  nowMs: number,
): number | null {
  const cur = bid ?? 0;
  const prev = store.get(id);

  if (!prev) {
    // First time we've seen this row this run: baseline only, never extend.
    store.set(id, { bid: cur, atMs: 0 });
    return null;
  }
  if (cur > prev.bid) {
    // A fresh, higher bid — treat "now" as the bid time.
    store.set(id, { bid: cur, atMs: nowMs });
    return nowMs;
  }
  if (cur !== prev.bid) {
    // Corrected down (or cleared): track the new amount, don't extend.
    store.set(id, { bid: cur, atMs: prev.atMs });
  }
  return prev.atMs > 0 ? prev.atMs : null;
}

/** Test helper — clears all remembered bids. */
export function resetBidMemory(): void {
  store.clear();
}
