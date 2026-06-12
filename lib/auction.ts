// ---------------------------------------------------------------------------
// Auction engine — pure, deterministic logic.
//
// Everything here is a pure function of (parsed sheet data + current time).
// No IO, no framework. That keeps the tricky rules (anti-snipe extensions and
// the ticket-closing cascade) unit-testable and re-derivable on every poll
// with no stored state.
//
// All times flow through here as epoch milliseconds. The sheet/config parsing
// layer is responsible for turning clock times + timezone into ISO strings;
// this module just reads those ISO strings into numbers.
// ---------------------------------------------------------------------------

import type {
  AuctionConfig,
  AuctionData,
  AuctionState,
  ComputedItem,
  ComputedTicket,
  ItemStatus,
  RegularItem,
  TicketGroupState,
  TicketItem,
} from "./types";

/** Parse an ISO string to epoch ms, or null if missing/invalid. */
export function toMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Whole seconds remaining until `targetMs` (0 once reached/passed). */
export function secondsLeft(targetMs: number, nowMs: number): number {
  if (nowMs >= targetMs) return 0;
  return Math.ceil((targetMs - nowMs) / 1000);
}

/**
 * Anti-snipe close time. A bid pushes the close out to (bidTime + window),
 * but never *earlier* than the originally scheduled close. With no bid, the
 * scheduled close stands.
 *
 *   base 5:30, no bid                 -> 5:30
 *   base 5:30, bid 5:24, window 60s   -> 5:30   (bid well before close)
 *   base 5:30, bid 5:30, window 60s   -> 5:31   (bid at the wire -> +1 min)
 */
export function effectiveCloseMs(
  baseMs: number,
  lastBidMs: number | null,
  windowMs: number,
): number {
  if (lastBidMs == null) return baseMs;
  return Math.max(baseMs, lastBidMs + windowMs);
}

/** Sensible fallbacks so a sparse config never produces NaN math. */
export function normalizeConfig(config: AuctionConfig): AuctionConfig {
  return {
    ...config,
    extensionWindowSeconds:
      config.extensionWindowSeconds > 0 ? config.extensionWindowSeconds : 60,
    ticketCountdownSeconds:
      config.ticketCountdownSeconds > 0 ? config.ticketCountdownSeconds : 180,
    urgentThresholdSeconds:
      config.urgentThresholdSeconds > 0 ? config.urgentThresholdSeconds : 120,
  };
}

// ---------------------------------------------------------------------------
// Regular items
// ---------------------------------------------------------------------------

export function computeItem(
  item: RegularItem,
  config: AuctionConfig,
  nowMs: number,
): ComputedItem {
  const windowMs = config.extensionWindowSeconds * 1000;
  const baseMs = toMs(item.baseCloseISO) ?? nowMs;
  const lastBidMs = toMs(item.lastBidISO);
  const effMs = effectiveCloseMs(baseMs, lastBidMs, windowMs);
  const left = secondsLeft(effMs, nowMs);

  let status: ItemStatus;
  if (nowMs >= effMs) status = "closed";
  else if (left <= config.urgentThresholdSeconds) status = "closing";
  else status = "open";

  return {
    ...item,
    status,
    effectiveCloseISO: new Date(effMs).toISOString(),
    secondsLeft: left,
  };
}

// ---------------------------------------------------------------------------
// Item closing cascade (anti-snipe persistence + stagger)
//
// Regular items each have their own scheduled close. Two coupled rules keep a
// late-bidding flurry from bunching every item onto the same instant:
//
//   1. ANTI-SNIPE: a bid near an item's close pushes that item out to
//      (lastBid + window) — same rule computeItem already shows live.
//   2. STAGGER: when such a bid actually EXTENDS an item, every item that
//      closes LATER than it is pushed out by one window too (+1 min default).
//
// Both are expressed as ABSOLUTE new close times (seconds), computed purely
// from the current sheet state, so:
//   * the result is idempotent — once written back, no item is still "fresh",
//     so re-running yields no further change; and
//   * concurrent writers converge — they compute the same absolute value rather
//     than each adding a delta.
//
// The stagger only accumulates "per bid" when the new closes are PERSISTED back
// to the sheet (the live route does this): writing clears an item's freshness,
// so the next bid is counted afresh. Without persistence it still renders a
// stable stagger; it just won't compound across repeat bids on the same item.
// ---------------------------------------------------------------------------

/** A persisted close-time change for one item. */
export interface ItemCloseChange {
  id: string;
  newCloseISO: string;
}

/** Only items closing within this horizon take part — keeps the synthetic
 *  "far future" close of an item with no time set out of the cascade (and out
 *  of the write-back, which would otherwise churn on its moving value). */
const CASCADE_HORIZON_MS = 12 * 3600 * 1000;

/**
 * Core: the cascaded close time (epoch SECONDS) for each item, or null for
 * items with no real near-term close (left untouched). Pure.
 */
