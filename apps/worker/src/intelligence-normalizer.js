import crypto from "crypto";
import {
  LOCATION_PRECISION,
  isMapMarkerPrecision,
  isUnsafeLocationMethod,
  normalizeLocationPrecision,
  readEventLocation
} from "../../shared/event-location-policy.js";
import { OPERATIONAL_LOCATION_CATALOG } from "./operational-location-catalog.js";
import { aggregateEventQuality, readEventQuality } from "./event-quality.js";
import { CORROBORATION_STATES, resolveSourceProfile } from "../../shared/source-quality-policy.js";

const NORMALIZATION_VERSION = "2026-08-08.location-v2";

const UNKNOWN_TEXT_RE =
  /^(unknown|unknown source|unknown location|unknown origin|reported location|untitled|untitled event|n\/a|null|undefined|-)+$/i;

const OPERATIONAL_EVENT_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strike|strikes|struck|attack|attacks|attacked|shelling|artillery|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|troop movement|deployed|deployment|convoy|patrol|sortie|scramble|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|spotted|detected|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const LIVE_HAPPENING_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strikes|struck|attacks|attacked|shelling|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const INTEL_WIRE_ONLY_NEWS_RE =
  /\b(contract|contract award|procurement|acquisition|arms deal|arms sale|arms sales|foreign military sale|foreign military sales|fms|budget|funding|lawmakers|approved sale|purchase|order|program|prototype|production|manufacturing|shipbuilding|industry|startup)\b/i;

const LEGACY_EVENT_LOCATION_CATALOG = [
  {
    label: "Gaza",
    lat: 31.5,
    lon: 34.45,
    country: "Palestinian Territories",
    region: "Middle East",
    theatre: "Israel-Gaza",
    precision: "area",
    aliases: ["gaza", "rafah", "khan younis", "deir al-balah", "jabalia"]
  },
  {
    label: "West Bank",
    lat: 31.9,
    lon: 35.2,
    country: "Palestinian Territories",
    region: "Middle East",
    theatre: "Israel-West Bank",
    precision: "area",
    aliases: ["west bank", "jenin", "nablus", "tulkarm", "ramallah"]
  },
  {
    label: "Israel",
    lat: 31.8,
    lon: 35.0,
    country: "Israel",
    region: "Middle East",
    theatre: "Israel",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["israel", "israeli"]
  },
  {
    label: "Lebanon",
    lat: 33.9,
    lon: 35.8,
    country: "Lebanon",
    region: "Middle East",
    theatre: "Lebanon",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["lebanon", "lebanese"]
  },
  {
    label: "Beirut, Lebanon",
    lat: 33.89,
    lon: 35.5,
    country: "Lebanon",
    region: "Middle East",
    theatre: "Lebanon",
    precision: "city",
    aliases: ["beirut"]
  },
  {
    label: "Syria",
    lat: 35.0,
    lon: 38.5,
    country: "Syria",
    region: "Middle East",
    theatre: "Syria",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["syria", "syrian"]
  },
  {
    label: "Damascus, Syria",
    lat: 33.51,
    lon: 36.29,
    country: "Syria",
    region: "Middle East",
    theatre: "Syria",
    precision: "city",
    aliases: ["damascus"]
  },
  {
    label: "Aleppo, Syria",
    lat: 36.2,
    lon: 37.16,
    country: "Syria",
    region: "Middle East",
    theatre: "Syria",
    precision: "city",
    aliases: ["aleppo"]
  },
  {
    label: "Iraq",
    lat: 33.2,
    lon: 43.7,
    country: "Iraq",
    region: "Middle East",
    theatre: "Iraq",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["iraq", "iraqi"]
  },
  {
    label: "Erbil, Iraq",
    lat: 36.19,
    lon: 44.01,
    country: "Iraq",
    region: "Middle East",
    theatre: "Iraq",
    precision: "city",
    aliases: ["erbil"]
  },
  {
    label: "Iran",
    lat: 32.0,
    lon: 53.0,
    country: "Iran",
    region: "Middle East",
    theatre: "Iran",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["iran", "iranian"]
  },
  {
    label: "Tehran, Iran",
    lat: 35.69,
    lon: 51.39,
    country: "Iran",
    region: "Middle East",
    theatre: "Iran",
    precision: "city",
    aliases: ["tehran"]
  },
  {
    label: "Isfahan, Iran",
    lat: 32.65,
    lon: 51.67,
    country: "Iran",
    region: "Middle East",
    theatre: "Iran",
    precision: "city",
    aliases: ["isfahan", "isfahan"]
  },
  {
    label: "Yemen",
    lat: 15.5,
    lon: 47.5,
    country: "Yemen",
    region: "Middle East",
    theatre: "Yemen",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["yemen", "yemeni", "houthi", "houthis"]
  },
  {
    label: "Red Sea",
    lat: 18.0,
    lon: 39.0,
    country: null,
    region: "Middle East",
    theatre: "Red Sea",
    precision: "maritime_area",
    aliases: ["red sea", "gulf of aden", "aden gulf", "bab el-mandeb", "bab al-mandab"]
  },
  {
    label: "Constanta, Romania",
    lat: 44.16,
    lon: 28.64,
    country: "Romania",
    region: "Europe",
    theatre: "Black Sea",
    precision: "city",
    aliases: ["constanta", "romanian port"]
  },
  {
    label: "Black Sea",
    lat: 44.0,
    lon: 35.0,
    country: null,
    region: "Europe",
    theatre: "Black Sea",
    precision: "maritime_area",
    aliases: ["black sea"]
  },
  {
    label: "Crimea",
    lat: 45.3,
    lon: 34.2,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "area",
    aliases: ["crimea", "sevastopol"]
  },
  {
    label: "Kharkiv, Ukraine",
    lat: 49.99,
    lon: 36.23,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["kharkiv", "kharkov"]
  },
  {
    label: "Chuhuiv, Ukraine",
    lat: 49.84,
    lon: 36.69,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["chuhuiv", "chuguev"]
  },
  {
    label: "Chernihiv, Ukraine",
    lat: 51.5,
    lon: 31.29,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["chernihiv", "chernigov"]
  },
  {
    label: "Kyiv, Ukraine",
    lat: 50.45,
    lon: 30.52,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["kyiv", "kiev"]
  },
  {
    label: "Odesa, Ukraine",
    lat: 46.48,
    lon: 30.73,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["odesa", "odessa"]
  },
  {
    label: "Donetsk, Ukraine",
    lat: 48.02,
    lon: 37.8,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["donetsk", "bakhmut", "avdiivka", "pokrovsk"]
  },
  {
    label: "Zaporizhzhia, Ukraine",
    lat: 47.84,
    lon: 35.14,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["zaporizhzhia", "zaporizhia", "enerhodar"]
  },
  {
    label: "Kherson, Ukraine",
    lat: 46.64,
    lon: 32.62,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "city",
    aliases: ["kherson"]
  },
  {
    label: "Ukraine",
    lat: 49.0,
    lon: 32.0,
    country: "Ukraine",
    region: "Europe",
    theatre: "Ukraine",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["ukraine", "ukrainian"]
  },
  {
    label: "Russia",
    lat: 55.0,
    lon: 38.0,
    country: "Russia",
    region: "Europe",
    theatre: "Russia",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["russia", "russian"]
  },
  {
    label: "Belgorod, Russia",
    lat: 50.6,
    lon: 36.59,
    country: "Russia",
    region: "Europe",
    theatre: "Russia",
    precision: "city",
    aliases: ["belgorod"]
  },
  {
    label: "Kursk, Russia",
    lat: 51.73,
    lon: 36.19,
    country: "Russia",
    region: "Europe",
    theatre: "Russia",
    precision: "city",
    aliases: ["kursk"]
  },
  {
    label: "Taiwan Strait",
    lat: 24.0,
    lon: 119.5,
    country: null,
    region: "Indo-Pacific",
    theatre: "Taiwan Strait",
    precision: "maritime_area",
    aliases: ["taiwan strait"]
  },
  {
    label: "Taiwan",
    lat: 23.8,
    lon: 121.0,
    country: "Taiwan",
    region: "Indo-Pacific",
    theatre: "Taiwan",
    precision: "country_hint",
    mapEligible: false,
    aliases: ["taiwan", "taipei"]
  },
  {
    label: "South China Sea",
    lat: 12.0,
    lon: 114.0,
    country: null,
    region: "Indo-Pacific",
    theatre: "South China Sea",
    precision: "maritime_area",
    aliases: ["south china sea", "spratly", "scarborough shoal", "paracel"]
  },
  {
    label: "Kashmir",
    lat: 34.0,
    lon: 75.0,
    country: null,
    region: "South Asia",
    theatre: "Kashmir",
    precision: "area",
    aliases: ["kashmir", "line of control", "jammu"]
  }
];

