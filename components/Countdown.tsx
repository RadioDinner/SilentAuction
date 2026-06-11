import { formatCountdown, secsLeft } from "@/lib/format";

export function Countdown({
  iso,
  nowMs,
  urgentSeconds = 120,
  className = "",
}: {
  iso: string | undefined;
  nowMs: number;
  urgentSeconds?: number;
  className?: string;
}) {
  const left = secsLeft(iso, nowMs);
  const closed = left <= 0;
  const urgent = !closed && left <= urgentSeconds;

  const color = closed
    ? "text-slate-500"
    : urgent
      ? "text-red-400 animate-pulse-urgent"
      : "text-emerald-300";

  return (
    <span className={`tabular-nums font-bold ${color} ${className}`}>
      {formatCountdown(left)}
    </span>
  );
}
