import type { ComputedItem, TicketGroupState } from "@/lib/types";
import { formatClock, formatMoney } from "@/lib/format";

interface Row {
  key: string;
  label: string;
  bid?: number;
  secondary: string;
  closed: boolean;
  closing: boolean;
  /** High bidder shown as the winner once the row has closed. */
  winner?: string;
}

/**
 * Every item and ticket, laid out in columns that fill TOP-DOWN and then
 * LEFT-TO-RIGHT (CSS multi-column). Items come first, then each ticket group in
 * closing order.
 */
export function BidList({
  items,
  groups,
  tz,
}: {
  items: ComputedItem[];
  groups: TicketGroupState[];
  tz: string;
}) {
  const rows: Row[] = [];

  for (const item of items) {
    const closed = item.status === "closed";
    rows.push({
      key: `i-${item.id}`,
      label: item.name,
      bid: item.currentBid,
      closed,
      closing: item.status === "closing",
      winner: closed ? item.highBidder : undefined,
      secondary: closed ? "" : formatClock(item.effectiveCloseISO, tz),
    });
  }

  for (const g of groups) {
    for (const t of g.tickets) {
      const closed = t.status === "closed";
      rows.push({
        key: `t-${t.id}`,
        label: `${g.group} · #${t.label}`,
        bid: t.currentBid,
        closed,
        closing: t.status === "active",
        winner: closed ? t.highBidder : undefined,
        secondary: closed ? "" : formatClock(t.effectiveCloseISO, tz),
      });
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/5 px-5 py-3">
      <h2 className="mb-2 shrink-0 text-xl font-extrabold uppercase tracking-[0.2em] text-slate-300">
        All Current High Bids
      </h2>
      {/* Everything fits on the card — no scrolling. Columns fill top-down then
          left-to-right. */}
      <div className="columns-2 gap-x-8 lg:columns-3 xl:columns-4">
        {rows.map((r) => (
          <div
            key={r.key}
            className={`flex break-inside-avoid items-baseline justify-between border-b border-white/5 py-0.5 ${
              r.closed && !r.winner ? "opacity-45" : ""
            }`}
          >
            <span className="truncate pr-3 text-base text-slate-100">{r.label}</span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-base font-bold tabular-nums">{formatMoney(r.bid)}</span>
              {r.closed ? (
                <span className="flex items-baseline gap-1 text-xs font-semibold text-amber-300">
                  <span aria-hidden>🏆</span>
                  <span className="max-w-[8rem] truncate">{r.winner || "Won"}</span>
                </span>
              ) : (
                <span
                  className={`text-xs tabular-nums ${
                    r.closing ? "font-semibold text-red-300" : "text-slate-400"
                  }`}
                >
                  {r.secondary}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
