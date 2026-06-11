import type { ComputedItem, TicketGroupState } from "@/lib/types";
import { formatClock, formatMoney } from "@/lib/format";

interface Row {
  key: string;
  label: string;
  bid?: number;
  secondary: string;
  closed: boolean;
  closing: boolean;
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
    rows.push({
      key: `i-${item.id}`,
      label: item.name,
      bid: item.currentBid,
      closed: item.status === "closed",
      closing: item.status === "closing",
      secondary: item.status === "closed" ? "closed" : formatClock(item.effectiveCloseISO, tz),
    });
  }

  for (const g of groups) {
    for (const t of g.tickets) {
      rows.push({
        key: `t-${t.id}`,
        label: `${g.group} · #${t.label}`,
        bid: t.currentBid,
        closed: t.status === "closed",
        closing: t.status === "active",
        secondary:
          t.status === "closed" ? "closed" : t.status === "active" ? "closing" : "up next",
      });
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-3">
      <h2 className="mb-2 shrink-0 text-xl font-extrabold uppercase tracking-[0.2em] text-slate-300">
        All Current High Bids
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <div className="columns-1 gap-x-8 sm:columns-2 lg:columns-3 2xl:columns-4">
          {rows.map((r) => (
            <div
              key={r.key}
              className={`flex break-inside-avoid items-baseline justify-between border-b border-white/5 py-1 ${
                r.closed ? "opacity-45" : ""
              }`}
            >
              <span className="truncate pr-3 text-lg text-slate-100">{r.label}</span>
              <span className="flex items-baseline gap-2 whitespace-nowrap">
                <span className="text-lg font-bold tabular-nums">{formatMoney(r.bid)}</span>
                <span
                  className={`text-xs uppercase tracking-wide ${
                    r.closing ? "text-red-300" : "text-slate-400"
                  }`}
                >
                  {r.secondary}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
