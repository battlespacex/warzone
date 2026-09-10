// Source-hosted Copernicus quicklooks only; no credentials or cached bucket URLs.
const catalogue = "https://catalogue.dataspace.copernicus.eu/odata/v1";
const previews = new Map();

export function isSatelliteSourcePreviewUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://catalogue.dataspace.copernicus.eu"
      && /^\/odata\/v1\/Assets\([a-f0-9-]{36}\)\/\$value$/i.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export async function resolveSatelliteSourcePreview(row = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (isSatelliteSourcePreviewUrl(row.image_url)) return row.image_url;
  const name = String(row.source_item_id || "").trim();
  if (!name || name.length > 240) return null;
  const cached = previews.get(name);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    try {
      const url = new URL(`${catalogue}/Products`);
      url.searchParams.set("$filter", `Name eq '${name.replace(/'/g, "''")}'`);
      url.searchParams.set("$expand", "Assets");
      url.searchParams.set("$top", "1");
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), redirect: "error" });
      if (!response.ok) return null;
      const data = await response.json();
      const product = data.value?.find((item) => item.Name === name);
      return product?.Assets?.find((asset) => asset.Type === "QUICKLOOK"
        && isSatelliteSourcePreviewUrl(asset.DownloadLink))?.DownloadLink || null;
    } catch { return null; }
  })();
  if (previews.size >= 300) previews.delete(previews.keys().next().value);
  previews.set(name, { promise, expires: Date.now() + 5 * 60_000 });
  const result = await promise;
  if (result) previews.set(name, { promise: Promise.resolve(result), expires: Date.now() + 24 * 60 * 60_000 });
  return result;
}
