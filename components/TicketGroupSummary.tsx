import type { TicketGroupState } from "@/lib/types";
import { Countdown } from "./Countdown";
import { formatMoney } from "@/lib/format";

/** Compact card for a ticket group that isn't the current spotlight. */
export function TicketGroupSummary({
  group,
  nowMs,
  urgentSeconds,
}: {
  group: TicketGroupState;
  nowMs: number;
  urgentSeconds: number;
}) {
  const active = group.tickets.find((t) => t.id === group.activeTicketId);
  const next = group.tickets.find((t) => t.status === "pending");
  const lead = active ?? next;

  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-lg font-bold">{group.group}</span>
        <span className="shrink-0 text-xs text-slate-400">{group.openCount} open</span>
      </div>
      {lead ? (
        <div className="mt-1 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm text-slate-300">
              {active ? "Closing" : "Up next"} · #{lead.label}
            </div>
            <div className="text-2xl font-bold">{formatMoney(lead.currentBid)}</div>
          </div>
          <Countdown
            iso={lead.effectiveCloseISO}
            nowMs={nowMs}
            urgentSeconds={urgentSeconds}
            className="text-2xl"
          />
        </div>
      ) : (
        <div className="mt-1 text-sm text-slate-400">All closed</div>
      )}
    </div>
  );
}
