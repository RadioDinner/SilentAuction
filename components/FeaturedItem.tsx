import type { ComputedItem } from "@/lib/types";
import { Countdown } from "./Countdown";
import { formatClock, formatMoney } from "@/lib/format";

function StatusBadge({ status }: { status: ComputedItem["status"] }) {
  const map = {
    open: { text: "OPEN", cls: "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40" },
    closing: {
      text: "NOW CLOSING",
      cls: "bg-red-500/25 text-red-100 ring-red-400/50 animate-pulse-urgent",
    },
    closed: { text: "CLOSED", cls: "bg-slate-600/30 text-slate-300 ring-slate-400/30" },
  } as const;
  const s = map[status];
  return (
    <span
      className={`rounded-full px-4 py-1.5 text-lg font-bold uppercase tracking-widest ring-1 ${s.cls}`}
    >
      {s.text}
    </span>
  );
}

export function FeaturedItem({
  item,
  nowMs,
  tz,
  urgentSeconds,
}: {
  item?: ComputedItem;
  nowMs: number;
  tz: string;
  urgentSeconds: number;
}) {
  if (!item) {
    return (
      <section className="grid h-full place-items-center rounded-3xl border border-white/10 bg-white/5 text-3xl text-slate-400">
        No items to display yet.
      </section>
    );
  }

  const closed = item.status === "closed";

  return (
    <section className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.name}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-black/20" />

      <div className="absolute left-7 top-7">
        <StatusBadge status={item.status} />
      </div>

      <div className="absolute inset-x-0 bottom-0 p-8">
        <div className="text-base font-semibold uppercase tracking-[0.3em] text-amber-300">
          Featured Item
        </div>
        <h1 className="mt-1 text-6xl font-black leading-tight drop-shadow-lg">
          {item.name}
        </h1>
        {item.description && (
          <p className="mt-2 max-w-3xl text-2xl text-slate-200/85">
            {item.description}
          </p>
        )}

        <div className="mt-7 flex items-end justify-between gap-8">
          <div>
            <div className="text-xl font-semibold uppercase tracking-wider text-slate-300">
              High Bid
            </div>
            <div className="text-7xl font-black text-white">
              {formatMoney(item.currentBid)}
            </div>
            {item.highBidder && (
              <div className="mt-1 text-3xl text-slate-300">{item.highBidder}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold uppercase tracking-wider text-slate-300">
              {closed ? "Closed" : "Closes In"}
            </div>
            <Countdown
              iso={item.effectiveCloseISO}
              nowMs={nowMs}
              urgentSeconds={urgentSeconds}
              className="text-7xl"
            />
            {!closed && (
              <div className="mt-1 text-xl text-slate-400">
                at {formatClock(item.effectiveCloseISO, tz)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