const EVENT_LOCATION_CATALOG = [
  ...OPERATIONAL_LOCATION_CATALOG,
  ...LEGACY_EVENT_LOCATION_CATALOG
];

const COARSE_COUNTRY_CENTROIDS = [
  { label: "Israel", lat: 31.8, lon: 35.0 },
  { label: "Iran", lat: 32.0, lon: 53.0 },
  { label: "Yemen", lat: 15.5, lon: 47.5 },
  { label: "Syria", lat: 35.0, lon: 38.5 },
  { label: "Iraq", lat: 33.2, lon: 43.7 },
  { label: "Ukraine", lat: 49.0, lon: 32.0 },
  { label: "Russia", lat: 55.0, lon: 38.0 },
  { label: "Taiwan", lat: 23.8, lon: 121.0 },
  { label: "Lebanon", lat: 33.9, lon: 35.8 },
  { label: "Middle East", lat: 29.5, lon: 45.0 },
  { label: "Middle East & Gulf", lat: 27.5, lon: 48.0 },
  { label: "Eastern Europe", lat: 49.0, lon: 30.0 },
  { label: "Europe", lat: 52.0, lon: 15.0 },
  { label: "East Asia", lat: 31.0, lon: 121.0 },
  { label: "Asia Pacific", lat: 24.0, lon: 121.0 },
  { label: "South Asia", lat: 28.0, lon: 78.0 },
  { label: "North America", lat: 39.0, lon: -98.0 },
  { label: "Africa", lat: 12.0, lon: 20.0 },
  { label: "Latin America", lat: 12.0, lon: -75.0 }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isBlankOrUnknown(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return !cleaned || UNKNOWN_TEXT_RE.test(cleaned);
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayText(value = "", maxLength = 900) {
  const cleaned = stripHtml(value)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+\|\s+[^|]{2,40}$/g, "")
    .replace(/\s+-\s+(Reuters|AP|AFP|TASS|Interfax|BBC|CNN|Al Jazeera|The Guardian)$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isBlankOrUnknown(cleaned)) return null;
  return cleaned.slice(0, maxLength);
}

function cleanTitle(value = "") {
  const title = cleanDisplayText(value, 240);
  if (!title) return null;
  if (/^(breaking|update|live)\s*:?$/i.test(title)) return null;
  return title;
}

function safeDate(value) {
  if (!value) return null;
  const cleaned = String(value)
    .replace(" - ", " ")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSourceName(value = "") {
  const source = cleanDisplayText(value, 120);
  if (!source) return null;
  return source
    .replace(/^rss\s*feed$/i, "OSINT Feed")
    .replace(/^conflict\s*feed$/i, "OSINT Feed");
}

function getItemText(item = {}) {
  return [item.title, item.summary, item.source_category]
    .filter(Boolean)
    .join(" ");
}

function hasOperationalEventSignal(text = "") {
  return OPERATIONAL_EVENT_SIGNAL_RE.test(String(text || ""));
}

function hasLiveHappeningSignal(text = "") {
  return LIVE_HAPPENING_SIGNAL_RE.test(String(text || ""));
}

function isIntelWireOnlyNewsText(text = "") {
  const value = String(text || "");
  return INTEL_WIRE_ONLY_NEWS_RE.test(value) && !hasLiveHappeningSignal(value);
}

function isValidCoordinate(latValue, lonValue) {
  const lat = safeNumber(latValue);
  const lon = safeNumber(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return false;
  return true;
}

function isCoarseCountryCentroid(latValue, lonValue, labelValue = "") {
  const lat = safeNumber(latValue);
  const lon = safeNumber(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const label = normalizeLocationLabel(labelValue);
  return COARSE_COUNTRY_CENTROIDS.some((entry) => {
    const coordinateMatch =
      Math.abs(lat - entry.lat) < 0.000001 &&
      Math.abs(lon - entry.lon) < 0.000001;
    if (!coordinateMatch) return false;
    return !label || label.toLowerCase() === entry.label.toLowerCase();
  });
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAlias(text = "", alias = "") {
  const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

function scoreLocationMatch(entry, alias, source, index) {
  let score = source === "title" ? 70 : source === "summary" ? 52 : 44;
  const precision = normalizeLocationPrecision(entry.precision);
  if (precision === LOCATION_PRECISION.EXACT) score += 34;
  else if (precision === LOCATION_PRECISION.LOCAL) score += 20;
  else if (precision === LOCATION_PRECISION.REGIONAL) score += 8;
  if (entry.precision === "country_hint") score -= 28;
  score += Math.min(12, alias.length);
  if (index >= 0 && index < 80) score += 5;
  return score;
}

function hasIncidentLocationContext(text = "", alias = "", index = -1) {
  if (index < 0) return false;
  const before = String(text || "").slice(Math.max(0, index - 70), index).toLowerCase();
  const after = String(text || "").slice(index + String(alias || "").length, index + String(alias || "").length + 55).toLowerCase();
  if (/\b(?:source|official|government|ministry|newspaper|agency)\s+(?:says?|said|reports?|reported)\s*$/.test(before)) return false;
  if (/\b(?:will|could|may|might)\s+(?:halt|stop|end|resume|launch)\b/.test(after)) return false;
  if (/\b(?:in|near|at|around|outside|over|from|toward|towards|into|across|north of|south of|east of|west of)\s*$/.test(before)) return true;
  if (/\b(?:strike|strikes|struck|attack|attacked|hit|hits|explosion|blast|intercepted|shelling|artillery|raid|crash|fire)\s+(?:reported\s+)?$/.test(before)) return true;
  if (/^\s*[,;:\-]?\s*(?:was|were|is|has been|hit|struck|attacked|shelled|bombed|exploded|intercepted|reports?|reported)\b/.test(after)) return true;
  if (!before.trim() && /^\s*[,;:\-]?\s*(?:drone|missile|rocket|airstrike|strike|attack|explosion|blast|shelling|artillery|raid|fire)\b/.test(after)) return true;
  return false;
}

function hasExplicitLocationPreposition(text = "", index = -1) {
  if (index < 0) return false;
  const before = String(text || "").slice(Math.max(0, index - 28), index).toLowerCase();
  return /\b(?:in|near|at|around|outside|over|from|toward|towards|into|across|north of|south of|east of|west of)\s*$/.test(before);
}

function findTextLocationCandidates(text = "", source = "summary") {
  const candidates = [];
  for (const entry of EVENT_LOCATION_CATALOG) {
    for (const alias of entry.aliases || []) {
      const index = matchAlias(text, alias);
      if (index === -1) continue;
      const precision = normalizeLocationPrecision(entry.precision);
      const incidentContext = hasIncidentLocationContext(text, alias, index);
      if (entry.precision === "country_hint" && !hasExplicitLocationPreposition(text, index)) {
        continue;
      }
      if (
        (precision === LOCATION_PRECISION.EXACT || precision === LOCATION_PRECISION.LOCAL) &&
        !incidentContext
      ) {
        continue;
      }
      candidates.push({
        ...entry,
        matched_alias: alias,
        match_source: source,
        match_index: index,
        proximity_qualified: /\b(?:near|around|outside|outskirts of)\s*$/i.test(
          String(text || "").slice(Math.max(0, index - 24), index)
        ),
        incident_context: incidentContext,
        score: scoreLocationMatch(entry, alias, source, index)
      });
    }
  }
  return candidates;
}

function extractCoordinatesFromText(text = "") {
  const match = String(text || "").match(/(-?\d{1,2}\.\d{2,8})\s*[, ]\s*(-?\d{1,3}\.\d{2,8})/);
  if (!match) return null;
  const lat = safeNumber(match[1]);
  const lon = safeNumber(match[2]);
  if (!isValidCoordinate(lat, lon)) return null;
  return {
    lat,
    lon,
    label: `${lat}, ${lon}`,
    country: null,
    region: null,
    theatre: null,
    precision: LOCATION_PRECISION.EXACT,
    detail: "exact_coordinates",
    method: "text_coordinates",
    source: "text_coordinates",
    confidence: 100,
    city: null,
    place: null,
    quality: "exact",
    mapEligible: true
  };
}

function normalizeLocationLabel(value = "") {
  const label = cleanDisplayText(value, 120);
  return label && !/reported location/i.test(label) && !/^coordinates$/i.test(label) ? label : null;
}

function normalizeSeverity(value = "", fallback = "medium") {
  const severity = String(value || "").trim().toLowerCase();
  return ["critical", "high", "medium", "low"].includes(severity) ? severity : fallback;
}

function normalizeCategory(value = "", fallback = "military") {
  const category = cleanDisplayText(value, 80);
  return category ? category.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") : fallback;
}

function buildEventTitleFallback(event = {}) {
  const category = normalizeCategory(event.category, "activity").replace(/[_-]+/g, " ");
  const location = normalizeLocationLabel(
    event.location_label ||
    event.impact_label ||
    event.origin_label ||
    event.city ||
    event.country ||
    event.region
  );
  const label = category.replace(/\b\w/g, (char) => char.toUpperCase());
  return location ? `${label} near ${location}` : `${label} update`;
}

function getNestedObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function valuesShareCoordinates(latA, lonA, latB, lonB) {
  return (
    isValidCoordinate(latA, lonA) &&
    isValidCoordinate(latB, lonB) &&
    Math.abs(Number(latA) - Number(latB)) < 0.000001 &&
    Math.abs(Number(lonA) - Number(lonB)) < 0.000001
  );
}

function isSourceDerivedCoordinate(item = {}, latValue = item.lat, lonValue = item.lon) {
  const location = readEventLocation(item);
  if (location.method && isUnsafeLocationMethod(location.method)) return true;
  const metadata = getNestedObject(item.metadata);
  const normalization = getNestedObject(metadata.normalization);
  const sourceLat = item.source_lat ?? item.publisher_lat ?? normalization.source_lat ?? normalization.publisher_lat;
  const sourceLon = item.source_lon ?? item.publisher_lon ?? normalization.source_lon ?? normalization.publisher_lon;
  return valuesShareCoordinates(latValue, lonValue, sourceLat, sourceLon);
}

function collectEntityText(value, output = []) {
  if (!value || output.length >= 24) return output;
  if (typeof value === "string") {
    const cleaned = cleanDisplayText(value, 500);
    if (cleaned) output.push(cleaned);
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 16).forEach((entry) => collectEntityText(entry, output));
    return output;
  }
  if (typeof value !== "object") return output;
  ["name", "text", "label", "place", "location", "city", "region", "country", "description", "content", "message", "caption"]
    .forEach((key) => collectEntityText(value[key], output));
  return output;
}

function getLocationTextSources(item = {}) {
  const raw = getNestedObject(item.raw);
  const metadata = getNestedObject(item.metadata);
  const entityText = collectEntityText(
    item.entities || metadata.entities || raw.entities || raw.locations || raw.places
  );
  return [
    ["title", item.title],
    ["summary", item.summary || item.normalized_summary],
    ["description", item.description],
    ["payload", item.text || item.message || item.caption || item.location_hint],
    ["payload", raw.title || raw.raw_title],
    ["payload", raw.summary || raw.description || raw.contentSnippet || raw.content || raw.raw_text || raw.text || raw.message || raw.caption],
    ...entityText.map((value) => ["entities", value])
  ]
    .map(([source, value]) => [source, cleanDisplayText(value, 2000) || ""])
    .filter(([, value]) => value);
}

function getSourceGeography(item = {}) {
  const raw = getNestedObject(item.raw);
  const metadata = getNestedObject(item.metadata);
  const normalization = getNestedObject(metadata.normalization);
  return {
    country: cleanDisplayText(
      item.source_country || item.publisher_country || raw.source_country || raw.publisher_country || normalization.source_country || normalization.publisher_country,
      80
    ),
    region: cleanDisplayText(
      item.source_region || item.publisher_region || raw.source_region || raw.publisher_region || normalization.source_region || normalization.publisher_region,
      80
    )
  };
}

function getEventGeographyHints(item = {}) {
  const raw = getNestedObject(item.raw);
  const metadata = getNestedObject(item.metadata);
  const normalization = getNestedObject(metadata.normalization);
  const reliefWebCountry = String(item.source_id || "").toLowerCase() === "reliefweb-reports"
    ? item.country
    : null;
  return {
    country: cleanDisplayText(item.event_country || raw.event_country || normalization.event_country || reliefWebCountry, 80),
    region: cleanDisplayText(item.event_region || raw.event_region || normalization.event_region, 120),
    city: cleanDisplayText(item.event_city || raw.event_city || normalization.event_city, 120),
    place: cleanDisplayText(item.event_place || raw.event_place || normalization.event_place, 160)
  };
}

function buildLocationMetadata(event = {}, location = {}) {
  const metadata = getNestedObject(event.metadata);
  const existingNormalization = getNestedObject(metadata.normalization);
  const sourceGeography = getSourceGeography(event);
  const hasEventPoint = isValidCoordinate(location.lat, location.lon);
  const hasRegionalAnchor = isValidCoordinate(location.anchor_lat, location.anchor_lon);
  return {
    ...metadata,
    event_location: {
      ...getNestedObject(metadata.event_location),
      country: location.country || null,
      region: location.region || null,
      city: location.city || null,
      place: location.place || null,
      latitude: hasEventPoint ? Number(location.lat) : null,
      longitude: hasEventPoint ? Number(location.lon) : null,
      regional_anchor_latitude: hasRegionalAnchor ? Number(location.anchor_lat) : null,
      regional_anchor_longitude: hasRegionalAnchor ? Number(location.anchor_lon) : null,
      precision: location.precision || LOCATION_PRECISION.UNKNOWN,
      confidence: Number.isFinite(Number(location.confidence)) ? Number(location.confidence) : 0,
      method: location.method || location.source || "not_found"
    },
    normalization: {
      ...existingNormalization,
      version: NORMALIZATION_VERSION,
      map_eligible: location.mapEligible === true,
      location_quality: location.quality || "unknown",
      location_precision: location.precision || LOCATION_PRECISION.UNKNOWN,
      location_detail: location.detail || null,
      location_confidence: Number.isFinite(Number(location.confidence)) ? Number(location.confidence) : 0,
      location_method: location.method || location.source || "not_found",
      location_source: location.source || location.method || "not_found",
      matched_alias: location.matched_alias || null,
      location_score: Number.isFinite(Number(location.score)) ? Number(location.score) : 0,
      event_country: location.country || null,
      event_region: location.region || null,
      event_city: location.city || null,
      event_place: location.place || null,
      source_country: sourceGeography.country || null,
      source_region: sourceGeography.region || null,
      publisher_country: sourceGeography.country || null,
      publisher_region: sourceGeography.region || null
    }
  };
}

function normalizeEventRowForStorage(event = {}) {
  if (!event || typeof event !== "object") return null;
  const location = resolveEventLocation(event);
  const locationLabel = normalizeLocationLabel(location.label || event.location_label);
  const title = cleanTitle(event.title) || buildEventTitleFallback(event);
  const summary = cleanDisplayText(event.summary, 1500) || title;
  const impactLabel = normalizeLocationLabel(event.impact_label);
  const originLabel = normalizeLocationLabel(event.origin_label);
  const sourceName = normalizeSourceName(event.source_name);

  const locationMetadata = buildLocationMetadata(event, location);
  const existingQuality = readEventQuality(event);
  const baseQuality = Array.isArray(existingQuality.source_provenance)
    ? existingQuality
    : aggregateEventQuality([event]);
  const eventFingerprint = makeEventFingerprint(event, {
    category: normalizeCategory(event.category, "military"),
    location,
  });
  return {
    ...event,
    category: normalizeCategory(event.category, "military"),
    title,
    summary,
    source_name: sourceName || null,
    lat: location.mapEligible ? safeNumber(location.lat) : null,
    lon: location.mapEligible ? safeNumber(location.lon) : null,
    location_label: locationLabel,
    impact_label: impactLabel,
    origin_label: originLabel,
    severity: normalizeSeverity(event.severity, "medium"),
    occurred_at: safeDate(event.occurred_at) || new Date().toISOString(),
    confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : null,
    metadata: {
      ...locationMetadata,
      event_quality: {
        ...baseQuality,
        event_fingerprint: baseQuality.event_fingerprint || eventFingerprint,
      }
    }
  };
}

function resolveEventLocation(item = {}) {
  const existingLocation = readEventLocation(item);
  const trustedStoredPoint = Boolean(
    existingLocation.precision &&
    isMapMarkerPrecision(existingLocation.precision) &&
    existingLocation.method &&
    !isUnsafeLocationMethod(existingLocation.method)
  );
  const coordinateCandidates = [
    [item.incident_lat, item.incident_lon, "incident_coordinates"],
    [item.event_lat ?? item.event_latitude, item.event_lon ?? item.event_longitude, "event_coordinates"],
    [item.impact_lat, item.impact_lon, "impact_coordinates"],
    ...(trustedStoredPoint ? [[item.lat, item.lon, "item_coordinates"]] : [])
  ];
  for (const [latValue, lonValue, method] of coordinateCandidates) {
    if (!isValidCoordinate(latValue, lonValue)) continue;
    if (isCoarseCountryCentroid(latValue, lonValue, item.location_label)) continue;
    if (method === "item_coordinates" && isSourceDerivedCoordinate(item, latValue, lonValue)) continue;
    const precision = normalizeLocationPrecision(existingLocation.precision, LOCATION_PRECISION.EXACT);
    if (!isMapMarkerPrecision(precision)) continue;
    const hints = getEventGeographyHints(item);
    return {
      lat: safeNumber(latValue),
      lon: safeNumber(lonValue),
      label: normalizeLocationLabel(item.location_label) || "Coordinates",
      country: hints.country || null,
      region: hints.region || null,
      city: hints.city || null,
      place: hints.place || normalizeLocationLabel(item.location_label),
      theatre: null,
      precision,
      detail: precision === LOCATION_PRECISION.LOCAL ? "local_coordinates" : "exact_coordinates",
      method: existingLocation.method || method,
      source: existingLocation.method || method,
      confidence: existingLocation.confidence ?? (precision === LOCATION_PRECISION.EXACT ? 100 : 82),
      quality: precision === LOCATION_PRECISION.EXACT ? "exact" : "local",
      mapEligible: true,
      score: 100
    };
  }

  const textSources = getLocationTextSources(item);
  const textCoordinates = extractCoordinatesFromText(textSources.map(([, value]) => value).join(" "));
  if (textCoordinates) return { ...textCoordinates, score: 110 };

  const candidates = textSources
    .flatMap(([source, value]) => findTextLocationCandidates(value, source))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    const hints = getEventGeographyHints(item);
    if (
      isValidCoordinate(item.lat, item.lon) &&
      !isCoarseCountryCentroid(item.lat, item.lon, item.location_label) &&
      !isSourceDerivedCoordinate(item, item.lat, item.lon)
    ) {
      return {
        lat: safeNumber(item.lat),
        lon: safeNumber(item.lon),
        label: normalizeLocationLabel(item.location_label) || "Coordinates",
        country: hints.country || null,
        region: hints.region || null,
        city: hints.city || null,
        place: hints.place || normalizeLocationLabel(item.location_label),
        theatre: null,
        precision: LOCATION_PRECISION.EXACT,
        detail: "legacy_event_coordinates",
        method: "legacy_event_coordinates",
        source: "item_coordinates",
        confidence: 76,
        quality: "exact",
        mapEligible: true,
        score: 76
      };
    }
    return {
      lat: null,
      lon: null,
      label: null,
      country: hints.country || null,
      region: hints.region || null,
      city: hints.city || null,
      place: hints.place || null,
      theatre: null,
      precision: LOCATION_PRECISION.UNKNOWN,
      detail: "none",
      method: "not_found",
      source: "not_found",
      confidence: 0,
      quality: "unknown",
      mapEligible: false,
      score: 0
    };
  }

  const precision = normalizeLocationPrecision(best.precision);
  const mapEligible = best.mapEligible !== false && isMapMarkerPrecision(precision) && isValidCoordinate(best.lat, best.lon);
  const nearLocality = best.proximity_qualified && precision === LOCATION_PRECISION.LOCAL;
  const method = nearLocality
    ? `text_near_${best.precision || "locality"}`
    : `text_${best.precision || "location"}`;
  const confidence = precision === LOCATION_PRECISION.EXACT
    ? 96
    : precision === LOCATION_PRECISION.LOCAL
      ? (nearLocality ? 72 : 84)
      : precision === LOCATION_PRECISION.REGIONAL
        ? 52
        : 0;
  return {
    lat: mapEligible && isValidCoordinate(best.lat, best.lon) ? best.lat : null,
    lon: mapEligible && isValidCoordinate(best.lat, best.lon) ? best.lon : null,
    anchor_lat: precision === LOCATION_PRECISION.REGIONAL && isValidCoordinate(best.lat, best.lon) ? best.lat : null,
    anchor_lon: precision === LOCATION_PRECISION.REGIONAL && isValidCoordinate(best.lat, best.lon) ? best.lon : null,
    label: best.label,
    country: best.country,
    region: best.region,
    city: best.city || null,
    place: best.place || (precision === LOCATION_PRECISION.EXACT ? best.label : null),
    theatre: best.theatre,
    precision,
    detail: best.precision || null,
    method,
    source: best.match_source,
    matched_alias: best.matched_alias,
    confidence,
    quality: precision.toLowerCase(),
    mapEligible,
    score: best.score
  };
}

function classifyCategory(text = "") {
  const value = String(text || "").toLowerCase();
  if (/\b(cyberattack|cyber attack|ransomware|malware|outage|network disruption|internet disruption|power grid attack|infrastructure attack)\b/.test(value)) return "cyber";
  if (/\b(notam|airspace closed|airspace restricted|airspace closure|flight ban|no-fly|no fly)\b/.test(value)) return "airspace";
  if (/\b(siren|red alert|take shelter|air raid)\b/.test(value)) return "alert";
  if (/\b(missile strike|drone strike|airstrike|air strike|shelling|artillery|bombardment|explosion|exploded|explodes|blast|strike|strikes|struck|attack|attacks|attacked|hit|hits|impact)\b/.test(value)) return "strike";
  if (/\b(red sea|gulf of aden|naval|warship|ship|vessel|tanker|submarine|frigate|destroyer|carrier|maritime|port|blockade|seized)\b/.test(value)) return "naval_activity";
  if (/\b(aircraft|fighter|helicopter|bomber|drone|uav|sortie|scramble|intercepted|interception|shot down|downed|crashed)\b/.test(value)) return "air_activity";
  if (/\b(troop|troops|convoy|ground offensive|clash|clashes|fighting|raid|incursion|combat)\b/.test(value)) return "ground_activity";
  return "military";
}

function inferWeaponType(text = "") {
  const value = String(text || "").toLowerCase();
  if (/\b(drone|uav|shahed|loitering munition)\b/.test(value)) return "drone";
  if (/\b(ballistic missile|cruise missile|missile)\b/.test(value)) return "missile";
  if (/\b(rocket)\b/.test(value)) return "rocket";
  if (/\b(artillery|shelling)\b/.test(value)) return "artillery";
  if (/\b(cyberattack|cyber attack|ransomware|malware)\b/.test(value)) return "cyber";
  if (/\b(airstrike|air strike|fighter|bomber)\b/.test(value)) return "air strike";
  if (/\b(warship|submarine|frigate|destroyer|tanker|vessel)\b/.test(value)) return "naval";
  return null;
}

function inferSeverity(text = "") {
  const value = String(text || "").toLowerCase();
  if (/\b(nuclear|icbm|ballistic missile|mass casualties|dozens killed|critical infrastructure)\b/.test(value)) return "critical";
  if (/\b(killed|casualties|wounded|missile strike|airstrike|air strike|destroyed|major attack|explosion|blast)\b/.test(value)) return "high";
  if (/\b(drone|uav|rocket|shelling|artillery|intercepted|shot down|outage|disrupted)\b/.test(value)) return "medium";
  return "low";
}

function deriveConfidence(item = {}, severity = "medium", location = {}) {
  const quality = readEventQuality(item);
  const qualityConfidence = Number(quality.confidence);
  const legacyScore = Number(item.confidence_score);
  const base = Number.isFinite(qualityConfidence)
    ? qualityConfidence
    : Number.isFinite(legacyScore) ? clamp(legacyScore, 35, 88) : 62;
  const extractionConfidence = clamp(Number(item.extraction_confidence || 75), 20, 100);
  const locationConfidence = clamp(Number(location.confidence || 0), 0, 100);
  let score = base * 0.82 + extractionConfidence * 0.08 + locationConfidence * 0.1;
  if (quality.corroboration_state === CORROBORATION_STATES.UNVERIFIED) score = Math.min(score, 55);
  if (quality.corroboration_state === CORROBORATION_STATES.DISPUTED) score = Math.min(score, 62);
  return clamp(Math.round(score), 20, 96);
}

function derivePriorityScore(category, severity, location = {}) {
  let score = 40;
  if (category === "strike") score += 35;
  else if (category === "alert") score += 25;
  else if (category === "airspace") score += 22;
  else if (category === "cyber") score += 20;
  else if (category === "naval_activity") score += 18;
  else if (category === "air_activity") score += 18;
  else if (category === "ground_activity") score += 16;
  if (severity === "critical") score += 20;
  else if (severity === "high") score += 12;
  else if (severity === "medium") score += 6;
  if (!location.mapEligible) score -= 15;
  return clamp(score, 0, 100);
}

function normalizeForHash(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|in|near|after|as|to|for|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeDedupeKey(item = {}, fields = {}) {
  const occurredAt = safeDate(item.published_at || item.fetched_at) || new Date().toISOString();
  const hourBucket = occurredAt.slice(0, 13);
  const normalizedTitle = normalizeForHash(fields.title || item.title || item.url || item.guid || "");
  const locationKey = normalizeForHash(fields.location_label || "");
  const category = fields.category || "event";
  const rawKey = `${category}|${locationKey}|${normalizedTitle}|${hourBucket}`;
  const hash = crypto.createHash("sha1").update(rawKey).digest("hex").slice(0, 24);
  return `conflict-feed:${hash}`;
}

function getIncidentActionSignature(item = {}, category = "") {
  const text = normalizeForHash([item.title, item.summary, category].filter(Boolean).join(" "));
  if (/\b(?:air defense|air defence|intercept|shot down)\b/.test(text)) return "air-defence";
  if (/\b(?:explosion|blast|detonation)\b/.test(text)) return "explosion";
  if (/\b(?:airstrike|air strike|strike|struck|attack|attacked|hit)\b/.test(text)) return "strike";
  if (/\b(?:missile|rocket)\b/.test(text)) return "missile";
  if (/\b(?:drone|uav|shahed)\b/.test(text)) return "drone";
  if (/\b(?:artillery|shelling|bombardment)\b/.test(text)) return "artillery";
  return normalizeForHash(category || "event") || "event";
}

function makeEventFingerprint(item = {}, fields = {}) {
  const occurredAtMs = Date.parse(item.occurred_at || item.published_at || item.fetched_at || "");
  const sixHourBucket = Number.isFinite(occurredAtMs) ? Math.floor(occurredAtMs / (6 * 60 * 60 * 1000)) : "unknown";
  const location = fields.location || resolveEventLocation(item);
  const locationKey = normalizeForHash([
    location.place,
    location.city,
    location.region,
    location.country,
    location.label,
  ].filter(Boolean).join(" ")) || "unknown-location";
  const action = getIncidentActionSignature(item, fields.category || item.category);
  const rawKey = `${action}|${locationKey}|${sixHourBucket}`;
  return crypto.createHash("sha1").update(rawKey).digest("hex").slice(0, 24);
}

function normalizeConflictFeedItemForStorage(item = {}) {
  const title = cleanTitle(item.title);
  const summary = cleanDisplayText(item.summary, 1200);
  const sourceName = normalizeSourceName(item.source_name);
  const rawSourceName = normalizeSourceName(item.raw?.source_name || item.raw?.source || item.feed_name);

  const sourceProfile = resolveSourceProfile(item);
  const existingQuality = readEventQuality(item);
  const hasExistingQuality = Array.isArray(existingQuality.source_provenance);
  const quality = hasExistingQuality
    ? existingQuality
    : aggregateEventQuality([item]);
  const reportLocation = resolveEventLocation(item);
  const raw = item.raw && typeof item.raw === "object" && !Array.isArray(item.raw) ? item.raw : {};
  return {
    ...item,
    source_name: sourceName || rawSourceName,
    title,
    summary,
    published_at: safeDate(item.published_at),
    fetched_at: safeDate(item.fetched_at) || new Date().toISOString(),
    region: isBlankOrUnknown(item.region) ? null : cleanDisplayText(item.region, 80),
    country: isBlankOrUnknown(item.country) ? null : cleanDisplayText(item.country, 80),
    category: cleanDisplayText(item.category, 80) || "general",
    confidence_score: !hasExistingQuality && Number.isFinite(Number(item.confidence_score))
      ? Number(item.confidence_score)
      : Number.isFinite(Number(quality.confidence)) ? Number(quality.confidence) : 0,
    is_conflict_relevant: item.is_conflict_relevant === true,
    source_class: sourceProfile.source_class,
    source_tier: sourceProfile.source_tier,
    source_reliability: sourceProfile.source_reliability,
    source_family: sourceProfile.source_family,
    official_status: sourceProfile.official_status,
    corroboration_state: quality.corroboration_state,
    raw: {
      ...raw,
      _event_quality: quality,
      _event_location: {
        country: reportLocation.country || null,
        region: reportLocation.region || null,
        city: reportLocation.city || null,
        place: reportLocation.place || null,
        latitude: reportLocation.mapEligible ? safeNumber(reportLocation.lat) : null,
        longitude: reportLocation.mapEligible ? safeNumber(reportLocation.lon) : null,
        regional_anchor_latitude: reportLocation.precision === LOCATION_PRECISION.REGIONAL
          ? safeNumber(reportLocation.anchor_lat)
          : null,
        regional_anchor_longitude: reportLocation.precision === LOCATION_PRECISION.REGIONAL
          ? safeNumber(reportLocation.anchor_lon)
          : null,
        precision: reportLocation.precision || LOCATION_PRECISION.UNKNOWN,
        confidence: Number.isFinite(Number(reportLocation.confidence)) ? Number(reportLocation.confidence) : 0,
        method: reportLocation.method || reportLocation.source || "not_found"
      }
    }
  };
}

function normalizeConflictItemToEventPayload(item = {}) {
  const normalizedItem = normalizeConflictFeedItemForStorage(item);
  const title = cleanTitle(normalizedItem.title);
  const summary = normalizedItem.summary || title;
  const text = [title, summary, normalizedItem.source_category].filter(Boolean).join(" ");
  const location = resolveEventLocation(normalizedItem);
  const category = classifyCategory(text);
  const severity = inferSeverity(text);
  const confidence = deriveConfidence(normalizedItem, severity, location);
  const weaponType = inferWeaponType(text);
  const mapEligible = Boolean(location.mapEligible && title && hasOperationalEventSignal(text));
  const occurredAt = safeDate(normalizedItem.published_at || normalizedItem.fetched_at) || new Date().toISOString();
  const locationMetadata = buildLocationMetadata(normalizedItem, { ...location, mapEligible });
  const eventFingerprint = makeEventFingerprint(normalizedItem, { category, location });
  const eventQuality = {
    ...readEventQuality(normalizedItem),
    event_fingerprint: eventFingerprint,
  };

  return {
    map_eligible: mapEligible,
    reason: mapEligible ? "eligible" : !title ? "missing_title" : !hasOperationalEventSignal(text) ? "not_operational" : "unreliable_location",
    event: {
      category,
      subcategory: weaponType || category,
      report_type: "osint",
      title,
      summary: summary || null,
      source_name: normalizedItem.source_name || null,
      source_url: normalizedItem.url || null,
      occurred_at: occurredAt,
      lat: mapEligible ? location.lat : null,
      lon: mapEligible ? location.lon : null,
      location_label: location.label || null,
      confidence,
      severity,
      weapon_type: weaponType,
      priority_score: derivePriorityScore(category, severity, location),
      dedupe_key: makeDedupeKey(normalizedItem, {
        title,
        location_label: location.label,
        category
      }),
      tags: ["rss", "conflict-feed", "operational", "normalized"],
      metadata: {
        ...locationMetadata,
        event_quality: eventQuality,
        normalization: {
          ...locationMetadata.normalization,
          reason: mapEligible ? "eligible" : `${String(location.precision || LOCATION_PRECISION.UNKNOWN).toLowerCase()}_location_not_marker_eligible`,
          operational_theatre: location.theatre,
          source_name: normalizedItem.source_name || null
        },
        source_id: normalizedItem.source_id || null,
        source_category: normalizedItem.source_category || null,
        guid: normalizedItem.guid || null,
        feed_category: normalizedItem.category || null
      }
    }
  };
}

export {
  NORMALIZATION_VERSION,
  cleanDisplayText,
  cleanTitle,
  hasOperationalEventSignal,
  isIntelWireOnlyNewsText,
  isCoarseCountryCentroid,
  isValidCoordinate,
  makeDedupeKey,
  makeEventFingerprint,
  normalizeConflictFeedItemForStorage,
  normalizeConflictItemToEventPayload,
  normalizeEventRowForStorage,
  normalizeSourceName,
  resolveEventLocation,
  safeDate,
  stripHtml
};
