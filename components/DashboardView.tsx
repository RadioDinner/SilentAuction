import type { AuctionState } from "@/lib/types";
import { SpotlightCard, type SpotEntry } from "./SpotlightCard";
import { BidList } from "./BidList";
import { formatClock, secsLeft } from "@/lib/format";

/**
 * Pure presentation of an AuctionState at a given moment. Used by both the
 * live dashboard (/) and the admin test console's preview (/admin).
 *
 * Layout: two spotlight cards — "Now Closing" and "Next Up" — driven by a single
 * timeline that merges items and tickets and sorts by soonest close. Below them,
 * every item and ticket is listed in top-down, left-to-right columns.
 */
export function DashboardView({
  state,
  nowMs,
  adminHref,
}: {
  state: AuctionState;
  nowMs: number;
  adminHref?: string;
}) {
  const tz = state.config.timezone;
  const urgent = state.config.urgentThresholdSeconds;

  // Unified timeline of everything still open, soonest-closing first.
  const open: SpotEntry[] = [];
  for (const it of state.items) {
    if (it.status === "closed") continue;
    open.push({
      key: `i-${it.id}`,
      lane: `item:${it.id}`,
      kind: "item",
      name: it.name,
      sub: it.description,
      bid: it.currentBid,
      closeISO: it.effectiveCloseISO,
      secondsLeft: secsLeft(it.effectiveCloseISO, nowMs),
      imageUrl: it.imageUrl,
    });
  }
  for (const g of state.ticketGroups) {
    for (const t of g.tickets) {
      // Skip closed seats and outbid bids — neither is on the closing timeline.
      if (t.status === "closed" || t.status === "outbid") continue;
      open.push({
        key: `t-${t.id}`,
        lane: `group:${g.group}`,
        kind: "ticket",
        name: g.group,
        sub: `#${t.label}`,
        bid: t.currentBid,
        closeISO: t.effectiveCloseISO,
        secondsLeft: secsLeft(t.effectiveCloseISO, nowMs),
        imageUrl: t.imageUrl ?? g.imageUrl,
      });
    }
  }
  open.sort(
    (a, b) =>
      a.secondsLeft - b.secondsLeft ||
      a.closeISO.localeCompare(b.closeISO) ||
      a.name.localeCompare(b.name),
  );

  // One spotlight per lane: keep only the soonest-closing entry from each ticket
  // group (its active ticket) and each item. This is what lets two different
  // BATCHES occupy the two "Now Closing" cards while never showing two tickets
  // from the same batch — only one ticket per batch closes at a time.
  const seenLanes = new Set<string>();
  const spotlights = open.filter((e) => {
    if (seenLanes.has(e.lane)) return false;
    seenLanes.add(e.lane);
    return true;
  });

  return (
    <main className="flex h-full flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-black tracking-tight">{state.config.eventName}</h1>
        <div className="flex items-center gap-3 text-right">
          {state.source === "demo" && (
            <span className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold uppercase tracking-wider text-amber-200">
              Demo data
            </span>
          )}
          <div className="text-3xl font-semibold tabular-nums text-slate-200">
            {formatClock(new Date(nowMs).toISOString(), tz)}
          </div>
          {adminHref && (
            <a
              href={adminHref}
              title="Admin / Test Console"
              aria-label="Admin"
              className="rounded-full bg-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/20"
            >
              ⚙
            </a>
          )}
        </div>
      </header>

      {state.warning && (
        <div className="rounded-xl bg-amber-500/10 px-4 py-2 text-lg text-amber-200">
          {state.warning}
        </div>
      )}

      {/* Two "Now Closing" cards — each a DIFFERENT batch (one ticket per group
          at a time) — with "Next Up" (the next batch) spanning below. */}
      <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <SpotlightCard
          variant="now"
          entry={spotlights[0]}
          nowMs={nowMs}
          tz={tz}
          urgentSeconds={urgent}
          emptyLabel="Auction complete"
        />
        <SpotlightCard
          variant="now"
          entry={spotlights[1]}
          nowMs={nowMs}
          tz={tz}
          urgentSeconds={urgent}
          emptyLabel="Nothing else imminent"
        />
        <div className="lg:col-span-2">
          <SpotlightCard variant="next" entry={spotlights[2]} nowMs={nowMs} tz={tz} urgentSeconds={urgent} />
        </div>
      </div>

      <BidList items={state.items} groups={state.ticketGroups} tz={tz} />
    </main>
  );
}
