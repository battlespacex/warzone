// apps/worker/src/status-filter.js
// StratOps cyber + airspace + infrastructure status relevance filter.

const GPS_KEYWORDS = [
  "gps jamming",
  "gps spoofing",
  "gnss interference",
  "satellite navigation disruption",
  "navigation signal",
  "ads-b spoofing",
  "spoofed gps",
  "jammed gps",
  "interference zone",
  "electronic warfare",
  "ew",
  "jamming",
  "spoofing"
];

const INTERNET_CYBER_KEYWORDS = [
  "internet outage",
  "network outage",
  "connectivity disruption",
  "communications blackout",
  "telecom outage",
  "mobile network outage",
  "dns outage",
  "bgp hijack",
  "bgp leak",
  "cyberattack",
  "cyber attack",
  "ddos",
  "ransomware",
  "malware",
  "infrastructure attack",
  "power grid attack",
  "undersea cable",
  "submarine cable",
  "data center outage",
  "network disruption",
  "internet censorship",
  "social media blocked",
  "blocked social media",
  "telegram blocked",
  "twitter blocked",
  "x blocked",
  "discord blocked",
  "whatsapp blocked",
  "dns throttling",
  "throttling"
];

const DISRUPTION_CONTEXT_KEYWORDS = [
  "outage",
  "shutdown",
  "closed",
  "closure",
  "diversion",
  "diverted",
  "disruption",
  "blackout",
  "telecom",
  "network outage",
  "network disruption",
  "blocking",
  "blocked",
  "throttling",
  "throttled",
  "censorship",
  "connectivity",
  "power grid",
  "critical infrastructure",
  "airport",
  "airspace",
  "aviation",
  "flight",
  "gnss",
  "gps"
];

const AIRSPACE_KEYWORDS = [
  "airspace closed",
  "airspace restriction",
  "flight diversion",
  "flights diverted",
  "airport closed",
  "airport shutdown",
  "notam",
  "aviation warning",
  "flight ban",
  "no-fly zone",
  "missile warning",
  "drone activity near airport",
  "air defense alert",
  "air defence alert"
];

const NEGATIVE_KEYWORDS = [
  "sports",
  "entertainment",
  "celebrity",
  "gaming",
  "school shooting",
  "city shooting",
  "police shooting",
  "local crime",
  "robbery",
  "murder trial",
  "court case",
  "weather forecast",
  "airline sale",
  "travel deal",
  "vacation",
  "airport restaurant",
  "airport parking",
  "consumer gps watch",
  "phone gps issue",
  "car gps problem",
  "gaming lag",
  "home internet plan",
  "broadband package",
  "product review",
  "join us",
  "year in review",
  "global gathering",
  "new features",
  "new feature",
  "workshop",
  "conference",
  "training program",
  "fellowship",
  "call for applications",
  "previously claimed responsibility",
  "previously claimed",
  "seeks to label",
  "label two",
  "extremist"
];

const HISTORICAL_OR_LEGAL_CONTEXT_KEYWORDS = [
  "previously claimed responsibility",
  "previously claimed",
  "earlier claimed",
  "last year claimed",
  "seeks to label",
  "sought to label",
  "designated as extremist",
  "label as extremist",
  "sanctions announced",
  "charged with",
  "indicted for"
];

const CURRENT_OPERATIONAL_IMPACT_KEYWORDS = [
  "outage",
  "shutdown",
  "closed",
  "closure",
  "diversion",
  "diverted",
  "disruption",
  "disrupted",
  "blackout",
  "currently",
  "ongoing",
  "active",
  "affecting",
  "impacted",
  "knocked offline",
  "taken offline",
  "systems down",
  "service unavailable",
  "flights diverted",
  "airport closed",
  "airspace closed",
  "telecom outage",
  "data center outage",
  "network outage",
  "communications blackout"
];

const CRITICAL_HINTS = [
  "country-wide",
  "countrywide",
  "nationwide",
  "national outage",
  "major airspace closure",
  "airspace closed",
  "airport closed",
  "power grid attack",
  "communications blackout",
  "critical infrastructure",
  "gps spoofing affecting aircraft",
  "gps jamming affecting aircraft"
];

const HIGH_HINTS = [
  "regional outage",
  "airport shutdown",
  "flights diverted",
  "flight diversion",
  "confirmed gps spoofing",
  "confirmed gps jamming",
  "confirmed gnss interference",
  "undersea cable disruption",
  "data center outage",
  "air defense alert",
  "missile warning"
];

