// M7-13c-2c-b — a tiny in-memory TTL cache for the few reads every chat turn repeats (app settings, the client profile, the
// budget gate). Deliberately small and explicit:
//   - the caller builds the KEY (it MUST include the tenant — see the cross-tenant test), this class never guesses one;
//   - an injectable clock, so expiry is tested without real timers;
//   - concurrent loads of one key share ONE in-flight promise (two reads started in the same tick cost one round trip);
//   - a rejected load is never cached;
//   - every instance registers itself so clearAllTtlCaches() can drop everything (saveSettings() calls it).
// The TTLs chosen at the call sites are short on purpose (see chatReads in settings-service / clientProfile / entitlements).

export type Clock = () => number;

interface Entry<V> { at: number; value?: V; promise?: Promise<V> }

const registry = new Set<TtlCache<unknown>>();

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  constructor(public readonly ttlMs: number, private clock: Clock = Date.now) {
    registry.add(this as TtlCache<unknown>);
  }

  /** Test-only: replace the clock. */
  setClockForTesting(clock: Clock): void { this.clock = clock; }

  private fresh(e: Entry<V>): boolean { return this.clock() - e.at < this.ttlMs; }

  /** The cached value for `key` when it is still fresh, else undefined. */
  peek(key: string): V | undefined {
    const e = this.store.get(key);
    return e && e.value !== undefined && this.fresh(e) ? e.value : undefined;
  }

  /** Cached value, or a single shared load. `loader` runs at most once per key per TTL window. */
  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    const e = this.store.get(key);
    if (e && this.fresh(e)) {
      if (e.value !== undefined) return e.value;
      if (e.promise) return e.promise;
    }
    const promise = loader().then(
      (value) => {
        const cur = this.store.get(key);
        if (cur && cur.promise === promise) this.store.set(key, { at: this.clock(), value });
        return value;
      },
      (err) => {
        const cur = this.store.get(key);
        if (cur && cur.promise === promise) this.store.delete(key);
        throw err;
      },
    );
    this.store.set(key, { at: this.clock(), promise });
    return promise;
  }

  delete(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  get size(): number { return this.store.size; }
}

/** Drop every cached value of every TtlCache (a settings/profile save calls this). */
export function clearAllTtlCaches(): void {
  registry.forEach((c) => c.clear());
}

/** Key helper: tenant-scoped, and a missing tenant is its own distinct scope rather than a wildcard. */
export function tenantKey(tenantId: string | null | undefined): string {
  return tenantId ? `t:${tenantId}` : 'none';
}
