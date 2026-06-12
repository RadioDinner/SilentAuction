import { describe, expect, it } from "vitest";
import { cascadeItemCloses, planItemCascadeWriteback } from "./auction";
import type { AuctionConfig, RegularItem } from "./types";

const config: AuctionConfig = {
  eventName: "Test",
  timezone: "America/New_York",
  extensionWindowSeconds: 60, // 1-minute window
  ticketCountdownSeconds: 180,
  urgentThresholdSeconds: 120,
};

const T0 = Date.parse("2026-07-18T21:30:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const item = (id: string, closeSec: number, bidSec?: number): RegularItem => ({
  id,
  name: id,
  baseCloseISO: at(closeSec),
  lastBidISO: bidSec === undefined ? undefined : at(bidSec),
});

const closeOf = (items: RegularItem[], id: string) =>
  items.find((i) => i.id === id)!.baseCloseISO;

describe("planItemCascadeWriteback", () => {
  it("no changes when nothing has a fresh bid", () => {
    const items = [item("A", 600), item("B", 1200), item("C", 300)];
    expect(planItemCascadeWriteback(items, config, T0)).toEqual([]);
  });

  it("extends the bid item and bumps only items closing LATER by one window", () => {
    // A closes at +600 with a wire bid at +570 (+60 = +630 > 600 -> fresh).
    // B closes later (+1200) -> bumped +60. C closes earlier (+300) -> untouched.
    const items = [item("A", 600, 570), item("B", 1200), item("C", 300)];
    const changes = planItemCascadeWriteback(items, config, T0);
    const byId = new Map(changes.map((c) => [c.id, c.newCloseISO]));
    expect(byId.get("A")).toBe(at(630)); // 570 + window
    expect(byId.get("B")).toBe(at(1260)); // 1200 + window
    expect(byId.has("C")).toBe(false);
    expect(changes).toHaveLength(2);
  });

  it("is idempotent — re-running on the written-back closes yields no changes", () => {
    const items = [item("A", 600, 570), item("B", 1200), item("C", 300)];
    const changes = planItemCascadeWriteback(items, config, T0);
    const settled = cascadeItemCloses(items, config, T0); // apply the new closes
    // sanity: applying matches the planned writes
    expect(closeOf(settled, "A")).toBe(changes.find((c) => c.id === "A")!.newCloseISO);
    expect(planItemCascadeWriteback(settled, config, T0)).toEqual([]);
  });

  it("does nothing for a bid well before the close (no anti-snipe)", () => {
    // bid at +100, close at +600: 100 + 60 = 160 < 600, not fresh.
    const items = [item("A", 600, 100), item("B", 1200)];
    expect(planItemCascadeWriteback(items, config, T0)).toEqual([]);
  });

  it("accumulates additively: two fresh bids push a later item by two windows", () => {
    const items = [
      item("A", 600, 570), // fresh: own +630, plus C closes earlier & is fresh -> +1 = +690
      item("C", 300, 280), // fresh, earliest -> +340 (280+60)
      item("B", 1200), // later than both fresh items -> +2 windows
    ];
    const byId = new Map(
      planItemCascadeWriteback(items, config, T0).map((c) => [c.id, c.newCloseISO]),
    );
    expect(byId.get("A")).toBe(at(690)); // 630 own extension + one bump from C
    expect(byId.get("C")).toBe(at(340));
    expect(byId.get("B")).toBe(at(1320)); // 1200 + 2*window (A and C)
  });

  it("ignores items with no real near-term close (beyond the horizon)", () => {
    const farClose = 24 * 3600; // +24h, past the 12h horizon
    const items = [item("A", 600, 570), item("FAR", farClose)];
    const changes = planItemCascadeWriteback(items, config, T0);
    expect(changes.map((c) => c.id)).toEqual(["A"]); // FAR never bumped
  });
});

describe("cascadeItemCloses", () => {
  it("advances close times for display and leaves earlier/untouched items alone", () => {
    const items = [item("A", 600, 570), item("B", 1200), item("C", 300)];
    const out = cascadeItemCloses(items, config, T0);
    expect(closeOf(out, "A")).toBe(at(630));
    expect(closeOf(out, "B")).toBe(at(1260));
    expect(closeOf(out, "C")).toBe(at(300)); // unchanged
  });
});
