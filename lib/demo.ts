// Built-in demo dataset. Used when no Google credentials are configured (or
// AUCTION_DEMO=1), so the dashboard is immediately previewable. Times are
// generated relative to "now" so the demo is always live and counting down.

import type { AuctionData, TicketItem } from "./types";

export function buildDemoData(nowMs: number): AuctionData {
  const iso = (offsetSec: number) =>
    new Date(nowMs + offsetSec * 1000).toISOString();
  const MIN = 60;

  // A few ticket groups, each with its own cascade start, to show how multiple
  // groups stagger and how the dashboard spotlights the soonest-closing one.
  const makeGroup = (
    group: string,
    bids: Record<string, number>,
    startOffsetSec: number,
    seats?: number,
  ): TicketItem[] =>
    Object.entries(bids).map(([label, bid], i) => ({
      group,
      label,
      currentBid: bid,
      highBidder: `Paddle ${10 + i}`,
      lastBidISO: iso(-3 * MIN),
      cascadeStartISO: iso(startOffsetSec),
      seats,
    }));

  const tickets: TicketItem[] = [
    // Closes soonest -> this group is the spotlight on the dashboard.
    ...makeGroup("Dinner Tickets", { "1 of 4": 60, "2 of 4": 45, "3 of 4": 40, "4 of 4": 35 }, 45),
    // 10 seats but 12 bids -> the two lowest bids ($20, $22) show as "outbid".
    ...makeGroup(
      "Lunch Tickets",
      {
        "1 of 12": 40, "2 of 12": 25, "3 of 12": 30, "4 of 12": 22,
        "5 of 12": 35, "6 of 12": 28, "7 of 12": 45, "8 of 12": 20,
        "9 of 12": 33, "10 of 12": 50, "11 of 12": 38, "12 of 12": 42,
      },
      150,
      10,
    ),
    ...makeGroup("Fishing Trip", { "1 of 3": 120, "2 of 3": 120, "3 of 3": 100 }, 300),
  ];

  return {
    config: {
      eventName: "Company Picnic Silent Auction",
      timezone: "America/Chicago",
      eventDateISO: new Date(nowMs).toISOString().slice(0, 10),
      extensionWindowSeconds: 60,
      ticketCountdownSeconds: 120,
      urgentThresholdSeconds: 120,
      // First (highest) ticket closes 90s after load; cascade rolls from there.
      ticketCascadeStartISO: iso(90),
      featuredItemId: undefined,
    },
    items: [
      {
        id: "1",
        name: "Weber Genesis Grill",
        description: "4-burner propane grill with side burner.",
        imageUrl: "https://picsum.photos/seed/auction-grill/1000/750",
        startingBid: 200,
        currentBid: 1500,
        highBidder: "Paddle 42",
        baseCloseISO: iso(2 * MIN),
        lastBidISO: iso(-4 * MIN),
      },
      {
        id: "2",
        name: "Spa Day for Two",
        description: "Full-day package at Serenity Spa.",
        imageUrl: "https://picsum.photos/seed/auction-spa/1000/750",
        startingBid: 100,
        currentBid: 250,
        highBidder: "Paddle 17",
        baseCloseISO: iso(6 * MIN),
        lastBidISO: iso(-2 * MIN),
      },
      {
        id: "3",
        name: "Mountain Bike",
        description: "27-speed trail bike, large frame.",
        imageUrl: "https://picsum.photos/seed/auction-bike/1000/750",
        startingBid: 150,
        currentBid: 800,
        highBidder: "Paddle 8",
        baseCloseISO: iso(11 * MIN),
        lastBidISO: iso(-1 * MIN),
      },
      {
        id: "4",
        name: "Signed Team Jersey",
        description: "Framed, certificate of authenticity.",
        imageUrl: "https://picsum.photos/seed/auction-jersey/1000/750",
        startingBid: 100,
        currentBid: undefined,
        highBidder: undefined,
        baseCloseISO: iso(18 * MIN),
        lastBidISO: undefined,
      },
    ],
    tickets,
  };
}
