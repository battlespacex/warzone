// apps/worker/src/conflict-event-promoter.js
// Promotes strict live operational conflict-feed items into map events.
// Broad defense/procurement items remain in conflict_feed_items for Intel Wire only.

import crypto from "crypto";
import { supabase } from "./supabase.js";

const DEFAULT_PROMOTION_LIMIT = 40;
const DEFAULT_MAX_AGE_HOURS = 72;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PROMOTION_LIMIT = readPositiveInteger(
  process.env.CONFLICT_EVENT_PROMOTION_LIMIT,
  DEFAULT_PROMOTION_LIMIT
);

const MAX_AGE_HOURS = readPositiveInteger(
  process.env.CONFLICT_EVENT_MAX_AGE_HOURS,
  DEFAULT_MAX_AGE_HOURS
);

const INTEL_WIRE_ONLY_NEWS_RE =
  /\b(contract|contract award|procurement|acquisition|arms deal|arms sale|arms sales|foreign military sale|foreign military sales|fms|budget|funding|lawmakers|approved sale|purchase|order|program|prototype|production|manufacturing|shipbuilding|industry|startup)\b/i;

const OPERATIONAL_EVENT_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strike|strikes|struck|attack|attacks|attacked|shelling|artillery|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|troop movement|deployed|deployment|convoy|patrol|sortie|scramble|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|spotted|detected|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const LIVE_HAPPENING_SIGNAL_RE =
  /\b(airstrike|air strike|missile strike|drone strike|strikes|struck|attacks|attacked|shelling|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;

const LOCATION_ANCHORS = [
  { label: "Gaza", lat: 31.5, lon: 34.45, pattern: /\b(gaza|rafah|khan younis|deir al-balah|jabalia)\b/i },
  { label: "West Bank", lat: 31.9, lon: 35.2, pattern: /\b(west bank|jenin|nablus|tulkarm|ramallah)\b/i },
  { label: "Israel", lat: 31.8, lon: 35.0, pattern: /\b(israel|tel aviv|haifa|ashkelon|ashdod|beersheba|negev)\b/i },
  { label: "Lebanon", lat: 33.9, lon: 35.8, pattern: /\b(lebanon|beirut|southern lebanon|tyre|sidon)\b/i },
  { label: "Syria", lat: 35.0, lon: 38.5, pattern: /\b(syria|damascus|aleppo|idlib|homs|deir ez-zor|deir al-zor)\b/i },
  { label: "Iraq", lat: 33.2, lon: 43.7, pattern: /\b(iraq|baghdad|erbil|mosul|kirkuk|ain al-asad)\b/i },
  { label: "Iran", lat: 32.0, lon: 53.0, pattern: /\b(iran|tehran|isfahan|isfahan|tabriz|bandar abbas)\b/i },
  { label: "Yemen", lat: 15.5, lon: 47.5, pattern: /\b(yemen|sanaa|hodeidah|houthi|houthis|bab el-mandeb|bab al-mandab)\b/i },
  { label: "Red Sea", lat: 18.0, lon: 39.0, pattern: /\b(red sea|gulf of aden|aden gulf)\b/i },
  { label: "Constanta, Romania", lat: 44.16, lon: 28.64, pattern: /\b(constanta|romanian port|romania)\b/i },
  { label: "Black Sea", lat: 44.0, lon: 35.0, pattern: /\b(black sea)\b/i },
  { label: "Crimea", lat: 45.3, lon: 34.2, pattern: /\b(crimea|sevastopol)\b/i },
  { label: "Kharkiv, Ukraine", lat: 49.99, lon: 36.23, pattern: /\b(kharkiv|kharkov)\b/i },
  { label: "Kyiv, Ukraine", lat: 50.45, lon: 30.52, pattern: /\b(kyiv|kiev)\b/i },
  { label: "Odesa, Ukraine", lat: 46.48, lon: 30.73, pattern: /\b(odesa|odessa)\b/i },
  { label: "Donetsk, Ukraine", lat: 48.02, lon: 37.8, pattern: /\b(donetsk|bakhmut|avdiivka|pokrovsk)\b/i },
  { label: "Zaporizhzhia, Ukraine", lat: 47.84, lon: 35.14, pattern: /\b(zaporizhzhia|zaporizhia|enerhodar)\b/i },
  { label: "Kherson, Ukraine", lat: 46.64, lon: 32.62, pattern: /\b(kherson)\b/i },
  { label: "Ukraine", lat: 49.0, lon: 32.0, pattern: /\b(ukraine|ukrainian)\b/i },
  { label: "Russia", lat: 55.0, lon: 38.0, pattern: /\b(russia|russian|moscow|belgorod|kursk|bryansk)\b/i },
  { label: "Belarus", lat: 53.7, lon: 27.9, pattern: /\b(belarus|minsk)\b/i },
  { label: "Taiwan", lat: 23.8, lon: 121.0, pattern: /\b(taiwan|taipei|taiwan strait)\b/i },
  { label: "South China Sea", lat: 12.0, lon: 114.0, pattern: /\b(south china sea|spratly|scarborough shoal|paracel)\b/i },
  { label: "Philippines", lat: 12.9, lon: 122.8, pattern: /\b(philippines|manila|luzon|mindanao)\b/i },
  { label: "Korean Peninsula", lat: 38.0, lon: 127.5, pattern: /\b(north korea|south korea|korean peninsula|pyongyang|seoul|dmz)\b/i },
  { label: "Kashmir", lat: 34.0, lon: 75.0, pattern: /\b(kashmir|line of control|loc\b|jammu)\b/i },
  { label: "Pakistan", lat: 30.3, lon: 69.4, pattern: /\b(pakistan|islamabad|balochistan|karachi)\b/i },
  { label: "India", lat: 22.9, lon: 78.6, pattern: /\b(india|new delhi|ladakh)\b/i },
  { label: "Afghanistan", lat: 34.5, lon: 66.0, pattern: /\b(afghanistan|kabul|taliban|helmand|kandahar)\b/i },
  { label: "Sudan", lat: 15.6, lon: 30.0, pattern: /\b(sudan|khartoum|darfur|port sudan|omdurman)\b/i },
  { label: "Somalia", lat: 5.2, lon: 46.2, pattern: /\b(somalia|mogadishu|puntland|somaliland)\b/i },
  { label: "Sahel", lat: 15.0, lon: 0.0, pattern: /\b(sahel|mali|niger|burkina faso|bamako|niamey|ouagadougou)\b/i },
  { label: "Democratic Republic of Congo", lat: -2.9, lon: 23.7, pattern: /\b(drc|congo|goma|north kivu|south kivu)\b/i },
  { label: "Ethiopia", lat: 9.1, lon: 40.5, pattern: /\b(ethiopia|tigray|amhara|oromia|addis ababa)\b/i },
  { label: "Myanmar", lat: 21.9, lon: 96.0, pattern: /\b(myanmar|burma|rakhine|mandalay|naypyidaw)\b/i },
  { label: "Nagorno-Karabakh", lat: 39.8, lon: 46.8, pattern: /\b(nagorno-karabakh|karabakh|armenia|azerbaijan|yerevan|baku)\b/i },
  { label: "Kosovo", lat: 42.6, lon: 21.0, pattern: /\b(kosovo|pristina|serbia)\b/i },
  { label: "Baltic Sea", lat: 57.0, lon: 19.0, pattern: /\b(baltic sea|kaliningrad)\b/i }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getItemText(item = {}) {
  return [
    item.title,
    item.summary,
    item.source_name,
    item.source_category,
    item.region,
    item.country
  ].filter(Boolean).join(" ");
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

function isRecentEnough(item = {}) {
  if (!MAX_AGE_HOURS) return true;
  const occurredAt = safeDate(item.published_at || item.fetched_at);
  if (!occurredAt) return true;
  return Date.now() - Date.parse(occurredAt) <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

function isPromotableOperationalItem(item = {}) {
  if (!item || item.is_conflict_relevant === false) return false;
  if (!item.title || !item.url) return false;
  const text = getItemText(item);
  if (isIntelWireOnlyNewsText(text)) return false;
  return hasOperationalEventSignal(text);
}

function extractCoordinatesFromText(text = "") {
  const match = String(text || "").match(/(-?\d{1,2}\.\d{2,8})\s*[, ]\s*(-?\d{1,3}\.\d{2,8})/);
  if (!match) return null;
  const lat = safeNumber(match[1]);
  const lon = safeNumber(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    lat,
    lon,
    label: `${lat}, ${lon}`,
    source: "text_coordinates"
  };
}

function resolveItemCoordinates(item = {}) {
  const lat = safeNumber(item.lat);
  const lon = safeNumber(item.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      lat,
      lon,
      label: item.location_label || item.region || item.country || "Reported location",
      source: "item_coordinates"
    };
  }

  const text = getItemText(item);
  const coordinates = extractCoordinatesFromText(text);
  if (coordinates) return coordinates;

  const anchor = LOCATION_ANCHORS.find(entry => entry.pattern.test(text));
  if (!anchor) return null;

  return {
    lat: anchor.lat,
    lon: anchor.lon,
    label: anchor.label,
    source: "keyword_anchor"
  };
}

function classifyCategory(text = "") {
  const value = String(text || "").toLowerCase();
  if (/\b(cyberattack|cyber attack|ransomware|malware|outage|network disruption|internet disruption|power grid attack|infrastructure attack)\b/.test(value)) {
    return "cyber";
  }
  if (/\b(notam|airspace closed|airspace restricted|airspace closure|flight ban|no-fly|no fly)\b/.test(value)) {
    return "airspace";
  }
  if (/\b(siren|red alert|take shelter|air raid)\b/.test(value)) {
    return "alert";
  }
  if (/\b(missile strike|drone strike|airstrike|air strike|shelling|artillery|bombardment|explosion|exploded|explodes|blast|strike|strikes|struck|attack|attacks|attacked|hit|hits|impact)\b/.test(value)) {
    return "strike";
  }
  if (/\b(red sea|gulf of aden|naval|warship|ship|vessel|tanker|submarine|frigate|destroyer|carrier|maritime|port|blockade|seized)\b/.test(value)) {
    return "naval_activity";
  }
  if (/\b(aircraft|fighter|helicopter|bomber|drone|uav|sortie|scramble|intercepted|interception|shot down|downed|crashed)\b/.test(value)) {
    return "air_activity";
  }
  if (/\b(troop|troops|convoy|ground offensive|clash|clashes|fighting|raid|incursion|combat)\b/.test(value)) {
    return "ground_activity";
  }
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
  if (/\b(nuclear|icbm|ballistic missile|mass casualties|dozens killed|critical infrastructure)\b/.test(value)) {
    return "critical";
  }
  if (/\b(killed|casualties|wounded|missile strike|airstrike|air strike|destroyed|major attack|explosion|blast)\b/.test(value)) {
    return "high";
  }
  if (/\b(drone|uav|rocket|shelling|artillery|intercepted|shot down|outage|disrupted)\b/.test(value)) {
    return "medium";
  }
  return "low";
}

function deriveConfidence(item = {}, severity = "medium") {
  const score = Number(item.confidence_score);
  const base = Number.isFinite(score) ? clamp(score, 35, 88) : 62;
  const boost = severity === "critical" ? 8 : severity === "high" ? 5 : severity === "medium" ? 2 : 0;
  return clamp(Math.round(base + boost), 35, 92);
}

function derivePriorityScore(category, severity) {
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

  return clamp(score, 0, 100);
}

function makeDedupeKey(item = {}) {
  const rawKey = item.url || item.guid || `${item.source_name || "source"}|${item.title || ""}`;
  const hash = crypto.createHash("sha1").update(String(rawKey)).digest("hex").slice(0, 24);
  return `conflict-feed:${hash}`;
}

function buildEventPayload(item = {}, location) {
  const text = getItemText(item);
  const category = classifyCategory(text);
  const severity = inferSeverity(text);
  const confidence = deriveConfidence(item, severity);
  const occurredAt = safeDate(item.published_at || item.fetched_at) || new Date().toISOString();
  const summary = stripHtml(item.summary || "").slice(0, 900);
  const weaponType = inferWeaponType(text);

  return {
    category,
    subcategory: weaponType || category,
    report_type: "osint",
    title: stripHtml(item.title || "Operational conflict signal").slice(0, 240),
    summary: summary || stripHtml(item.title || "").slice(0, 400),
    source_name: item.source_name || "Conflict feed",
    source_url: item.url || null,
    occurred_at: occurredAt,
    lat: location.lat,
    lon: location.lon,
    location_label: location.label,
    confidence,
    severity,
    weapon_type: weaponType,
    priority_score: derivePriorityScore(category, severity),
    dedupe_key: makeDedupeKey(item),
    tags: ["rss", "conflict-feed", "operational"],
    metadata: {
      source_id: item.source_id || null,
      source_category: item.source_category || null,
      guid: item.guid || null,
      feed_category: item.category || null,
      location_source: location.source || null
    }
  };
}

function pickCoreEventPayload(payload = {}) {
  return {
    category: payload.category || "strike",
    title: payload.title,
    summary: payload.summary || null,
    source_name: payload.source_name || null,
    source_url: payload.source_url || null,
    occurred_at: payload.occurred_at,
    lat: payload.lat,
    lon: payload.lon,
    location_label: payload.location_label || null,
    confidence: Number.isFinite(payload.confidence) ? payload.confidence : 50,
    dedupe_key: payload.dedupe_key || null
  };
}

function isSchemaColumnError(error) {
  const message = String(error?.message || error || "");
  return /column|schema cache|priority_score|metadata|tags|weapon_type|subcategory|severity|report_type/i.test(message);
}

async function eventAlreadyExists(payload = {}) {
  const dedupeKey = payload.dedupe_key;
  if (dedupeKey) {
    const { data, error } = await supabase
      .from("events")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return true;
  }

  if (payload.source_url) {
    const { data, error } = await supabase
      .from("events")
      .select("id")
      .eq("source_url", payload.source_url)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return true;
  }

  return false;
}

async function insertPromotedEvent(payload = {}) {
  let result = await supabase.from("events").insert([payload]);
  if (result.error && isSchemaColumnError(result.error)) {
    result = await supabase.from("events").insert([pickCoreEventPayload(payload)]);
  }
  return result;
}

async function promoteConflictFeedItemsToEvents(items = [], options = {}) {
  const logger = options.logger || console;
  const limit = readPositiveInteger(options.limit, PROMOTION_LIMIT);
  const result = {
    ok: true,
    considered_count: 0,
    candidate_count: 0,
    promoted_count: 0,
    duplicate_count: 0,
    skipped_non_operational_count: 0,
    skipped_old_count: 0,
    skipped_no_location_count: 0,
    error_count: 0,
    errors: []
  };

  const sourceItems = Array.isArray(items) ? items : [];

  for (const item of sourceItems) {
    result.considered_count += 1;

    if (!isPromotableOperationalItem(item)) {
      result.skipped_non_operational_count += 1;
      continue;
    }

    if (!isRecentEnough(item)) {
      result.skipped_old_count += 1;
      continue;
    }

    result.candidate_count += 1;
    if (result.promoted_count >= limit) continue;

    const location = resolveItemCoordinates(item);
    if (!location) {
      result.skipped_no_location_count += 1;
      continue;
    }

    const payload = buildEventPayload(item, location);

    try {
      if (await eventAlreadyExists(payload)) {
        result.duplicate_count += 1;
        continue;
      }

      const { error } = await insertPromotedEvent(payload);
      if (error) {
        result.error_count += 1;
        result.errors.push(error.message || String(error));
        logger.warn?.(`[conflict] event promotion insert failed: ${error.message || error}`);
        continue;
      }

      result.promoted_count += 1;
    } catch (error) {
      result.error_count += 1;
      result.errors.push(error?.message || String(error));
      logger.warn?.(`[conflict] event promotion failed: ${error?.message || error}`);
    }
  }

  if (result.error_count > 0) result.ok = false;
  return result;
}

export {
  hasOperationalEventSignal,
  isIntelWireOnlyNewsText,
  isPromotableOperationalItem,
  promoteConflictFeedItemsToEvents
};