function cascadedCloseSeconds(
  items: RegularItem[],
  config: AuctionConfig,
  nowMs: number,
): (number | null)[] {
  const windowSec = Math.max(1, Math.round(config.extensionWindowSeconds || 60));

  const baseSec = items.map((it) => {
    const ms = toMs(it.baseCloseISO);
    if (ms == null || ms > nowMs + CASCADE_HORIZON_MS) return null;
    return Math.floor(ms / 1000);
  });
  const bidSec = items.map((it) => {
    const ms = toMs(it.lastBidISO);
    return ms == null ? null : Math.floor(ms / 1000);
  });
  // "Fresh" = a bid that pushes this item's close past where it stands now.
  const fresh = items.map(
    (_, i) => baseSec[i] != null && bidSec[i] != null && bidSec[i]! + windowSec > baseSec[i]!,
  );

  return items.map((_, i) => {
    const b = baseSec[i];
    if (b == null) return null;
    const antiSnipe = fresh[i] ? bidSec[i]! + windowSec : b;
    let bumps = 0;
    for (let x = 0; x < items.length; x++) {
      if (x !== i && fresh[x] && baseSec[x] != null && baseSec[x]! < b) bumps++;
    }
    return antiSnipe + bumps * windowSec;
  });
}

/** Items with their `baseCloseISO` advanced to the cascaded close (for display). */
export function cascadeItemCloses(
  items: RegularItem[],
  config: AuctionConfig,
  nowMs: number,
): RegularItem[] {
  const sec = cascadedCloseSeconds(items, config, nowMs);
  return items.map((it, i) =>
    sec[i] == null ? it : { ...it, baseCloseISO: new Date(sec[i]! * 1000).toISOString() },
  );
}

