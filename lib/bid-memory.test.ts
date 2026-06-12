import { describe, it, expect, beforeEach } from "vitest";
import { observeBid, resetBidMemory } from "./bid-memory";

describe("observeBid (in-memory bid detector)", () => {
  beforeEach(() => resetBidMemory());

  it("treats the first sighting of a row as a baseline (no extension)", () => {
    expect(observeBid("t1", 50, 1000)).toBeNull();
  });

  it("reports 'now' when a bid increases, then sticks until the next increase", () => {
    expect(observeBid("t1", 50, 1000)).toBeNull(); // baseline
    expect(observeBid("t1", 60, 2000)).toBe(2000); // increased -> bid time = now
    // Unchanged polls keep reporting the moment of the last increase.
    expect(observeBid("t1", 60, 2500)).toBe(2000);
    expect(observeBid("t1", 60, 9000)).toBe(2000);
    // Another increase re-stamps to the new now.
    expect(observeBid("t1", 70, 9000)).toBe(9000);
  });

  it("does not extend when a bid is corrected downward", () => {
    expect(observeBid("t1", 50, 1000)).toBeNull();
    expect(observeBid("t1", 40, 2000)).toBeNull(); // lowered -> no extension
    // ...but a later rise above the tracked amount extends again.
    expect(observeBid("t1", 55, 3000)).toBe(3000);
  });

  it("keeps separate memory per id", () => {
    expect(observeBid("a", 10, 1000)).toBeNull();
    expect(observeBid("b", 10, 1000)).toBeNull();
    expect(observeBid("a", 20, 2000)).toBe(2000);
    expect(observeBid("b", 10, 2000)).toBeNull(); // b unchanged
  });
});
