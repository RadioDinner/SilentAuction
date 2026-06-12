import { Countdown } from "./Countdown";
import { formatClock, formatMoney } from "@/lib/format";

/** A single thing on the closing timeline — an item or one ticket. */
export interface SpotEntry {
  key: string;
  /** Dedup lane: each spotlight card shows a different lane (one per ticket
   *  group / one per item), so two tickets from the same batch never share the
   *  two "Now Closing" cards. */
  lane: string;
  kind: "item" | "ticket";
  name: string;
  /** Secondary line (item description, or ticket "#3 of 12"). */
  sub?: string;
  bid?: number;
  closeISO: string;
  secondsLeft: number;
  imageUrl?: string;
}

const VARIANTS = {
  now: {
    label: "Now Closing",
    badge: "bg-red-500/25 text-red-100 ring-red-400/50 animate-pulse-urgent",
    ring: "border-red-400/40 shadow-[0_0_70px_-20px_rgba(248,113,113,0.55)]",
    accent: "text-red-300",
    empty: "Auction complete",
  },
  next: {
    label: "Next Up",
    badge: "bg-sky-500/20 text-sky-100 ring-sky-400/40",
    ring: "border-sky-400/30",
    accent: "text-sky-300",
    empty: "Nothing up next",
  },
} as const;

export function SpotlightCard({
  variant,
  entry,
  nowMs,
  tz,
  urgentSeconds,
  emptyLabel,
}: {
  variant: "now" | "next";
  entry?: SpotEntry;
  nowMs: number;
  tz: string;
  urgentSeconds: number;
  /** Override the placeholder text shown when there's no entry. */
  emptyLabel?: string;
}) {
  const v = VARIANTS[variant];

  if (!entry) {
    return (
      <section
        className={`grid min-h-[26vh] place-items-center rounded-3xl border bg-white/5 ${v.ring}`}
      >
        <div className="text-center">
          <div className={`text-sm font-bold uppercase tracking-[0.3em] ${v.accent}`}>{v.label}</div>
          <div className="mt-2 text-3xl text-slate-400">{emptyLabel ?? v.empty}</div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`relative flex min-h-[26vh] flex-col overflow-hidden rounded-3xl border bg-slate-900 ${v.ring}`}
    >
      {entry.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-700/70 to-slate-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/25" />

      <div className="relative flex h-full flex-1 flex-col p-7">
        <div className="flex items-center justify-between">
          <span
            className={`rounded-full px-4 py-1.5 text-lg font-bold uppercase tracking-widest ring-1 ${v.badge}`}
          >
            {v.label}
          </span>
          <span className="text-base font-semibold uppercase tracking-[0.25em] text-slate-300">
            {entry.kind === "ticket" ? "Ticket" : "Item"}
          </span>
        </div>

        <div className="mt-4">
          <h2 className="text-5xl font-black leading-tight drop-shadow">{entry.name}</h2>
          {entry.sub && <div className="mt-1 truncate text-2xl text-slate-300/90">{entry.sub}</div>}
        </div>

        <div className="mt-auto flex items-end justify-between gap-6 pt-6">
          <div className="min-w-0">
            <div className="text-lg font-semibold uppercase tracking-wider text-slate-300">
              High Bid
            </div>
            <div className="text-6xl font-black text-white">{formatMoney(entry.bid)}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold uppercase tracking-wider text-slate-300">
              Closes In
            </div>
            <Countdown
              iso={entry.closeISO}
              nowMs={nowMs}
              urgentSeconds={urgentSeconds}
              className="text-6xl"
            />
            <div className="mt-1 text-lg text-slate-400">at {formatClock(entry.closeISO, tz)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
