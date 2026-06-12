// TTL cache + in-flight coalescing for the Google Sheet read, so any number of
// dashboards polling the server share one Sheets API call per interval
// (Google's quota is 60 read requests/min per user). If a refresh fails, the
// last good value is served with `staleError` set instead of throwing.

export interface CachedResult<T> {
  value: T;
  /** When `value` was actually fetched (epoch ms). */
  fetchedAtMs: number;
  /** Set when a fresh fetch failed and `value` is the last good snapshot. */
  staleError?: string;
}

export function createCachedFetcher<T>(
  fetcher: () => Promise<T>,
  ttlMs: number,
): (nowMs?: number) => Promise<CachedResult<T>> {
  let last: { value: T; fetchedAtMs: number } | undefined;
  let inflight: Promise<{ value: T; fetchedAtMs: number }> | undefined;

  return async function get(nowMs = Date.now()): Promise<CachedResult<T>> {
    if (last && nowMs - last.fetchedAtMs < ttlMs) return { ...last };

    if (!inflight) {
      inflight = fetcher()
        .then((value) => {
          last = { value, fetchedAtMs: nowMs };
          return last;
        })
        .finally(() => {
          inflight = undefined;
        });
    }

    try {
      return { ...(await inflight) };
    } catch (err) {
      if (last) {
        return {
          ...last,
          staleError: err instanceof Error ? err.message : String(err),
        };
      }
      throw err;
    }
  };
}
