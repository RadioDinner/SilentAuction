"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeState } from "@/lib/auction";
import { DashboardView } from "@/components/DashboardView";
import type { AuctionData, AuctionState } from "@/lib/types";

const STORAGE_KEY = "auction-admin-data-v1";

const input =
  "w-full rounded bg-white/10 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-sky-400";
const btn = "rounded bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/20";

// ---- helpers --------------------------------------------------------------

function stateToData(s: AuctionState): AuctionData {
  return {
    config: s.config,
    items: s.items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      imageUrl: i.imageUrl,
      startingBid: i.startingBid,
      currentBid: i.currentBid,
      highBidder: i.highBidder,
      baseCloseISO: i.baseCloseISO,
      lastBidISO: i.lastBidISO,
      featured: i.featured,
    })),
    tickets: s.ticketGroups.flatMap((g) =>
      g.tickets.map((t) => ({
        group: t.group,
        label: t.label,
        imageUrl: t.imageUrl,
        currentBid: t.currentBid,
        highBidder: t.highBidder,
        lastBidISO: t.lastBidISO,
        cascadeStartISO: t.cascadeStartISO,
      })),
    ),
  };
}

function isoToLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ---- page -----------------------------------------------------------------

export default function AdminConsole() {
  const [data, setData] = useState<AuctionData | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [shiftMs, setShiftMs] = useState(0); // clock fast-forward
  const offsetRef = useRef(0); // serverNow - clientNow
  const srcRef = useRef<"sheet" | "demo">("demo");

  // Load: prefer saved local edits, fall back to /api/state.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: AuctionState) => {
        offsetRef.current = Date.parse(s.serverNowISO) - Date.now();
        srcRef.current = s.source;
        if (saved) {
          try {
            setData(JSON.parse(saved));
            return;
          } catch {
            /* fall through */
          }
        }
        setData(stateToData(s));
      })
      .catch(() => {
        if (saved) {
          try {
            setData(JSON.parse(saved));
          } catch {
            /* ignore */
          }
        }
      });
  }, []);

  // Persist edits locally so a refresh keeps your test state.
  useEffect(() => {
    if (data) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // Ticker.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const previewNow = nowMs + offsetRef.current + shiftMs;
  const preview = useMemo(
    () => (data ? computeState(data, previewNow, srcRef.current) : null),
    [data, previewNow],
  );

  function reloadFromSource(clearLocal: boolean) {
    if (clearLocal) window.localStorage.removeItem(STORAGE_KEY);
    setShiftMs(0);
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: AuctionState) => {
        offsetRef.current = Date.parse(s.serverNowISO) - Date.now();
        srcRef.current = s.source;
        setData(stateToData(s));
      });
  }

  function updateItem(idx: number, patch: Partial<AuctionData["items"][number]>) {
    setData((d) =>
      d ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : d,
    );
  }
  function placeItemBid(idx: number, inc: number) {
    setData((d) => {
      if (!d) return d;
      const items = d.items.map((it, i) => {
        if (i !== idx) return it;
        const base = it.currentBid ?? it.startingBid ?? 0;
        return { ...it, currentBid: base + inc, lastBidISO: new Date(previewNow).toISOString() };
      });
      return { ...d, items };
    });
  }
  function updateTicket(idx: number, patch: Partial<AuctionData["tickets"][number]>) {
    setData((d) =>
      d ? { ...d, tickets: d.tickets.map((t, i) => (i === idx ? { ...t, ...patch } : t)) } : d,
    );
  }
  function placeTicketBid(idx: number, inc: number) {
    setData((d) => {
      if (!d) return d;
      const tickets = d.tickets.map((t, i) => {
        if (i !== idx) return t;
        const base = t.currentBid ?? 0;
        return { ...t, currentBid: base + inc, lastBidISO: new Date(previewNow).toISOString() };
      });
      return { ...d, tickets };
    });
  }
  function setGroupCascadeStart(group: string, iso?: string) {
    setData((d) =>
      d
        ? { ...d, tickets: d.tickets.map((t) => (t.group === group ? { ...t, cascadeStartISO: iso } : t)) }
        : d,
    );
  }
  function updateConfig(patch: Partial<AuctionData["config"]>) {
    setData((d) => (d ? { ...d, config: { ...d.config, ...patch } } : d));
  }

  if (!data || !preview) {
    return <div className="grid h-screen place-items-center text-2xl text-slate-400">Loading console…</div>;
  }

  // Group tickets for display while keeping their flat index for edits.
  const groupOrder: string[] = [];
  data.tickets.forEach((t) => {
    if (!groupOrder.includes(t.group)) groupOrder.push(t.group);
  });

  const shiftLabel =
    shiftMs === 0
      ? "live"
      : `${shiftMs > 0 ? "+" : "−"}${Math.round(Math.abs(shiftMs) / 60000)}m`;

  return (
    <div className="grid h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ---- Controls ---- */}
      <div className="h-screen overflow-y-auto p-4 no-scrollbar">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-2xl font-black">Admin · Test Console</h1>
          <a href="/" className={btn}>
            ← Dashboard
          </a>
          <button className={btn} onClick={() => reloadFromSource(false)}>
            Reload from source
          </button>
          <button
            className="rounded bg-red-600/80 px-2 py-1 text-xs font-semibold hover:bg-red-600"
            onClick={() => reloadFromSource(true)}
          >
            Reset
          </button>
        </div>

        <p className="mb-4 rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          Changes here stay in <b>your browser only</b> — they don&apos;t touch the live dashboard or
          your Google Sheet. Use the clock to fast-forward and watch items close and cascades roll.
        </p>

        {/* Clock */}
        <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold uppercase tracking-wider text-slate-300">Test clock</span>
            <span className="tabular-nums text-sm text-slate-300">
              preview: {new Date(previewNow).toLocaleTimeString()} ({shiftLabel})
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => setShiftMs(0)}>
              Live
            </button>
            <button className={btn} onClick={() => setShiftMs((s) => s - 60000)}>
              −1m
            </button>
            <button className={btn} onClick={() => setShiftMs((s) => s + 30000)}>
              +30s
            </button>
            <button className={btn} onClick={() => setShiftMs((s) => s + 60000)}>
              +1m
            </button>
            <button className={btn} onClick={() => setShiftMs((s) => s + 5 * 60000)}>
              +5m
            </button>
            <button className={btn} onClick={() => setShiftMs((s) => s + 15 * 60000)}>
              +15m
            </button>
          </div>
        </section>

        {/* Config */}
        <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">Settings</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-400">
              Event name
              <input
                className={input}
                value={data.config.eventName}
                onChange={(e) => updateConfig({ eventName: e.target.value })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Anti-snipe window (s)
              <input
                type="number"
                className={input}
                value={data.config.extensionWindowSeconds}
                onChange={(e) => updateConfig({ extensionWindowSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Ticket countdown (s)
              <input
                type="number"
                className={input}
                value={data.config.ticketCountdownSeconds}
                onChange={(e) => updateConfig({ ticketCountdownSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-slate-400">
              Urgent threshold (s)
              <input
                type="number"
                className={input}
                value={data.config.urgentThresholdSeconds}
                onChange={(e) => updateConfig({ urgentThresholdSeconds: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>

        {/* Items */}
        <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">
            Items ({data.items.length})
          </div>
          <div className="space-y-2">
            {data.items.map((it, idx) => {
              const featured = preview.featuredItemId === it.id;
              return (
                <div key={it.id} className="rounded-lg bg-black/20 p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="w-6 shrink-0 text-xs text-slate-500">#{it.id}</span>
                    <input
                      className={input}
                      value={it.name}
                      onChange={(e) => updateItem(idx, { name: e.target.value })}
                    />
                    <button
                      className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${
                        featured ? "bg-amber-500/30 text-amber-100" : "bg-white/10 hover:bg-white/20"
                      }`}
                      onClick={() => updateConfig({ featuredItemId: featured ? "" : it.id })}
                      title="Feature this item"
                    >
                      ★
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-400">
                      Bid $
                      <input
                        type="number"
                        className={`${input} w-24`}
                        value={it.currentBid ?? ""}
                        onChange={(e) =>
                          updateItem(idx, {
                            currentBid: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Bidder
                      <input
                        className={`${input} w-32`}
                        value={it.highBidder ?? ""}
                        onChange={(e) => updateItem(idx, { highBidder: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Closes
                      <input
                        type="datetime-local"
                        className={`${input} w-44`}
                        value={isoToLocal(it.baseCloseISO)}
                        onChange={(e) =>
                          updateItem(idx, { baseCloseISO: localToIso(e.target.value) ?? it.baseCloseISO })
                        }
                      />
                    </label>
                    <span className="ml-auto flex gap-1">
                      <button className={btn} onClick={() => placeItemBid(idx, 25)}>
                        +$25
                      </button>
                      <button className={btn} onClick={() => placeItemBid(idx, 100)}>
                        +$100
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Tickets */}
        <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">
            Ticket groups ({groupOrder.length})
          </div>
          <div className="space-y-3">
            {groupOrder.map((group) => {
              const first = data.tickets.find((t) => t.group === group);
              return (
                <div key={group} className="rounded-lg bg-black/20 p-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-bold">{group}</span>
                    <label className="ml-auto text-xs text-slate-400">
                      Cascade start
                      <input
                        type="datetime-local"
                        className={`${input} w-44`}
                        value={isoToLocal(first?.cascadeStartISO)}
                        onChange={(e) => setGroupCascadeStart(group, localToIso(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="space-y-1">
                    {data.tickets.map((t, idx) =>
                      t.group !== group ? null : (
                        <div key={idx} className="flex flex-wrap items-center gap-2">
                          <span className="w-16 shrink-0 text-xs text-slate-400">#{t.label}</span>
                          <label className="text-xs text-slate-400">
                            $
                            <input
                              type="number"
                              className={`${input} w-20`}
                              value={t.currentBid ?? ""}
                              onChange={(e) =>
                                updateTicket(idx, {
                                  currentBid: e.target.value === "" ? undefined : Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <input
                            className={`${input} w-32`}
                            placeholder="bidder"
                            value={t.highBidder ?? ""}
                            onChange={(e) => updateTicket(idx, { highBidder: e.target.value })}
                          />
                          <span className="ml-auto flex gap-1">
                            <button className={btn} onClick={() => placeTicketBid(idx, 5)}>
                              +$5
                            </button>
                            <button className={btn} onClick={() => placeTicketBid(idx, 10)}>
                              +$10
                            </button>
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ---- Live preview ---- */}
      <div className="hidden h-screen overflow-hidden border-l border-white/10 lg:block">
        <DashboardView state={preview} nowMs={previewNow} />
      </div>
    </div>
  );
}
