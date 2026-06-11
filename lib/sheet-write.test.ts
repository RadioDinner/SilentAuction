import { describe, expect, it } from "vitest";
import {
  colLetter,
  planConfigWrites,
  planItemWrites,
  planTicketWrites,
  type Row,
} from "./sheet-write";
import { parseSheetTime } from "./time";

const TZ = "America/New_York";
const EVENT_DATE = "2026-07-18";
const iso = (clock: string) => parseSheetTime(clock, EVENT_DATE, TZ)!;

describe("colLetter", () => {
  it("maps indices to spreadsheet column letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(4)).toBe("E");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(27)).toBe("AB");
  });
});

describe("planItemWrites", () => {
  const header: Row = ["Item #", "Name", "Current Bid", "High Bidder", "Last Bid Time", "Close Time"];

  it("emits updates only for fields that changed, addressed by column + row", () => {
    const rows: Row[] = [header, ["1", "E-Bike", "1500", "Alice", "", "5:30 PM"]];
    const plan = planItemWrites(
      rows,
      [{ id: "1", currentBid: 1600, highBidder: "Bob", lastBidISO: iso("5:31 PM"), baseCloseISO: iso("5:31 PM") }],
      "Items",
      EVENT_DATE,
      TZ,
    );
    const ranges = plan.updates.map((u) => u.range);
    expect(ranges).toContain("'Items'!C2"); // Current Bid
    expect(ranges).toContain("'Items'!D2"); // High Bidder
    expect(ranges).toContain("'Items'!E2"); // Last Bid Time
    expect(ranges).toContain("'Items'!F2"); // Close Time
    expect(plan.updates.find((u) => u.range === "'Items'!C2")?.values).toEqual([[1600]]);
    expect(plan.updates.find((u) => u.range === "'Items'!D2")?.values).toEqual([["Bob"]]);
    expect(plan.unmatched).toEqual([]);
  });

  it("is idempotent — no updates when the sheet already matches", () => {
    const rows: Row[] = [header, ["1", "E-Bike", "1500", "Alice", "", "5:30 PM"]];
    const plan = planItemWrites(
      rows,
      [{ id: "1", currentBid: 1500, highBidder: "Alice", lastBidISO: null, baseCloseISO: iso("5:30 PM") }],
      "Items",
      EVENT_DATE,
      TZ,
    );
    expect(plan.updates).toEqual([]);
  });

  it("writes a round-trippable time string", () => {
    const rows: Row[] = [header, ["1", "E-Bike", "1500", "Alice", "", "5:30 PM"]];
    const plan = planItemWrites(rows, [{ id: "1", lastBidISO: iso("5:31 PM") }], "Items", EVENT_DATE, TZ);
    const written = String(plan.updates.find((u) => u.range === "'Items'!E2")?.values[0][0]);
    // The value we write must parse back to the same instant.
    expect(parseSheetTime(written, EVENT_DATE, TZ)).toBe(iso("5:31 PM"));
  });

  it("reports rows it could not match", () => {
    const rows: Row[] = [header, ["1", "E-Bike", "1500", "Alice", "", "5:30 PM"]];
    const plan = planItemWrites(rows, [{ id: "99", currentBid: 10 }], "Items", EVENT_DATE, TZ);
    expect(plan.updates).toEqual([]);
    expect(plan.unmatched).toEqual(["Item 99"]);
  });

  it("reports managed fields that have no column", () => {
    const noBidder: Row = ["Item #", "Name", "Current Bid", "Last Bid Time", "Close Time"];
    const rows: Row[] = [noBidder, ["1", "E-Bike", "1500", "", "5:30 PM"]];
    const plan = planItemWrites(rows, [{ id: "1", highBidder: "Bob" }], "Items", EVENT_DATE, TZ);
    expect(plan.skipped).toContain('Items: no "High Bidder" column');
  });

  it("matches by name when the id equals the item name", () => {
    const rows: Row[] = [header, ["", "Espresso Machine", "300", "", "", "6:00 PM"]];
    const plan = planItemWrites(
      rows,
      [{ id: "Espresso Machine", name: "Espresso Machine", currentBid: 350 }],
      "Items",
      EVENT_DATE,
      TZ,
    );
    expect(plan.updates.map((u) => u.range)).toContain("'Items'!C2");
  });
});

describe("planTicketWrites", () => {
  const header: Row = ["Group", "Ticket", "Current Bid", "High Bidder", "Last Bid Time", "Cascade Start"];

  it("matches a ticket by group + label", () => {
    const rows: Row[] = [
      header,
      ["Sales Office Lunch", "10 of 12", "50", "Cara", "", "7:00 PM"],
      ["Sales Office Lunch", "1 of 12", "40", "Dan", "", ""],
    ];
    const plan = planTicketWrites(
      rows,
      [{ group: "Sales Office Lunch", label: "1 of 12", currentBid: 55, highBidder: "Eve" }],
      "Tickets",
      EVENT_DATE,
      TZ,
    );
    expect(plan.updates.map((u) => u.range).sort()).toEqual(["'Tickets'!C3", "'Tickets'!D3"]);
  });

  it("defaults a blank group cell to 'Tickets'", () => {
    const rows: Row[] = [header, ["", "A", "20", "", "", ""]];
    const plan = planTicketWrites(
      rows,
      [{ group: "Tickets", label: "A", currentBid: 25 }],
      "Tickets",
      EVENT_DATE,
      TZ,
    );
    expect(plan.updates.map((u) => u.range)).toContain("'Tickets'!C2");
  });
});

describe("planConfigWrites", () => {
  const rows: Row[] = [
    ["Key", "Value"],
    ["event_name", "Picnic"],
    ["extension_window_seconds", "60"],
  ];

  it("updates a changed setting, skips unchanged, reports missing keys", () => {
    const plan = planConfigWrites(
      rows,
      { eventName: "Company Picnic", extensionWindowSeconds: 60, ticketCountdownSeconds: 180 },
      "Config",
    );
    expect(plan.updates).toEqual([{ range: "'Config'!B2", values: [["Company Picnic"]] }]);
    expect(plan.skipped).toContain('Settings: no "ticket_countdown_seconds" row');
  });

  it("ignores an unset (undefined) setting and an empty optional with no row", () => {
    const plan = planConfigWrites(rows, { featuredItemId: "" }, "Config");
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
