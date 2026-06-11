// Built-in demo dataset. Used when no Google credentials are configured (or
// AUCTION_DEMO=1), so the dashboard is immediately previewable. Times are
// generated relative to "now" so the demo is always live and counting down.

import type { AuctionData, TicketItem } from "./types";

export function buildDemoData(nowMs: number): AuctionData {
  const iso = (offsetSec: number) =>
    new Date(nowMs + offsetSec * 1000).toISOString();
  const MIN = 60;

  // Ticket bids — note "10 of 12" is the high ticket at $50, per the brief.
  const ticketBids: Record<string, number> = {
    "1 of 12": 40,
    "2 of 12": 25,
    "3 of 12": 30,
    "4 of 12": 22,
    "5 of 12": 35,
    "6 of 12": 28,
    "7 of 12": 45,
    "8 of 12": 20,
    "9 of 12": 33,
    "10 of 12": 50,
    "11 of 12": 38,
    "12 of 12": 42,
  };
  const tickets: TicketItem[] = Object.entries(ticketBids).map(
    ([label, bid], i) => ({
      group: "Suite Tickets",
      label,
      imageUrl: "https://picsum.photos/seed/suite-tickets/1000/750",
      currentBid: bid,
      highBidder: `Paddle ${10 + i}`,
      lastBidISO: iso(-3 * MIN),
    }),
  );

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
