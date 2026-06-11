import type { AuctionState } from "@/lib/types";
import { FeaturedItem } from "./FeaturedItem";
import { TicketPanel } from "./TicketPanel";
import { TicketGroupSummary } from "./TicketGroupSummary";
import { BidList } from "./BidList";
import { formatClock, secsLeft } from "@/lib/format";

/**
 * Pure presentation of an AuctionState at a given moment. Used by both the
 * live dashboard (/) and the admin test console's preview (/admin).
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
  const featured = state.items.find((i) => i.id === state.featuredItemId);
  const groups = state.ticketGroups;

  // Spotlight the group closing soonest; show the rest as compact cards.
  const groupUrgency = (g: (typeof groups)[number]) => {
    const open = g.tickets.filter((t) => t.status !== "closed");
    if (open.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(...open.map((t) => secsLeft(t.effectiveCloseISO, nowMs)));
  };
  const sortedGroups = [...groups].sort((a, b) => groupUrgency(a) - groupUrgency(b));
  const spotlight = sortedGroups[0];
  const otherGroups = sortedGroups.slice(1);

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

      <div
        className={`grid min-h-0 flex-1 gap-4 ${
          groups.length > 0 ? "grid-cols-[1.6fr_1fr]" : "grid-cols-1"
        }`}
      >
        <FeaturedItem item={featured} nowMs={nowMs} tz={tz} urgentSeconds={urgent} />
        {spotlight && (
          <div className="flex min-h-0 flex-col gap-3">
            <TicketPanel group={spotlight} nowMs={nowMs} urgentSeconds={urgent} />
            {otherGroups.length > 0 && (
              <div className="grid shrink-0 grid-cols-2 gap-3">
                {otherGroups.map((g) => (
                  <TicketGroupSummary
                    key={g.group}
                    group={g}
                    nowMs={nowMs}
                    urgentSeconds={urgent}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <BidList items={state.items} groups={groups} tz={tz} />
    </main>
  );
}
