// Public, key-free government feeds. Never infer incident geography from publisher location.
function text(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  return text(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] || "");
}
export function parseFaaStatus(xml, source, now = Date.now()) {
  // Fixed FAA XML contract; no external entities, DTD loading or arbitrary XML execution.
  if (typeof xml !== "string" || xml.length > 2e6 || !xml.includes("<AIRPORT_STATUS_INFORMATION>") ||
    !xml.includes("</AIRPORT_STATUS_INFORMATION>")) throw new Error("Invalid FAA XML");
  const updated = tag(xml, "Update_Time");
  const observed = Date.parse(updated);
  if (!Number.isFinite(observed)) throw new Error("Invalid FAA update timestamp");
  if (now - observed > 6 * 3600000 || observed > now + 300000) throw new Error("Stale FAA snapshot");
  const items = [];
  for (const group of xml.matchAll(/<Delay_type>([\s\S]*?)<\/Delay_type>/g)) {
    const name = tag(group[1], "Name");
    for (const airport of group[1].matchAll(/<Airport>([\s\S]*?)<\/Airport>/g)) {
      const code = tag(airport[1], "ARPT"), reason = tag(airport[1], "Reason");
      if (!/^[A-Z0-9]{3,4}$/.test(code) || !reason) continue;
      const restriction = /closures|ground stop/i.test(name);
      items.push({ source_id: source.id, source_name: source.name, source_type: source.type,
        source_category: source.category, title: `${code}: ${name}`, summary: reason,
        guid: `faa:${code}:${name}:${reason}`, url: `https://nasstatus.faa.gov/#${encodeURIComponent(`${code}:${name}:${reason}`)}`,
        country: "United States", region: "United States", published_at: new Date(observed).toISOString(),
        fetched_at: new Date(now).toISOString(),
        raw: { status_signal: { domain: "airspace", kind: restriction ? "airport_restriction" : "advisory",
          status: restriction ? "restricted" : "advisory", coverage: "United States", observed_at: updated },
          airport: code, reason, start: tag(airport[1], "Start"), reopen: tag(airport[1], "Reopen") } });
    }
  }
  return items;
}
export function parseKevStatus(payload, source, now = Date.now()) {
  if (!Array.isArray(payload?.vulnerabilities) || !Number.isFinite(Date.parse(payload.dateReleased))) throw new Error("Invalid KEV JSON");
  return payload.vulnerabilities.filter(item => /^CVE-\d{4}-\d+$/.test(item.cveID || "") && item.vulnerabilityName &&
    Number.isFinite(Date.parse(item.dateAdded)) && now - Date.parse(item.dateAdded) <= 30 * 86400000 && Date.parse(item.dateAdded) <= now)
    .map(item => ({ source_id: source.id, source_name: source.name, source_type: source.type,
      source_category: source.category, title: `${item.cveID}: ${text(item.vulnerabilityName)}`,
      summary: text(item.shortDescription), guid: `cisa-kev:${item.cveID}`,
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog#${item.cveID}`, published_at: item.dateAdded,
      fetched_at: new Date(now).toISOString(), country: null, region: null,
      raw: { status_signal: { domain: "cyber", kind: "vulnerability", status: "advisory", coverage: "Global; geographic attribution unavailable" },
        cve: item.cveID, dateAdded: item.dateAdded, requiredAction: item.requiredAction, catalog_version: payload.catalogVersion,
        catalog_released_at: payload.dateReleased } }));
}
