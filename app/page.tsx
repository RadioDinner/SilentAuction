"use client";

import { useEffect, useRef, useState } from "react";
import type { AuctionState } from "@/lib/types";
import { DashboardView } from "@/components/DashboardView";

const POLL_SECONDS = Number(process.env.NEXT_PUBLIC_POLL_SECONDS) || 3;

export default function DashboardPage() {
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

  return (
    <div className="relative h-screen">
      <DashboardView state={state} nowMs={nowMs} adminHref="/admin" />
      {error && (
        <div className="fixed bottom-3 right-3 rounded-full bg-red-500/20 px-3 py-1 text-sm font-bold uppercase tracking-wider text-red-200">
          reconnecting…
        </div>
      )}
    </div>
  );
}
