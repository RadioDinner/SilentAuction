"use client";

import { useEffect, useRef, useState } from "react";
import type { AuctionState } from "@/lib/types";
import { FeaturedItem } from "@/components/FeaturedItem";
import { TicketPanel } from "@/components/TicketPanel";
import { TicketGroupSummary } from "@/components/TicketGroupSummary";
import { BidList } from "@/components/BidList";
import { formatClock, secsLeft } from "@/lib/format";

const POLL_SECONDS = Number(process.env.NEXT_PUBLIC_POLL_SECONDS) || 3;

export default function Dashboard() {
  const [state, setState] = useState<AuctionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const offsetRef = useRef(0); // serverNow - clientNow, to sync countdowns

  // Poll the server for fresh auction state.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AuctionState = await res.json();
        if (!active) return;
        offsetRef.current = Date.parse(data.serverNowISO) - Date.now();
        setState(data);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    };
    load();
    const id = setInterval(load, POLL_SECONDS * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Local ticker so countdowns update smoothly between polls.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now() + offsetRef.current), 500);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <main className="grid h-screen place-items-center text-3xl text-slate-400">
        {error ? `Connection issue: ${error}` : "Loading auction…"}
      </main>
    );
  }

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
    <main className="flex h-screen flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-black tracking-tight">{state.config.eventName}</h1>
        <div className="flex items-center gap-3 text-right">
          {state.source === "demo" && (
            <span className="rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold uppercase tracking-wider text-amber-200">
              Demo data
            </span>
          )}
          {error && (
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-bold uppercase tracking-wider text-red-200">
              reconnecting…
            </span>
          )}
          <div className="text-3xl font-semibold tabular-nums text-slate-200">
            {formatClock(new Date(nowMs).toISOString(), tz)}
          </div>
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
