import { describe, it, expect } from "vitest";
import {
  effectiveCloseMs,
  computeItem,
  computeTicketGroup,
  resolveFeaturedId,
  computeState,
  secondsLeft,
  toMs,
} from "./auction";
import type { AuctionConfig, RegularItem, TicketItem } from "./types";

const ms = (iso: string) => Date.parse(iso);

const baseConfig: AuctionConfig = {
  eventName: "Test Picnic",
  timezone: "UTC",
  eventDateISO: "2026-06-11",
  extensionWindowSeconds: 60,
  ticketCascadeStartISO: "2026-06-11T18:00:00.000Z",
  ticketCountdownSeconds: 180,
  urgentThresholdSeconds: 120,
};

describe("helpers", () => {
  it("toMs parses ISO and rejects junk", () => {
    expect(toMs("2026-06-11T18:00:00.000Z")).toBe(ms("2026-06-11T18:00:00.000Z"));
    expect(toMs(undefined)).toBeNull();
    expect(toMs("not a date")).toBeNull();
  });

  it("secondsLeft floors at 0 and rounds up partial seconds", () => {
    const now = ms("2026-06-11T18:00:00.000Z");
    expect(secondsLeft(now + 1500, now)).toBe(2);
    expect(secondsLeft(now, now)).toBe(0);
    expect(secondsLeft(now - 5000, now)).toBe(0);
  });
});

describe("effectiveCloseMs (anti-snipe)", () => {
  const base = ms("2026-06-11T17:30:00.000Z");
  const window = 60_000;

  it("no bid -> scheduled close stands", () => {
    expect(effectiveCloseMs(base, null, window)).toBe(base);
  });

  it("bid well before close -> no extension", () => {
    const bid = ms("2026-06-11T17:24:00.000Z");
    expect(effectiveCloseMs(base, bid, window)).toBe(base);
  });

  it("bid at the wire -> pushes close out by the window", () => {
    const bid = ms("2026-06-11T17:30:00.000Z");
    expect(effectiveCloseMs(base, bid, window)).toBe(ms("2026-06-11T17:31:00.000Z"));
  });
});

describe("computeItem (the Item #1 scenario)", () => {
  const item: RegularItem = {
    id: "1",
    name: "Item #1",
    baseCloseISO: "2026-06-11T17:30:00.000Z",
    currentBid: 1500,
  };

  it("at 5:24 with a $1500 bid placed earlier, closes at 5:30, still open", () => {
    const now = ms("2026-06-11T17:24:00.000Z");
    const c = computeItem(
      { ...item, lastBidISO: "2026-06-11T17:20:00.000Z" },
      baseConfig,
      now,
    );
    expect(c.effectiveCloseISO).toBe("2026-06-11T17:30:00.000Z");
    // 6 minutes left -> beyond the 120s urgent threshold
    expect(c.status).toBe("open");
    expect(c.secondsLeft).toBe(360);
  });

  it("a $1600 bid at 5:30 pushes the close to 5:31", () => {
    const now = ms("2026-06-11T17:30:00.000Z");
    const c = computeItem(
      { ...item, currentBid: 1600, lastBidISO: "2026-06-11T17:30:00.000Z" },
      baseConfig,
      now,
    );
    expect(c.effectiveCloseISO).toBe("2026-06-11T17:31:00.000Z");
    expect(c.status).toBe("closing"); // 60s left, under the urgent threshold
    expect(c.secondsLeft).toBe(60);
  });

  it("after the effective close passes with no new bid, it is closed", () => {
    const now = ms("2026-06-11T17:31:30.000Z");
    const c = computeItem(
      { ...item, currentBid: 1600, lastBidISO: "2026-06-11T17:30:00.000Z" },
      baseConfig,
      now,
    );
    expect(c.status).toBe("closed");
    expect(c.secondsLeft).toBe(0);
  });
});

