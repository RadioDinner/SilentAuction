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
  // If no cascade start is configured, give the first ticket a full countdown
  // from "now" rather than closing instantly.
  const cascadeStartMs =
    toMs(config.ticketCascadeStartISO) ?? nowMs + countdownMs;

  const sorted = [...groupTickets].sort(compareTickets);

  // Forward-simulate the close time of each ticket in close order.
  const closeMs: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const baseMs = i === 0 ? cascadeStartMs : closeMs[i - 1] + countdownMs;
    const lastBidMs = toMs(sorted[i].lastBidISO);
    closeMs[i] = effectiveCloseMs(baseMs, lastBidMs, windowMs);
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