/** The minimal set of close-time changes to write back to the sheet. */
export function planItemCascadeWriteback(
  items: RegularItem[],
  config: AuctionConfig,
  nowMs: number,
): ItemCloseChange[] {
  const sec = cascadedCloseSeconds(items, config, nowMs);
  const changes: ItemCloseChange[] = [];
  for (let i = 0; i < items.length; i++) {
    const next = sec[i];
    if (next == null) continue;
    const ms = toMs(items[i].baseCloseISO);
    const orig = ms == null ? null : Math.floor(ms / 1000);
    if (orig != null && next !== orig) {
      changes.push({ id: items[i].id, newCloseISO: new Date(next * 1000).toISOString() });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Ticket cascade
//
// Within a group, tickets close one at a time, highest bid first. Only the
// first still-open ticket is "active" (counting down); the rest are "pending"
// (up next). The first ticket's close is the configured cascade start; each
// subsequent ticket closes `ticketCountdownSeconds` after the previous one.
//
// Because every later close is derived from the previous close, pushing the
// active ticket's close out by anti-snipe automatically pushes ALL remaining
// tickets out by the same amount — which is exactly the "a bid extends all
// remaining tickets by 1 minute" rule the event needs.
// ---------------------------------------------------------------------------

/** Sort comparator: highest bid first, then earliest bid, then natural label. */
function compareTickets(a: TicketItem, b: TicketItem): number {
  const bidDiff = (b.currentBid ?? 0) - (a.currentBid ?? 0);
  if (bidDiff !== 0) return bidDiff;
  const aBid = toMs(a.lastBidISO) ?? Number.POSITIVE_INFINITY;
  const bBid = toMs(b.lastBidISO) ?? Number.POSITIVE_INFINITY;
  if (aBid !== bBid) return aBid - bBid;
  return a.label.localeCompare(b.label, undefined, { numeric: true });
}

/** Sort comparator for explicit per-ticket close times: soonest first; tickets
 *  without a time trail the rest, ordered by natural label. */
function compareTicketTimes(a: TicketItem, b: TicketItem): number {
  const am = toMs(a.cascadeStartISO);
  const bm = toMs(b.cascadeStartISO);
  if (am != null && bm != null && am !== bm) return am - bm;
  if (am != null && bm == null) return -1;
  if (am == null && bm != null) return 1;
  return a.label.localeCompare(b.label, undefined, { numeric: true });
}

/** Count of DISTINCT cascade-start times across a group. When 2+ tickets carry
 *  different times, the sheet is giving each ticket its own close time (rather
 *  than one shared start for the whole group). */
function distinctStartCount(tickets: TicketItem[]): number {
  const set = new Set<number>();
  for (const t of tickets) {
    const ms = toMs(t.cascadeStartISO);
    if (ms != null) set.add(ms);
  }
  return set.size;
}

export function ticketId(t: Pick<TicketItem, "group" | "label">): string {
  return `${t.group}::${t.label}`;
}

export function computeTicketGroup(
  group: string,
  groupTickets: TicketItem[],
  config: AuctionConfig,
  nowMs: number,
): TicketGroupState {
  const windowMs = config.extensionWindowSeconds * 1000;
  const countdownMs = config.ticketCountdownSeconds * 1000;

  let sorted: TicketItem[];
  const closeMs: number[] = [];

  if (distinctStartCount(groupTickets) >= 2) {
    // PER-TICKET MODE: the sheet gives each ticket its own close time. Honor it
    // exactly (with anti-snipe per ticket); order by that time. Any ticket
    // missing a time trails the previous one by one countdown.
    sorted = [...groupTickets].sort(compareTicketTimes);
    for (let i = 0; i < sorted.length; i++) {
      const own = toMs(sorted[i].cascadeStartISO);
      const baseMs = own ?? (i === 0 ? nowMs + countdownMs : closeMs[i - 1] + countdownMs);
      closeMs[i] = effectiveCloseMs(baseMs, toMs(sorted[i].lastBidISO), windowMs);
    }
  } else {
    // CASCADE MODE: one start time for the whole group (set on any row, else the
    // global config value), highest bid closes first, each subsequent ticket
    // closes `countdown` after the previous — so a late bid on the active ticket
    // pushes all remaining tickets out together. If no start is set, give the
    // first ticket a full countdown from "now" rather than closing instantly.
    const groupStartISO =
      groupTickets.find((t) => t.cascadeStartISO)?.cascadeStartISO ??
      config.ticketCascadeStartISO;
    const cascadeStartMs = toMs(groupStartISO) ?? nowMs + countdownMs;

    sorted = [...groupTickets].sort(compareTickets);
    for (let i = 0; i < sorted.length; i++) {
      const baseMs = i === 0 ? cascadeStartMs : closeMs[i - 1] + countdownMs;
      closeMs[i] = effectiveCloseMs(baseMs, toMs(sorted[i].lastBidISO), windowMs);
    }
  }

  // The active ticket is the first one not yet closed.
  let activeIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (nowMs < closeMs[i]) {
      activeIndex = i;
      break;
    }
  }

  const tickets: ComputedTicket[] = sorted.map((t, i) => {
    let status: ComputedTicket["status"];
    if (nowMs >= closeMs[i]) status = "closed";
    else if (i === activeIndex) status = "active";
    else status = "pending";

    return {
      ...t,
      id: ticketId(t),
      rank: i,
      status,
      effectiveCloseISO: new Date(closeMs[i]).toISOString(),
      secondsLeft: secondsLeft(closeMs[i], nowMs),
    };
  });

  return {
    group,
    imageUrl: tickets.find((t) => t.imageUrl)?.imageUrl,
    tickets,
    activeTicketId: activeIndex >= 0 ? tickets[activeIndex].id : undefined,
    openCount: tickets.filter((t) => t.status !== "closed").length,
  };
}

/** Group raw tickets by their `group` field, preserving first-seen order. */
export function groupTickets(tickets: TicketItem[]): Map<string, TicketItem[]> {
  const map = new Map<string, TicketItem[]>();
  for (const t of tickets) {
    const list = map.get(t.group);
    if (list) list.push(t);
    else map.set(t.group, [t]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Featured (hero) item resolution
// ---------------------------------------------------------------------------

/**
 * Pick the item to show in the big hero slot:
 *   1. explicit config override (if it points at a real item)
 *   2. an item flagged `featured` in the sheet
 *   3. the soonest-closing still-open item (most urgent)
 *   4. otherwise the last item to have closed (the finale)
 */
export function resolveFeaturedId(
  items: ComputedItem[],
  config: AuctionConfig,
): string | undefined {
  if (items.length === 0) return undefined;

  if (config.featuredItemId) {
    const match = items.find((i) => i.id === config.featuredItemId);
    if (match) return match.id;
  }

  const flagged = items.find((i) => i.featured);
  if (flagged) return flagged.id;

  const open = items.filter((i) => i.status !== "closed");
  if (open.length > 0) {
    return open.reduce((soonest, i) =>
      toMs(i.effectiveCloseISO)! < toMs(soonest.effectiveCloseISO)! ? i : soonest,
    ).id;
  }

  // All closed: show the grand finale (last item to have closed).
  return items.reduce((latest, i) =>
    toMs(i.effectiveCloseISO)! > toMs(latest.effectiveCloseISO)! ? i : latest,
  ).id;
}

// ---------------------------------------------------------------------------
// Top-level state assembly
// ---------------------------------------------------------------------------

export function computeState(
  data: AuctionData,
  nowMs: number,
  source: "sheet" | "demo",
  warning?: string,
): AuctionState {
  const config = normalizeConfig(data.config);

  const items = data.items.map((item) => computeItem(item, config, nowMs));

  const ticketGroups: TicketGroupState[] = [];
  for (const [group, list] of groupTickets(data.tickets)) {
    ticketGroups.push(computeTicketGroup(group, list, config, nowMs));
  }

  return {
    config,
    serverNowISO: new Date(nowMs).toISOString(),
    items,
    featuredItemId: resolveFeaturedId(items, config),
    ticketGroups,
    source,
    warning,
  };
}