describe("computeTicketGroup (cascade, highest closes first)", () => {
  const tickets: TicketItem[] = [
    { group: "Tickets", label: "10 of 12", currentBid: 50 },
    { group: "Tickets", label: "1", currentBid: 40 },
    { group: "Tickets", label: "5", currentBid: 35 },
    { group: "Tickets", label: "3", currentBid: 30 },
    { group: "Tickets", label: "12", currentBid: 20 },
  ];

  it("sorts highest-bid first and only the first is active", () => {
    const now = ms("2026-06-11T17:59:00.000Z"); // just before the 18:00 start
    const g = computeTicketGroup("Tickets", tickets, baseConfig, now);

    expect(g.tickets.map((t) => t.label)).toEqual([
      "10 of 12",
      "1",
      "5",
      "3",
      "12",
    ]);
    expect(g.tickets.map((t) => t.status)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(g.activeTicketId).toBe("Tickets::10 of 12");
    expect(g.openCount).toBe(5);
  });

  it("close times are strictly increasing and spaced by the countdown", () => {
    const now = ms("2026-06-11T17:59:00.000Z");
    const g = computeTicketGroup("Tickets", tickets, baseConfig, now);
    const closes = g.tickets.map((t) => ms(t.effectiveCloseISO));
    expect(closes).toEqual([
      ms("2026-06-11T18:00:00.000Z"),
      ms("2026-06-11T18:03:00.000Z"),
      ms("2026-06-11T18:06:00.000Z"),
      ms("2026-06-11T18:09:00.000Z"),
      ms("2026-06-11T18:12:00.000Z"),
    ]);
  });

  it("a wire bid on the active ticket extends ALL remaining tickets by 1 min", () => {
    const now = ms("2026-06-11T17:59:00.000Z");
    const before = computeTicketGroup("Tickets", tickets, baseConfig, now).tickets.map(
      (t) => ms(t.effectiveCloseISO),
    );

    // Someone bids $60 on the active ($50) ticket right at its 18:00 close.
    const bumped = tickets.map((t, i) =>
      i === 0
        ? { ...t, currentBid: 60, lastBidISO: "2026-06-11T18:00:00.000Z" }
        : t,
    );
    const after = computeTicketGroup("Tickets", bumped, baseConfig, now).tickets.map(
      (t) => ms(t.effectiveCloseISO),
    );

    // Every ticket's close shifts out by exactly 60 seconds.
    after.forEach((t, i) => expect(t - before[i]).toBe(60_000));
  });

  it("after the top ticket closes, the next-highest becomes active", () => {
    // Top ticket bid to $60 at 18:00 -> its close is 18:01. Now it's 18:02.
    const bumped = tickets.map((t, i) =>
      i === 0
        ? { ...t, currentBid: 60, lastBidISO: "2026-06-11T18:00:00.000Z" }
        : t,
    );
    const now = ms("2026-06-11T18:02:00.000Z");
    const g = computeTicketGroup("Tickets", bumped, baseConfig, now);

    expect(g.tickets[0].status).toBe("closed");
    expect(g.tickets[1].status).toBe("active");
    expect(g.activeTicketId).toBe("Tickets::1");
    expect(g.openCount).toBe(4);
  });

  it("once the cascade has fully run, nothing is active", () => {
    const now = ms("2026-06-11T19:00:00.000Z");
    const g = computeTicketGroup("Tickets", tickets, baseConfig, now);
    expect(g.tickets.every((t) => t.status === "closed")).toBe(true);
    expect(g.activeTicketId).toBeUndefined();
    expect(g.openCount).toBe(0);
  });
});

describe("computeTicketGroup per-group cascade start", () => {
  const tickets: TicketItem[] = [
    { group: "Dinner", label: "1 of 2", currentBid: 50 },
    // start set on any one row of the group overrides the global config value
    { group: "Dinner", label: "2 of 2", currentBid: 30, cascadeStartISO: "2026-06-11T19:30:00.000Z" },
  ];

  it("uses the group's own start, not the global ticket_cascade_start", () => {
    const now = ms("2026-06-11T19:29:00.000Z");
    const g = computeTicketGroup("Dinner", tickets, baseConfig, now);
    // baseConfig.ticketCascadeStartISO is 18:00; this group should start 19:30
    expect(g.tickets[0].effectiveCloseISO).toBe("2026-06-11T19:30:00.000Z");
    expect(g.tickets[1].effectiveCloseISO).toBe("2026-06-11T19:33:00.000Z");
    expect(g.activeTicketId).toBe("Dinner::1 of 2");
  });

  it("treats one shared start time across all rows as a single cascade start", () => {
    // Every row carries the SAME time -> that's a group start, not per-ticket
    // times, so the cascade spacing still applies.
    const shared: TicketItem[] = [
      { group: "Lunch", label: "1 of 3", currentBid: 50, cascadeStartISO: "2026-06-11T18:30:00.000Z" },
      { group: "Lunch", label: "2 of 3", currentBid: 40, cascadeStartISO: "2026-06-11T18:30:00.000Z" },
      { group: "Lunch", label: "3 of 3", currentBid: 30, cascadeStartISO: "2026-06-11T18:30:00.000Z" },
    ];
    const now = ms("2026-06-11T18:29:00.000Z");
    const g = computeTicketGroup("Lunch", shared, baseConfig, now);
    expect(g.tickets[0].effectiveCloseISO).toBe("2026-06-11T18:30:00.000Z");
    expect(g.tickets[1].effectiveCloseISO).toBe("2026-06-11T18:33:00.000Z");
    expect(g.tickets[2].effectiveCloseISO).toBe("2026-06-11T18:36:00.000Z");
  });
});

describe("computeTicketGroup uses per-row times as a bid-ordered schedule", () => {
  it("gives the earliest slot to the highest bid, not to the row that listed it", () => {
    // Times are out of bid order on purpose: the $99 ticket should still close
    // first, at the EARLIEST listed time (the slot), not at its own row's time.
    const tickets: TicketItem[] = [
      { group: "Lunch", label: "1 of 3", currentBid: 50, cascadeStartISO: "2026-06-11T17:50:00.000Z" },
      { group: "Lunch", label: "2 of 3", currentBid: 20, cascadeStartISO: "2026-06-11T17:52:00.000Z" },
      { group: "Lunch", label: "3 of 3", currentBid: 99, cascadeStartISO: "2026-06-11T17:51:00.000Z" },
    ];
    const now = ms("2026-06-11T17:49:00.000Z");
    const g = computeTicketGroup("Lunch", tickets, baseConfig, now);
    expect(g.tickets.map((t) => t.label)).toEqual(["3 of 3", "1 of 3", "2 of 3"]);
    expect(g.tickets.map((t) => t.effectiveCloseISO)).toEqual([
      "2026-06-11T17:50:00.000Z",
      "2026-06-11T17:51:00.000Z",
      "2026-06-11T17:52:00.000Z",
    ]);
    expect(g.activeTicketId).toBe("Lunch::3 of 3");
  });

  it("matches the Sales Office Lunch group exactly (bid desc, ties by ticket #)", () => {
    const at = (clock: string) => `2026-06-12T${clock}:00-04:00`;
    const rows: [string, number, string][] = [
      ["1 of 12", 70, "10:25"], ["2 of 12", 50, "10:26"], ["3 of 12", 30, "10:27"],
      ["4 of 12", 20, "10:28"], ["5 of 12", 50, "10:29"], ["6 of 12", 20, "10:30"],
      ["7 of 12", 20, "10:31"], ["8 of 12", 20, "10:32"], ["9 of 12", 20, "10:33"],
      ["10 of 12", 40, "10:34"], ["11 of 12", 30, "10:35"], ["12 of 12", 30, "10:36"],
    ];
    const tickets: TicketItem[] = rows.map(([label, currentBid, t]) => ({
      group: "Sales Office Lunch",
      label,
      currentBid,
      cascadeStartISO: at(t),
    }));
    const now = ms("2026-06-12T10:20:00-04:00");
    const g = computeTicketGroup("Sales Office Lunch", tickets, baseConfig, now);

    expect(g.tickets.map((t) => t.label)).toEqual([
      "1 of 12", // $70
      "2 of 12", "5 of 12", // $50 tie -> lower number first
      "10 of 12", // $40
      "3 of 12", "11 of 12", "12 of 12", // $30 tie -> 3, 11, 12
      "4 of 12", "6 of 12", "7 of 12", "8 of 12", "9 of 12", // $20 tie -> ascending
    ]);
    // Slots are the listed times in order: 10:25..10:36 EDT == 14:25..14:36 UTC.
    expect(g.tickets.map((t) => t.effectiveCloseISO.slice(11, 16))).toEqual([
      "14:25", "14:26", "14:27", "14:28", "14:29", "14:30",
      "14:31", "14:32", "14:33", "14:34", "14:35", "14:36",
    ]);
    expect(g.activeTicketId).toBe("Sales Office Lunch::1 of 12");
  });

  it("a wire bid on the active ticket pushes all later tickets down the chain", () => {
    const at = (clock: string) => `2026-06-12T${clock}:00-04:00`;
    const tickets: TicketItem[] = [
      { group: "G", label: "1 of 3", currentBid: 70, cascadeStartISO: at("10:25") },
      { group: "G", label: "2 of 3", currentBid: 50, cascadeStartISO: at("10:26") },
      { group: "G", label: "3 of 3", currentBid: 40, cascadeStartISO: at("10:27") },
    ];
    const now = ms("2026-06-12T10:24:30-04:00");
    const before = computeTicketGroup("G", tickets, baseConfig, now).tickets.map((t) =>
      ms(t.effectiveCloseISO),
    );
    // Bid $80 on the active ($70) ticket right at its 10:25 close.
    const bumped = tickets.map((t, i) =>
      i === 0 ? { ...t, currentBid: 80, lastBidISO: at("10:25") } : t,
    );
    const after = computeTicketGroup("G", bumped, baseConfig, now).tickets.map((t) =>
      ms(t.effectiveCloseISO),
    );
    after.forEach((t, i) => expect(t - before[i]).toBe(60_000)); // every ticket +1 min
  });
});

describe("computeTicketGroup seats / outbid", () => {
  it("with more bids than seats, the lowest-ranked bids are outbid", () => {
    const tickets: TicketItem[] = [
      { group: "Lunch", label: "1", currentBid: 50, seats: 2 },
      { group: "Lunch", label: "2", currentBid: 40 },
      { group: "Lunch", label: "3", currentBid: 30 },
    ];
    const now = ms("2026-06-11T17:59:00.000Z");
    const g = computeTicketGroup("Lunch", tickets, baseConfig, now);

    expect(g.seats).toBe(2);
    expect(g.tickets.map((t) => t.status)).toEqual(["active", "pending", "outbid"]);
    expect(g.openCount).toBe(2);
    expect(g.outbidCount).toBe(1);
    // The outbid ticket has no live countdown.
    expect(g.tickets[2].secondsLeft).toBe(0);
  });

  it("when seats are unset, every bid wins a seat (nobody outbid)", () => {
    const tickets: TicketItem[] = [
      { group: "Lunch", label: "1", currentBid: 50 },
      { group: "Lunch", label: "2", currentBid: 40 },
    ];
    const now = ms("2026-06-11T17:59:00.000Z");
    const g = computeTicketGroup("Lunch", tickets, baseConfig, now);
    expect(g.outbidCount).toBe(0);
    expect(g.tickets.map((t) => t.status)).toEqual(["active", "pending"]);
  });

  it("a new high bid takes the top and cascades the old bid down, bumping the lowest out", () => {
    // 12 seats, 12 winning bids -> nobody outbid yet.
    const raw: Array<[string, number]> = [
      ["1 of 12", 70], ["2 of 12", 50], ["3 of 12", 30], ["4 of 12", 20],
      ["5 of 12", 50], ["6 of 12", 20], ["7 of 12", 20], ["8 of 12", 20],
      ["9 of 12", 20], ["10 of 12", 40], ["11 of 12", 30], ["12 of 12", 30],
    ];
    const base: TicketItem[] = raw.map(([label, currentBid]) => ({
      group: "Lunch",
      label,
      currentBid,
      seats: 12,
    }));
    const now = ms("2026-06-11T17:59:00.000Z");
    const before = computeTicketGroup("Lunch", base, baseConfig, now);
    expect(before.outbidCount).toBe(0);
    expect(before.activeTicketId).toBe("Lunch::1 of 12");

    // A NEW $100 bid arrives on the closing item -> takes the top. Everyone
    // cascades down one; the lowest seat ($20, ticket "9 of 12") drops to outbid.
    const withNewBid: TicketItem[] = [
      ...base,
      { group: "Lunch", label: "13 of 12", currentBid: 100, seats: 12 },
    ];
    const after = computeTicketGroup("Lunch", withNewBid, baseConfig, now);

    expect(after.activeTicketId).toBe("Lunch::13 of 12");
    expect(after.openCount).toBe(12);
    expect(after.outbidCount).toBe(1);
    const outbid = after.tickets.find((t) => t.status === "outbid");
    expect(outbid?.label).toBe("9 of 12"); // last of the $20 ties
  });
});

describe("resolveFeaturedId", () => {
  const now = ms("2026-06-11T17:00:00.000Z");
  const items: RegularItem[] = [
    { id: "1", name: "A", baseCloseISO: "2026-06-11T18:00:00.000Z" },
    { id: "2", name: "B", baseCloseISO: "2026-06-11T17:30:00.000Z" },
    { id: "3", name: "C", baseCloseISO: "2026-06-11T19:00:00.000Z" },
  ];
  const computed = items.map((i) => computeItem(i, baseConfig, now));

  it("prefers the soonest-closing open item", () => {
    expect(resolveFeaturedId(computed, baseConfig)).toBe("2");
  });

  it("honors an explicit config override", () => {
    expect(
      resolveFeaturedId(computed, { ...baseConfig, featuredItemId: "3" }),
    ).toBe("3");
  });

  it("honors a sheet featured flag over closing-soonest", () => {
    const flagged = items.map((i) =>
      computeItem({ ...i, featured: i.id === "1" }, baseConfig, now),
    );
    expect(resolveFeaturedId(flagged, baseConfig)).toBe("1");
  });

  it("falls back to the last-closing item when all are closed", () => {
    const late = ms("2026-06-11T20:00:00.000Z");
    const allClosed = items.map((i) => computeItem(i, baseConfig, late));
    expect(resolveFeaturedId(allClosed, baseConfig)).toBe("3");
  });
});

describe("computeState integration", () => {
  it("assembles items, ticket groups and a featured id", () => {
    const now = ms("2026-06-11T17:25:00.000Z");
    const state = computeState(
      {
        config: baseConfig,
        items: [
          { id: "1", name: "Item #1", baseCloseISO: "2026-06-11T17:30:00.000Z", currentBid: 1500 },
        ],
        tickets: [
          { group: "Tickets", label: "10 of 12", currentBid: 50 },
          { group: "Tickets", label: "1", currentBid: 40 },
        ],
      },
      now,
      "demo",
    );

    expect(state.items).toHaveLength(1);
    expect(state.featuredItemId).toBe("1");
    expect(state.ticketGroups).toHaveLength(1);
    expect(state.ticketGroups[0].tickets[0].label).toBe("10 of 12");
    expect(state.source).toBe("demo");
    expect(state.serverNowISO).toBe(new Date(now).toISOString());
  });
});
