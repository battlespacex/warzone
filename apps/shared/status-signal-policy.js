// Public status contract. These records inform widgets; they never create map attacks.
export function toPublicStatusSignal(item = {}, now = Date.now()) {
  const signal = item.raw?.status_signal || {};
  const category = String(item.category || "");
  const domain = signal.domain || (/airspace|aviation/.test(category) ? "airspace" : /cyber|internet/.test(category) ? "cyber" : "");
  if (!domain || !item.title) return null;
  const published = Date.parse(item.published_at || "");
  const fetched = Date.parse(item.fetched_at || "");
  const maximumAge = signal.kind === "vulnerability" ? 30 * 86400000 : domain === "airspace" ? 86400000 : 7 * 86400000;
  if (!Number.isFinite(published) || now - published > maximumAge || published > now + 300000) return null;
  let url;
  try { url = new URL(item.url); if (!["http:", "https:"].includes(url.protocol)) return null; } catch { return null; }
  const stale = ["last_known_valid", "source_backoff"].includes(item.raw?.cache_reason) ||
    !Number.isFinite(fetched) || now - fetched > (domain === "airspace" ? 3600000 : 86400000);
  return { id: item.guid || item.id || item.url, domain, kind: signal.kind || "reported_signal",
    status: stale ? "stale" : signal.status || "reported", stale, cached: item.raw?.cached === true,
    title: String(item.title).slice(0, 300), summary: String(item.summary || "").slice(0, 1200),
    source_name: String(item.source_name || ""), source_url: url.href,
    published_at: item.published_at, fetched_at: item.fetched_at,
    country: signal.kind === "vulnerability" ? null : item.country || null,
    coverage: signal.coverage || item.region || "Geographic attribution unavailable" };
}
