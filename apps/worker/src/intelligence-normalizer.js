import crypto from "crypto";

const NORMALIZATION_VERSION = "2026-07-26.worker-v1";

const UNKNOWN_TEXT_RE =
  /^(unknown|unknown source|unknown location|unknown origin|reported location|untitled|untitled event|n\/a|null|undefined|-)+$/i;

const OPERATIONAL_EVENT_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strike|strikes|struck|attack|attacks|attacked|shelling|artillery|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|troop movement|deployed|deployment|convoy|patrol|sortie|scramble|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|spotted|detected|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const LIVE_HAPPENING_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strikes|struck|attacks|attacked|shelling|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const INTEL_WIRE_ONLY_NEWS_RE =
  /\b(contract|contract award|procurement|acquisition|arms deal|arms sale|arms sales|foreign military sale|foreign military sales|fms|budget|funding|lawmakers|approved sale|purchase|order|program|prototype|production|manufacturing|shipbuilding|industry|startup)\b/i;

const EVENT_LOCATION_CATALOG = [
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

const COARSE_COUNTRY_CENTROIDS = [
  { label: "Israel", lat: 31.8, lon: 35.0 },
  { label: "Iran", lat: 32.0, lon: 53.0 },
  { label: "Yemen", lat: 15.5, lon: 47.5 },
  { label: "Syria", lat: 35.0, lon: 38.5 },
  { label: "Iraq", lat: 33.2, lon: 43.7 },
  { label: "Ukraine", lat: 49.0, lon: 32.0 },
  { label: "Russia", lat: 55.0, lon: 38.0 },
  { label: "Taiwan", lat: 23.8, lon: 121.0 },
  { label: "Lebanon", lat: 33.9, lon: 35.8 }
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
  let score = source === "title" ? 70 : 48;
  if (entry.precision === "city") score += 20;
  else if (entry.precision === "area" || entry.precision === "maritime_area") score += 12;
  else if (entry.precision === "country_hint") score -= 28;
  score += Math.min(12, alias.length);
  if (index >= 0 && index < 80) score += 5;
  return score;
}

function findTextLocationCandidates(text = "", source = "summary") {
  const candidates = [];
  for (const entry of EVENT_LOCATION_CATALOG) {
    for (const alias of entry.aliases || []) {
      const index = matchAlias(text, alias);
      if (index === -1) continue;
      candidates.push({
        ...entry,
        matched_alias: alias,
        match_source: source,
        match_index: index,
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
    precision: "exact_coordinates",
    source: "text_coordinates",
    quality: "exact",
    mapEligible: true
  };
}

function normalizeLocationLabel(value = "") {
  const label = cleanDisplayText(value, 120);
  return label && !/reported location/i.test(label) ? label : null;
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

function normalizeEventRowForStorage(event = {}) {
  if (!event || typeof event !== "object") return null;
  const lat = safeNumber(event.lat);
  const lon = safeNumber(event.lon);
  const locationLabel = normalizeLocationLabel(event.location_label);
  const hasCoordinates =
    isValidCoordinate(lat, lon) &&
    !isCoarseCountryCentroid(lat, lon, locationLabel);
  const title = cleanTitle(event.title) || buildEventTitleFallback(event);
  const summary = cleanDisplayText(event.summary, 1500) || title;
  const impactLabel = normalizeLocationLabel(event.impact_label);
  const originLabel = normalizeLocationLabel(event.origin_label);
  const sourceName = normalizeSourceName(event.source_name);

  return {
    ...event,
    category: normalizeCategory(event.category, "military"),
    title,
    summary,
    source_name: sourceName || null,
    lat: hasCoordinates ? lat : null,
    lon: hasCoordinates ? lon : null,
    location_label: locationLabel,
    impact_label: impactLabel,
    origin_label: originLabel,
    severity: normalizeSeverity(event.severity, "medium"),
    occurred_at: safeDate(event.occurred_at) || new Date().toISOString(),
    confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : null
  };
}

function resolveEventLocation(item = {}) {
  if (isValidCoordinate(item.lat, item.lon)) {
    return {
      lat: safeNumber(item.lat),
      lon: safeNumber(item.lon),
      label: normalizeLocationLabel(item.location_label) || "Coordinates",
      country: isBlankOrUnknown(item.country) ? null : cleanDisplayText(item.country, 80),
      region: isBlankOrUnknown(item.region) ? null : cleanDisplayText(item.region, 80),
      theatre: null,
      precision: "exact_coordinates",
      source: "item_coordinates",
      quality: "exact",
      mapEligible: true,
      score: 100
    };
  }

  const title = cleanDisplayText(item.title, 400) || "";
  const summary = cleanDisplayText(item.summary, 1200) || "";
  const textCoordinates = extractCoordinatesFromText(`${title} ${summary}`);
  if (textCoordinates) return { ...textCoordinates, score: 98 };

  const candidates = [
    ...findTextLocationCandidates(title, "title"),
    ...findTextLocationCandidates(summary, "summary")
  ].sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    return {
      lat: null,
      lon: null,
      label: null,
      country: isBlankOrUnknown(item.country) ? null : cleanDisplayText(item.country, 80),
      region: isBlankOrUnknown(item.region) ? null : cleanDisplayText(item.region, 80),
      theatre: null,
      precision: "none",
      source: "not_found",
      quality: "missing",
      mapEligible: false,
      score: 0
    };
  }

  const mapEligible = best.mapEligible !== false && isValidCoordinate(best.lat, best.lon);
  return {
    lat: mapEligible ? best.lat : null,
    lon: mapEligible ? best.lon : null,
    label: best.label,
    country: best.country,
    region: best.region,
    theatre: best.theatre,
    precision: best.precision,
    source: best.match_source,
    matched_alias: best.matched_alias,
    quality: mapEligible ? "text_location" : "coarse_country_hint",
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
  const score = Number(item.confidence_score);
  const base = Number.isFinite(score) ? clamp(score, 35, 88) : 62;
  const severityBoost = severity === "critical" ? 8 : severity === "high" ? 5 : severity === "medium" ? 2 : 0;
  const locationBoost = location.quality === "exact" ? 8 : location.mapEligible ? 4 : -10;
  return clamp(Math.round(base + severityBoost + locationBoost), 20, 96);
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

function normalizeConflictFeedItemForStorage(item = {}) {
  const title = cleanTitle(item.title);
  const summary = cleanDisplayText(item.summary, 1200);
  const sourceName = normalizeSourceName(item.source_name);
  const rawSourceName = normalizeSourceName(item.raw?.source_name || item.raw?.source || item.feed_name);

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
    confidence_score: Number.isFinite(Number(item.confidence_score)) ? Number(item.confidence_score) : 0,
    is_conflict_relevant: item.is_conflict_relevant === true,
    raw: item.raw || item
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
      location_label: mapEligible ? location.label : null,
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
        normalization: {
          version: NORMALIZATION_VERSION,
          map_eligible: mapEligible,
          reason: mapEligible ? "eligible" : "unreliable_or_missing_location",
          location_quality: location.quality,
          location_precision: location.precision,
          location_source: location.source,
          matched_alias: location.matched_alias || null,
          location_score: location.score,
          event_country: location.country,
          event_region: location.region,
          operational_theatre: location.theatre,
          source_name: normalizedItem.source_name || null,
          publisher_country: normalizedItem.country || null,
          publisher_region: normalizedItem.region || null
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
  normalizeConflictFeedItemForStorage,
  normalizeConflictItemToEventPayload,
  normalizeEventRowForStorage,
  normalizeSourceName,
  resolveEventLocation,
  safeDate,
  stripHtml
};
