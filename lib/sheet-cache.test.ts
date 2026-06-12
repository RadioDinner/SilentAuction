import { describe, expect, it } from "vitest";
import { createCachedFetcher } from "./sheet-cache";

function countingFetcher<T>(results: (T | Error)[]) {
  let calls = 0;
  const fetcher = async (): Promise<T> => {
    const r = results[Math.min(calls, results.length - 1)];
    calls++;
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetcher, count: () => calls };
}

describe("createCachedFetcher", () => {
  it("fetches once and serves from cache within the TTL", async () => {
    const { fetcher, count } = countingFetcher(["a"]);
    const get = createCachedFetcher(fetcher, 3000);

    expect((await get(1000)).value).toBe("a");
    expect((await get(2000)).value).toBe("a");
    expect((await get(3999)).value).toBe("a");
    expect(count()).toBe(1);
  });

  it("refetches after the TTL expires", async () => {
    const { fetcher, count } = countingFetcher(["a", "b"]);
    const get = createCachedFetcher(fetcher, 3000);

    expect((await get(1000)).value).toBe("a");
    const later = await get(5000);
    expect(later.value).toBe("b");
    expect(later.fetchedAtMs).toBe(5000);
    expect(count()).toBe(2);
  });

  it("coalesces concurrent callers into one fetch", async () => {
    let release!: (v: string) => void;
    let calls = 0;
    const get = createCachedFetcher(() => {
      calls++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    }, 3000);

    const p1 = get(1000);
    const p2 = get(1001);
    release("a");
    expect((await p1).value).toBe("a");
    expect((await p2).value).toBe("a");
    expect(calls).toBe(1);
  });

  it("serves the last good value with staleError when a refresh fails", async () => {
    const { fetcher } = countingFetcher<string>(["a", new Error("quota exceeded")]);
    const get = createCachedFetcher(fetcher, 3000);

    expect((await get(1000)).value).toBe("a");
    const stale = await get(5000);
    expect(stale.value).toBe("a");
    expect(stale.fetchedAtMs).toBe(1000);
    expect(stale.staleError).toMatch(/quota/);
  });

  it("recovers on the next successful refresh after a failure", async () => {
    const { fetcher } = countingFetcher<string>([
      "a",
      new Error("quota exceeded"),
      "b",
    ]);
    const get = createCachedFetcher(fetcher, 3000);

    await get(1000);
    expect((await get(5000)).staleError).toMatch(/quota/);
    const recovered = await get(9000);
    expect(recovered.value).toBe("b");
    expect(recovered.staleError).toBeUndefined();
  });

  it("throws when the very first fetch fails (nothing to fall back to)", async () => {
    const { fetcher } = countingFetcher<string>([new Error("boom")]);
    const get = createCachedFetcher(fetcher, 3000);
    await expect(get(1000)).rejects.toThrow("boom");
  });
});
