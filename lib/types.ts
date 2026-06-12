// Shared data types for the silent auction dashboard.
//
// There are two "layers" of types:
//   * Input types  — the raw shape parsed out of the Google Sheet.
//   * Computed types — what the auction engine produces for the UI, with
//     effective close times and open/closing/closed status resolved.

/** Visual / logical status of a regular auction item. */
export type ItemStatus = "open" | "closing" | "closed";

/** Status of a single ticket within a ticket group's closing cascade.
 *  "outbid" = ranked below the available seats, so it has lost its seat (for now). */
export type TicketStatus = "pending" | "active" | "closed" | "outbid";

/** Raw auction configuration (from the sheet's Config tab or demo data). */
export interface AuctionConfig {
  eventName: string;
  /** IANA timezone, e.g. "America/Chicago". Used to interpret clock times. */
  timezone: string;
  /** The event date (ISO date "YYYY-MM-DD") used to anchor clock-only times. */
  eventDateISO?: string;
  /** Anti-snipe window in seconds. A bid pushes close to bidTime + this. */
  extensionWindowSeconds: number;
  /** When the first (highest) ticket in a group is scheduled to close. ISO. */
  ticketCascadeStartISO?: string;
  /** Fixed countdown length (seconds) each subsequent ticket runs once active. */
  ticketCountdownSeconds: number;
  /** Optional manual override: id of the item to feature in the hero slot. */
  featuredItemId?: string;
  /** Seconds-left threshold under which an open item is flagged "closing". */
  urgentThresholdSeconds: number;
}

/** A regular (single, dynamically bid-up) auction item, as read from the sheet. */
export interface RegularItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  startingBid?: number;
  currentBid?: number;
  highBidder?: string;
  /** Scheduled close time before any anti-snipe extension. ISO. */
  baseCloseISO: string;
  /** Timestamp of the most recent bid, if any. ISO. */
  lastBidISO?: string;
  /** Manual feature flag from the sheet. */
  featured?: boolean;
}

/** A single ticket within a group of identical tickets, as read from the sheet. */
export interface TicketItem {
  /** Group name, e.g. "Concert Tickets". Tickets cascade within a group. */
  group: string;
  /** Human label, e.g. "10 of 12" or "1". Unique within a group. */
  label: string;
  imageUrl?: string;
  currentBid?: number;
  highBidder?: string;
  lastBidISO?: string;
  /** Optional per-group cascade start (when the highest ticket closes). ISO.
   *  Set on any one row of the group; falls back to the global config value. */
  cascadeStartISO?: string;
  /** Number of seats available in this group (e.g. 12). Set on any one row of
   *  the group. The top `seats` bids hold a seat and close in the cascade; any
   *  lower bids are "outbid". If unset, every bid wins a seat (no one is outbid). */
  seats?: number;
}

/** Everything parsed out of the sheet (or demo source) before computation. */
export interface AuctionData {
  config: AuctionConfig;
  items: RegularItem[];
  tickets: TicketItem[];
}

// ---------------------------------------------------------------------------
// Computed (UI-facing) types
// ---------------------------------------------------------------------------

export interface ComputedItem extends RegularItem {
  status: ItemStatus;
  /** Close time after anti-snipe extension. ISO. */
  effectiveCloseISO: string;
  /** Whole seconds remaining at compute time (0 if closed). */
  secondsLeft: number;
}

export interface ComputedTicket extends TicketItem {
  /** Stable id = `${group}::${label}`. */
  id: string;
  /** 0 = closes first (highest bid) within its group. */
  rank: number;
  status: TicketStatus;
  /** Projected/effective close time after extensions. ISO. */
  effectiveCloseISO: string;
  /** Whole seconds remaining at compute time (0 if closed). */
  secondsLeft: number;
}

export interface TicketGroupState {
  group: string;
  imageUrl?: string;
  /** Tickets in cascade (close) order: winners first (by rank), then outbid. */
  tickets: ComputedTicket[];
  /** Seats available in this group. */
  seats: number;
  /** id of the currently-counting-down ticket, if any. */
  activeTicketId?: string;
  /** Count still in the running for a seat (active + pending). */
  openCount: number;
  /** Count of bids ranked below the seats (currently losing their seat). */
  outbidCount: number;
}

/** The full state the API returns and the dashboard renders. */
export interface AuctionState {
  config: AuctionConfig;
  /** Server clock at compute time. ISO. Clients sync countdowns to this. */
  serverNowISO: string;
  items: ComputedItem[];
  /** Resolved hero item id (override, flag, or soonest-closing). */
  featuredItemId?: string;
  ticketGroups: TicketGroupState[];
  /** Where the data came from. */
  source: "sheet" | "demo";
  /** Non-fatal message (e.g. sheet read failed, fell back to demo). */
  warning?: string;
}
