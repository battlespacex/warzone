import test from "node:test";
import assert from "node:assert/strict";
import { parseFaaStatus, parseKevStatus } from "../src/official-status-adapters.js";
import { enrichStatusItem } from "../src/status-filter.js";
import { fetchSingleStatusSource } from "../src/status-fetcher.js";
import { resetSourceHealth } from "../src/source-health.js";
import { getEnabledStatusSources } from "../src/status-sources.js";
import { toPublicStatusSignal } from "../../shared/status-signal-policy.js";
import fs from "node:fs";
import vm from "node:vm";

const now = Date.now();
const faa = getEnabledStatusSources().find(s => s.id === "faa-nas-status");
const kev = getEnabledStatusSources().find(s => s.id === "cisa-kev");
const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>${new Date(now).toUTCString()}</Update_Time><Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>Closed to transient traffic except prior permission</Reason><Start>Oct 28</Start></Airport></Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
const catalog = { dateReleased: new Date(now).toISOString(), vulnerabilities: [
  { cveID: "CVE-2026-10001", vulnerabilityName: "Example vulnerability", dateAdded: new Date(now - 86400000).toISOString().slice(0, 10), shortDescription: "Known exploitation; no incident location" },
  { cveID: "CVE-2000-10001", vulnerabilityName: "Historical", dateAdded: "2000-01-01" },
] };

test("official records preserve dates, restrictions and lack of cyber geography", () => {
  const [airport] = parseFaaStatus(xml, faa, now);
  assert.equal(airport.raw.status_signal.status, "restricted", "airport closure must not become nationwide closed airspace");
  assert.match(airport.summary, /except prior permission/);
  assert.equal(airport.country, "United States");
  assert.equal(enrichStatusItem(airport).is_status_relevant, true);
  const items = parseKevStatus(catalog, kev, now);
  assert.equal(items.length, 1);
  const item = toPublicStatusSignal(enrichStatusItem(items[0]), now);
  assert.equal(item.kind, "vulnerability"); assert.equal(item.status, "advisory"); assert.equal(item.country, null);
  assert.equal(item.published_at, catalog.vulnerabilities[0].dateAdded);
  assert.equal("raw" in item, false);
  assert.throws(() => parseFaaStatus("<html>not XML</html>", faa), /Invalid/);
  assert.throws(() => parseFaaStatus(xml.replace(new Date(now).toUTCString(), "Mon, 01 Jan 2001 00:00:00 GMT"), faa), /Stale/);
  assert.throws(() => parseKevStatus({}, kev), /Invalid/);
  assert.equal(parseKevStatus({ ...catalog, vulnerabilities: [] }, kev).length, 0);
  assert.equal(toPublicStatusSignal({ ...items[0], url: "javascript:alert(1)" }), null);
  assert.equal(toPublicStatusSignal({ ...items[0], published_at: "2000-01-01" }), null);
  assert.equal(toPublicStatusSignal({ ...items[0], fetched_at: "2000-01-01" }, now).status, "stale");
});

test("primary failure, official fallback, bounded cache, malformed response and recovery", async () => {
  const original = globalThis.fetch; const urls = [];
  resetSourceHealth();
  const source = { ...kev, id: "reliability-test", cache_ttl_ms: 1 };
  try {
    globalThis.fetch = async (url, options) => { assert.ok(options.signal instanceof AbortSignal); urls.push(url); return url === source.url
      ? new Response("unavailable", { status: 503 }) : Response.json(catalog); };
    const fallback = await fetchSingleStatusSource(source);
    assert.equal(fallback.ok, true); assert.equal(fallback.count, 1); assert.equal(urls.length, 2);
    await new Promise(resolve => setTimeout(resolve, 5));
    globalThis.fetch = async () => new Response("too many", { status: 429, headers: { "Retry-After": "60" } });
    const lastKnown = await fetchSingleStatusSource(source);
    assert.equal(lastKnown.cached, true); assert.equal(lastKnown.health.status, "rate_limited");
    assert.equal(lastKnown.items[0].fetched_at, fallback.items[0].fetched_at);
    assert.equal(toPublicStatusSignal(lastKnown.items[0]).stale, true);
    resetSourceHealth();
    globalThis.fetch = async () => Response.json({ wrong: true });
    assert.equal((await fetchSingleStatusSource({ ...source, id: "invalid-test" })).ok, false);
    resetSourceHealth();
    globalThis.fetch = async () => Response.json(catalog);
    const recovered = await fetchSingleStatusSource(source);
    assert.equal(recovered.ok, true); assert.equal(recovered.cached, undefined);
    assert.equal(recovered.health.consecutive_failures, 0);
  } finally { globalThis.fetch = original; resetSourceHealth(); }
});

test("status widgets filter actual coverage and label unattributed vulnerability guidance without inventing incidents",()=>{
  const source=fs.readFileSync(new URL("../../../dev/assets/js/essential.js",import.meta.url),'utf8');
  const start=source.indexOf('function renderStatusFeedRows(');
  const context=vm.createContext({__statusFeedItemsCache:[toPublicStatusSignal(parseFaaStatus(xml,faa)[0]),toPublicStatusSignal(parseKevStatus(catalog,kev)[0])],
    __statusFeedUnavailable:false,getActiveRegion:()=>({id:'middle_east'}),getRegionCountryWhitelist:()=>new Set(['Saudi Arabia']),
    normalizeCountryName:x=>x,countryNameFromCode:()=>'',escapeHtml:x=>String(x).replace(/</g,'&lt;'),URL});
  vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
  let html='';const container={insertAdjacentHTML:(_,markup)=>{html+=markup;}};
  assert.equal(context.renderStatusFeedRows(container,'airspace'),false);
  assert.equal(context.renderStatusFeedRows(container,'cyber'),true);
  assert.match(html,/Vulnerability advisory/);assert.match(html,/geographic attribution unavailable/);
  assert.doesNotMatch(html,/critical|attack in Saudi Arabia/i);
});
