const SOURCE_ALIASES = new Map([
  ["global osint44", "Global OSINT"],
  ["global osint 44", "Global OSINT"],
  ["osintlive", "OSINT Live"],
  ["osint live", "OSINT Live"],
  ["wfwitness", "War Front Witness"],
  ["war translated", "WarTranslated"],
  ["wartranslated", "WarTranslated"],
  ["fdd", "Foundation for Defense of Democracies"],
  ["fdd org", "Foundation for Defense of Democracies"],
  ["cyberspecnews", "Cyberspec News"],
  ["eurasianchoice", "Eurasian Choice"],
  ["com ua", "Ukrainska Pravda"],
]);

const GENERIC_SOURCE_TITLES = new Set([
  "activity report",
  "conflict feed",
  "osint feed",
  "telegram",
  "tweet",
  "wartranslated",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanWhitespace(value = "") {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

function decodeBasicHtmlEntities(value = "") {
  let text = String(value ?? "");
  for (let index = 0; index < 3; index += 1) {
    const next = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&#(?:x[0-9a-f]+|\d+);/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    if (next === text) break;
    text = next;
  }
  return text;
}

function stripReportDecoration(value = "") {
  return String(value ?? "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFE0E\uFE0F]/g, " ")
    .replace(/\p{So}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayTitle(value = "") {
  return stripFeedJunk(value)
    .replace(/^[\s|:;,.‐-―-]+|[\s|:;,‐-―-]+$/g, "")
    .replace(/\s+(?:targets?\s+reported\s+as|as\s+follows|including)\s*:?$/i, "")
    .replace(/[\s|:;,‐-―-]+$/g, "")
    .trim();
}

function stripFeedJunk(value = "") {
  let text = decodeBasicHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, " ")
    .replace(/@[a-z0-9_]{2,}/gi, " ")
    .replace(/#([\p{L}\p{N}_-]+)/gu, "$1")
    .replace(/\b(?:forwarded from|reposted from|repost|retweet|tweet|read more|click here)\b\s*[:\-]?/gi, " ")
    .replace(/^submitted by\s+.{0,120}?-\s*\d{1,2}:\d{2}\s*/i, "")
    .replace(/\bthe post\b[\s\S]*?\bappeared first on\b[^.]*\.?/gi, " ")
    .replace(/\bfirst appeared on\b[^.]*\.?/gi, " ")
    .replace(/\b(?:source|channel)\s*:\s*(?:@[a-z0-9_]+|\S+\.com)\b/gi, " ");
  const promotion = text.search(/\b(?:rainbet|non[- ]?kyc|crypto casino|casino\s*&?\s*sportsbook|sportsbook|betting bonus|promo code|join our channel|subscribe to our channel)\b/i);
  if (promotion >= 0) text = text.slice(0, promotion);
  return stripReportDecoration(text)
    .replace(/^\?+\s*/, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?]){3,}/g, "$1")
    .replace(/^[\s|:;,.‐-―-]+|[\s|:;,‐-―-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasReadableEnglish(value = "") {
  const text = cleanWhitespace(value);
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 3) return false;
  const latin = text.match(/\p{Script=Latin}/gu) || [];
  return latin.length / letters.length >= 0.9;
}

function detectOriginalLanguage(value = "") {
  const text = cleanWhitespace(value);
  if (!text) return "unknown";
  const letters = text.match(/\p{L}/gu) || [];
  const latin = text.match(/\p{Script=Latin}/gu) || [];
  if (!letters.length) return "unknown";
  if (latin.length === letters.length) return "english_or_latin";
  if (latin.length / letters.length >= 0.25) return "mixed";
  return "non_english";
}

function extractEmbeddedEnglish(value = "") {
  const text = decodeBasicHtmlEntities(value).replace(/\r\n?/g, "\n");
  const labeled = text.match(/(?:\bEnglish|\bDescription)\s*:\s*([\s\S]+?)(?=(?:\bSource|\bCredit|\bOriginal|Джерело|Источник)\s*:|$)/i);
  const candidate = stripFeedJunk(labeled?.[1] || "");
  return hasReadableEnglish(candidate) ? candidate : "";
}

function firstSentence(value = "", maxLength = 200) {
  const text = cleanWhitespace(value);
  const sentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  if (sentence.length <= maxLength) return sentence;
  const shortened = sentence.slice(0, maxLength - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || sentence.slice(0, maxLength - 1)}…`;
}

function conciseSentences(value = "", maxSentences = 3, maxLength = 520) {
  const text = cleanWhitespace(value);
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const selected = sentences.map(cleanWhitespace).filter(Boolean).slice(0, maxSentences).join(" ");
  if (selected.length <= maxLength) return selected;
  const shortened = selected.slice(0, maxLength - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || selected.slice(0, maxLength - 1)}…`;
}

function readDisplayCandidates(item = {}, kind = "title") {
  const metadata = asObject(item.metadata);
  const raw = asObject(item.raw);
  const rawMetadata = asObject(raw.metadata);
  const normalization = asObject(metadata.normalization);
  const rawNormalization = asObject(rawMetadata.normalization);
  const keys = kind === "title"
    ? ["display_title", "english_title", "title_en", "translated_title", "normalized_title"]
    : ["display_summary", "english_summary", "summary_en", "translated_summary", "normalized_summary"];
  return [item, normalization, metadata, rawNormalization, rawMetadata, raw]
    .flatMap((source) => keys.map((key) => source?.[key]))
    .filter((value) => cleanWhitespace(value));
}

function isWeakDisplayTitle(value = "", sourceName = "") {
  const title = cleanWhitespace(value).toLowerCase();
  const source = cleanWhitespace(sourceName).toLowerCase().replace(/^tg\s*\/\s*/, "");
  return !title || title.length < 8 || GENERIC_SOURCE_TITLES.has(title) || (source && title === source);
}

function normalizeSourceKey(value = "") {
  return cleanWhitespace(value)
    .toLowerCase()
    .replace(/^telegram\s*:\s*/, "")
    .replace(/^tg\s*[\/:\-]\s*/, "")
    .replace(/^tg[-_]/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeSourceName(value = "", fallback = "Open-source reporting") {
  const key = normalizeSourceKey(value);
  if (!key || /^(unknown|unknown source|null|undefined)$/.test(key)) return fallback;
  if (SOURCE_ALIASES.has(key)) return SOURCE_ALIASES.get(key);
  const words = key.split(" ").filter(Boolean).map((word) => {
    if (/^(ap|afp|bbc|cnn|osint|uk|us|usa|nato|un)$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return words.join(" ") || fallback;
}

function uniqueEnglishParts(values = []) {
  const seen = new Set();
  return values.map((value) => stripFeedJunk(value)).filter((value) => {
    if (!value || !hasReadableEnglish(value)) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatReportLocation(item = {}) {
  const precision = cleanWhitespace(item.location_precision || item.location?.precision).toUpperCase() || "UNKNOWN";
  if (precision === "UNKNOWN") return { display_location: null, location_detail: null };
  const place = item.event_place || item.location?.place;
  const city = item.event_city || item.location?.city;
  const storedLabel = stripFeedJunk(item.display_location_label || item.location_label);
  const parts = precision !== "REGIONAL" && !place && !city && hasReadableEnglish(storedLabel)
    ? [storedLabel]
    : precision === "REGIONAL"
    ? [item.event_region || item.location?.region, item.event_country || item.location?.country]
    : [place, city, item.event_region || item.location?.region, item.event_country || item.location?.country];
  let cleanParts = uniqueEnglishParts(parts);
  if (cleanParts.length > 1) cleanParts = cleanParts.filter((part) => !/^(?:europe|asia|africa|global)$/i.test(part));
  const displayLocation = cleanParts.join(", ") || null;
  if (!displayLocation) return { display_location: null, location_detail: null };
  const latitude = Number(item.latitude ?? item.location?.latitude);
  const longitude = Number(item.longitude ?? item.location?.longitude);
  const hasPoint = ["EXACT", "LOCAL"].includes(precision) && Number.isFinite(latitude) && Number.isFinite(longitude);
  const qualifier = precision === "LOCAL" ? "Approximate locality" : precision === "REGIONAL" ? "Regional context" : null;
  return {
    display_location: displayLocation,
    location_detail: [qualifier, hasPoint ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : null].filter(Boolean).join(" | ") || null,
  };
}

function buildReportDisplayFields(item = {}) {
  const rawTitle = cleanWhitespace(item.title);
  const rawSummary = cleanWhitespace(item.summary || item.description);
  const sourceName = humanizeSourceName(item.display_source_name || item.source_name || item.source_family, "Open-source reporting");
  const preferredTitles = readDisplayCandidates(item, "title").map(cleanDisplayTitle).filter(hasReadableEnglish);
  const preferredSummaries = readDisplayCandidates(item, "summary").map(stripFeedJunk).filter(hasReadableEnglish);
  const embeddedEnglish = extractEmbeddedEnglish(rawSummary);
  const sourceEnglishTitle = hasReadableEnglish(cleanDisplayTitle(rawTitle)) ? cleanDisplayTitle(rawTitle) : "";
  const sourceEnglishSummary = hasReadableEnglish(stripFeedJunk(rawSummary)) ? stripFeedJunk(rawSummary) : "";
  let displaySummary = preferredSummaries[0] || embeddedEnglish || sourceEnglishSummary;
  let displayTitle = preferredTitles[0] || sourceEnglishTitle;
  let translationStatus = preferredTitles.length || preferredSummaries.length
    ? "existing_normalized_english"
    : embeddedEnglish ? "embedded_english_extracted" : (displayTitle || displaySummary) ? "source_english" : "unavailable";
  if (isWeakDisplayTitle(displayTitle, item.source_name) && displaySummary) displayTitle = firstSentence(displaySummary, 190);
  displayTitle = firstSentence(displayTitle, 220);
  displaySummary = conciseSentences(displaySummary, 3, 560);
  if (displayTitle && displaySummary && displaySummary.toLowerCase().startsWith(displayTitle.toLowerCase())) {
    displaySummary = cleanWhitespace(displaySummary.slice(displayTitle.length).replace(/^[\s.:;\-]+/, ""));
  }
  displaySummary = displaySummary.replace(/^(?:targets?\s+reported\s+as|as\s+follows)\s*:?\s*/i, "");
  const verification = cleanWhitespace(item.verification_state || item.corroboration_state).toUpperCase();
  const familyCount = Number(item.independent_source_family_count || 1);
  if (!displaySummary && displayTitle) {
    displaySummary = ["REPORTED", "UNVERIFIED"].includes(verification) && familyCount <= 1
      ? "Independent confirmation remained limited during the reporting window."
      : "The development met deterministic report-selection criteria during the reporting window.";
  }
  if (displaySummary && ["REPORTED", "UNVERIFIED"].includes(verification) && familyCount <= 1
    && !/independent (?:confirmation|corroboration)/i.test(displaySummary)) {
    displaySummary = conciseSentences(`${displaySummary} Independent confirmation remained limited during the reporting window.`, 4, 650);
  }
  const location = formatReportLocation(item);
  const attributionOnlyTitle = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(displayTitle)
    && new RegExp(`^${displayTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+RT\\b`, "i").test(rawSummary);
  const eligible = Boolean(displayTitle && hasReadableEnglish(displayTitle)
    && !isWeakDisplayTitle(displayTitle, item.source_name) && !attributionOnlyTitle);
  if (!eligible) translationStatus = "unavailable";
  return {
    display_title: eligible ? displayTitle : null,
    display_summary: eligible ? (displaySummary || "No concise English summary was available.") : null,
    display_source_name: sourceName,
    ...location,
    original_language: detectOriginalLanguage(`${rawTitle} ${rawSummary}`),
    translation_status: translationStatus,
    report_display_eligible: eligible,
  };
}

function humanizeSourceList(values = []) {
  return [...new Set(values.map((value) => humanizeSourceName(value, "")).filter(Boolean))];
}

export {
  buildReportDisplayFields,
  conciseSentences,
  formatReportLocation,
  hasReadableEnglish,
  humanizeSourceList,
  humanizeSourceName,
  stripFeedJunk,
  stripReportDecoration,
};