function cleanText(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function textBlob(item = {}) {
  return cleanText([
    item.title,
    item.summary,
    item.source_name,
    item.country,
    item.region,
    Array.isArray(item.raw?.tags) ? item.raw.tags.join(" ") : "",
    Array.isArray(item.raw?.themes) ? item.raw.themes.join(" ") : "",
    Array.isArray(item.raw?.CCs) ? item.raw.CCs.join(" ") : "",
  ].filter(Boolean).join(" ")).toLowerCase();
}

function containsAny(text = "", keywords = []) {
  return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
}

function matchCount(text = "", keywords = []) {
  return keywords.reduce((count, keyword) => (
    text.includes(String(keyword).toLowerCase()) ? count + 1 : count
  ), 0);
}

function isGenericCyberNewsWithoutDisruption(text = "") {
  const genericCyberTerms = [
    "malware",
    "spyware",
    "phishing",
    "hacker group",
    "hacker groups",
    "apt",
    "vulnerability",
    "exploit",
    "zero-day",
    "zero day",
    "unpatched",
    "stolen logins",
    "fake sites",
    "github repositories",
    "npm supply-chain attack",
    "supply chain attack",
    "banking malware",
    "scam"
  ];

  return containsAny(text, genericCyberTerms) && !containsAny(text, DISRUPTION_CONTEXT_KEYWORDS);
}

function isHistoricalOrLegalContext(text = "") {
  return containsAny(text, HISTORICAL_OR_LEGAL_CONTEXT_KEYWORDS) &&
    !containsAny(text, CURRENT_OPERATIONAL_IMPACT_KEYWORDS);
}

function detectCategory(item = {}) {
  const text = textBlob(item);

  if (containsAny(text, ["gps spoofing", "spoofed gps", "ads-b spoofing"])) {
    return "gps_spoofing";
  }
  if (containsAny(text, ["gps jamming", "jammed gps"])) {
    return "gps_jamming";
  }
  if (
    containsAny(text, ["gnss interference", "satellite navigation disruption", "navigation signal", "interference zone"]) ||
    ((text.includes("gnss") || text.includes("gps")) && text.includes("interference"))
  ) {
    return "gnss_interference";
  }
  if (
    containsAny(text, [
      "blocked social media",
      "social media blocked",
      "internet censorship",
      "telegram blocked",
      "twitter blocked",
      "x blocked",
      "discord blocked",
      "whatsapp blocked",
      "dns throttling",
      "throttling",
      "throttled"
    ])
  ) {
    return "internet_outage";
  }
  if (containsAny(text, ["undersea cable", "submarine cable"])) {
    return "maritime_disruption";
  }
  if (containsAny(text, ["airspace closed", "airspace restriction", "flight ban", "no-fly zone"])) {
    return "airspace_restriction";
  }
  if (containsAny(text, ["flight diversion", "flights diverted", "airport closed", "airport shutdown", "notam", "aviation warning"])) {
    return "aviation_disruption";
  }
  if (containsAny(text, ["power grid attack", "critical infrastructure", "communications blackout", "telecom outage", "data center outage"])) {
    return "infrastructure_disruption";
  }
  if (containsAny(text, ["internet outage", "network outage", "dns outage", "bgp hijack", "bgp leak", "mobile network outage"])) {
    return "internet_outage";
  }
  if (
    containsAny(text, ["cyberattack", "cyber attack", "ddos", "network disruption"]) ||
    (containsAny(text, ["ransomware", "malware"]) && containsAny(text, DISRUPTION_CONTEXT_KEYWORDS))
  ) {
    return "cyber_disruption";
  }
  return "general";
}

function detectSeverity(item = {}) {
  const text = textBlob(item);

  if (containsAny(text, CRITICAL_HINTS)) return "critical";
  if (containsAny(text, HIGH_HINTS)) return "high";
  if (containsAny(text, ["localized disruption", "limited outage", "reported interference", "airport delay", "intermittent outage"])) {
    return "medium";
  }
  if (containsAny(text, ["unconfirmed", "possible", "minor incident", "brief outage", "temporary outage", "warning"])) {
    return "low";
  }
  return "unknown";
}

function computeScore(item = {}) {
  const text = textBlob(item);
  const negativeHits = matchCount(text, NEGATIVE_KEYWORDS);
  if (negativeHits > 0) {
    return Math.max(0, 5 - negativeHits * 10);
  }
  if (isGenericCyberNewsWithoutDisruption(text) || isHistoricalOrLegalContext(text)) {
    return 0;
  }

  const gpsHits = matchCount(text, GPS_KEYWORDS);
  const internetHits = matchCount(text, INTERNET_CYBER_KEYWORDS);
  const airspaceHits = matchCount(text, AIRSPACE_KEYWORDS);
  const category = detectCategory(item);

  let score = 0;
  score += gpsHits * 14;
  score += internetHits * 10;
  score += airspaceHits * 10;

  if (category === "gps_spoofing" || category === "gps_jamming" || category === "gnss_interference") {
    score += 20;
  }
  if (category === "internet_outage" || category === "cyber_disruption") {
    score += 14;
  }
  if (category === "airspace_restriction" || category === "aviation_disruption") {
    score += 16;
  }
  if (category === "infrastructure_disruption" || category === "maritime_disruption") {
    score += 12;
  }

  if (containsAny(text, CRITICAL_HINTS)) score += 20;
  else if (containsAny(text, HIGH_HINTS)) score += 12;

  if (containsAny(text, ["military zone", "aviation", "airport", "aircraft", "telecom", "infrastructure", "satellite navigation"])) {
    score += 8;
  }

  if (containsAny(text, ["company earnings", "funding round", "product launch", "product review"])) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}

function inferCountry(item = {}) {
  if (item.country) return item.country;
  const raw = item.raw || {};
  if (Array.isArray(raw.CCs) && raw.CCs.length) return raw.CCs[0];
  if (raw.probe_cc) return raw.probe_cc;
  return null;
}

function hasOperationalStatusSignal(text = "", category = "general") {
  switch (String(category || "").toLowerCase()) {
    case "gps_jamming":
    case "gps_spoofing":
    case "gnss_interference":
      return containsAny(text, [
        "gps jamming",
        "gps spoofing",
        "gnss interference",
        "satellite navigation disruption",
        "interference zone",
        "jammed gps",
        "spoofed gps"
      ]);
    case "internet_outage":
      return containsAny(text, [
        "internet outage",
        "network outage",
        "mobile network outage",
        "dns outage",
        "bgp hijack",
        "bgp leak",
        "communications blackout",
        "telecom outage",
        "blocked social media",
        "social media blocked",
        "internet censorship",
        "telegram blocked",
        "twitter blocked",
        "x blocked",
        "discord blocked",
        "whatsapp blocked",
        "dns throttling",
        "throttling",
        "throttled"
      ]);
    case "cyber_disruption":
      return (
        containsAny(text, ["cyberattack", "cyber attack", "ddos", "ransomware", "malware"]) &&
        containsAny(text, [
          "outage",
          "disruption",
          "telecom",
          "communications blackout",
          "data center outage",
          "power grid",
          "critical infrastructure",
          "airport",
          "airspace",
          "undersea cable",
          "submarine cable"
        ])
      );
    case "airspace_restriction":
    case "aviation_disruption":
      return containsAny(text, [
        "airspace closed",
        "airspace restriction",
        "flight diversion",
        "flights diverted",
        "airport closed",
        "airport shutdown",
        "notam",
        "aviation warning",
        "flight ban",
        "no-fly zone",
        "missile warning"
      ]);
    case "infrastructure_disruption":
      return containsAny(text, [
        "power grid attack",
        "communications blackout",
        "telecom outage",
        "data center outage",
        "critical infrastructure",
        "infrastructure attack"
      ]);
    case "maritime_disruption":
      return containsAny(text, ["undersea cable", "submarine cable"]);
    default:
      return false;
  }
}

function enrichStatusItem(item = {}, options = {}) {
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Number(options.minimumScore)
    : 24;

  const title = cleanText(item.title || "Untitled");
  const summary = cleanText(item.summary || "");
  const category = detectCategory({ ...item, title, summary });
  const severity = detectSeverity({ ...item, title, summary, category });
  const confidenceScore = computeScore({ ...item, title, summary, category, severity });
  const text = textBlob({ ...item, title, summary });
  const hasPositiveSignals =
    containsAny(text, GPS_KEYWORDS) ||
    containsAny(text, INTERNET_CYBER_KEYWORDS) ||
    containsAny(text, AIRSPACE_KEYWORDS);
  const hasNegativeSignals = containsAny(text, NEGATIVE_KEYWORDS);
  const hasOperationalSignal = hasOperationalStatusSignal(text, category);
  const isStatusRelevant =
    hasPositiveSignals &&
    hasOperationalSignal &&
    !hasNegativeSignals &&
    !isGenericCyberNewsWithoutDisruption(text) &&
    !isHistoricalOrLegalContext(text) &&
    confidenceScore >= minimumScore;

  return {
    ...item,
    title,
    summary,
    country: inferCountry(item),
    category,
    severity,
    confidence_score: confidenceScore,
    is_status_relevant: isStatusRelevant
  };
}

function filterRelevantStatusItems(items = [], options = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => enrichStatusItem(item, options))
    .filter((item) => item.is_status_relevant);
}

export {
  cleanText,
  detectCategory,
  detectSeverity,
  computeScore,
  enrichStatusItem,
  filterRelevantStatusItems
};
