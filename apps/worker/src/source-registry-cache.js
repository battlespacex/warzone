// Bounded, short-lived configuration cache. Errors are never cached as permissions.
export function createSourceRegistryCache({ db, clock = Date.now, ttlMs = 60000, maxEntries = 512 } = {}) {
  const values = new Map();
  const pending = new Map();
  const metrics = { reads: 0, hits: 0, coalesced: 0, errors: 0 };
  let generation = 0;
  return {
    metrics,
    invalidate() { generation++; values.clear(); pending.clear(); },
    async get(name) {
      if (!name) return null;
      const cached = values.get(name);
      if (cached && cached.until > clock()) { metrics.hits++; return cached.value; }
      if (pending.has(name)) { metrics.coalesced++; return pending.get(name); }
      const requestGeneration = generation;
      const request = Promise.resolve().then(async () => {
        metrics.reads++;
        try {
          const { data, error } = await db.from("source_registry").select("*").eq("source_name", name).maybeSingle();
          if (error) { metrics.errors++; return null; }
          if (generation === requestGeneration) {
            values.delete(name);
            values.set(name, { value: data || null, until: clock() + (data ? ttlMs : Math.min(ttlMs, 5000)) });
            while (values.size > maxEntries) values.delete(values.keys().next().value);
          }
          return data || null;
        } catch { metrics.errors++; return null;
        } finally { if (pending.get(name) === request) pending.delete(name); }
      });
      pending.set(name, request);
      return request;
    },
  };
}
