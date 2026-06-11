import type { ComputedTicket, TicketGroupState } from "@/lib/types";
import { Countdown } from "./Countdown";
import { formatMoney } from "@/lib/format";

function StatusChip({ status }: { status: ComputedTicket["status"] }) {
  const map = {
    closed: { text: "Closed", cls: "bg-slate-600/30 text-slate-300" },
    active: { text: "Closing", cls: "bg-red-500/25 text-red-100" },
    pending: { text: "Up next", cls: "bg-sky-500/20 text-sky-200" },
  } as const;
  const s = map[status];
  return (
    <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${s.cls}`}>
      {s.text}
    </span>
  );
}

export function TicketPanel({
  group,
  nowMs,
  urgentSeconds,
}: {
  group: TicketGroupState;
  nowMs: number;
  urgentSeconds: number;
}) {
  const active = group.tickets.find((t) => t.id === group.activeTicketId);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/10 bg-white/5 p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold">{group.group}</h2>
        <span className="rounded-full bg-white/10 px-3 py-1 text-lg text-slate-200">
          {group.openCount} open
        </span>
      </header>

      {active ? (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/20 to-red-500/10 p-4">
          <div className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Now Closing
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="text-4xl font-black">#{active.label}</div>
            <Countdown
              iso={active.effectiveCloseISO}
              nowMs={nowMs}
              urgentSeconds={urgentSeconds}
              className="text-5xl"
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl text-slate-300">{active.highBidder ?? "No bidder"}</span>
            <span className="text-3xl font-bold text-white">
              {formatMoney(active.currentBid)}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-2xl text-slate-400">
          All tickets closed.
        </div>
      )}

      <ul className="mt-4 flex-1 divide-y divide-white/5 overflow-auto no-scrollbar">
        {group.tickets.map((t) => (
          <li
            key={t.id}
            className={`flex items-center justify-between py-2 ${
              t.status === "closed" ? "opacity-50" : ""
            }`}
          >
            <span className="text-xl font-medium">#{t.label}</span>
            <span className="flex items-center gap-3">
              <span className="text-xl font-semibold tabular-nums">
                {formatMoney(t.currentBid)}
              </span>
              <StatusChip status={t.status} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
