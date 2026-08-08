const SOURCE_CLASSES = Object.freeze({
  MAJOR_MEDIA: "MAJOR_MEDIA",
  OFFICIAL: "OFFICIAL",
  SPECIALIST_DEFENSE: "SPECIALIST_DEFENSE",
  AVIATION: "AVIATION",
  MARITIME: "MARITIME",
  CYBER: "CYBER",
  SATELLITE: "SATELLITE",
  REGIONAL_MEDIA: "REGIONAL_MEDIA",
  OSINT: "OSINT",
  TELEGRAM: "TELEGRAM",
  SOCIAL: "SOCIAL",
  EVENT_DERIVED: "EVENT_DERIVED",
  UNKNOWN: "UNKNOWN",
});

const SOURCE_TIERS = Object.freeze({
  TIER_1: "TIER_1",
  TIER_2: "TIER_2",
  TIER_3: "TIER_3",
  UNRATED: "UNRATED",
});

const CORROBORATION_STATES = Object.freeze({
  CONFIRMED: "CONFIRMED",
  CORROBORATED: "CORROBORATED",
  REPORTED: "REPORTED",
  UNVERIFIED: "UNVERIFIED",
  DISPUTED: "DISPUTED",
});

const SOURCE_HEALTH_STATES = Object.freeze({
  HEALTHY: "healthy",
  FAILING: "failing",
  STALE: "stale",
  DISABLED: "disabled",
  RATE_LIMITED: "rate_limited",
  PARSER_ERROR: "parser_error",
});

const SOURCE_PROFILE_OVERRIDES = new Map([
  ["reuters", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 95, source_family: "reuters" }],
  ["associated press", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 94, source_family: "associated-press" }],
  ["ap news", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 94, source_family: "associated-press" }],
  ["bbc", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 92, source_family: "bbc" }],
  ["france 24", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 90, source_family: "france-24" }],
  ["deutsche welle", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 89, source_family: "deutsche-welle" }],
  ["the guardian", { source_class: SOURCE_CLASSES.MAJOR_MEDIA, source_tier: SOURCE_TIERS.TIER_1, reliability: 90, source_family: "the-guardian" }],
  ["kyiv independent", { source_class: SOURCE_CLASSES.REGIONAL_MEDIA, source_tier: SOURCE_TIERS.TIER_2, reliability: 80, source_family: "kyiv-independent" }],
  ["middle east eye", { source_class: SOURCE_CLASSES.REGIONAL_MEDIA, source_tier: SOURCE_TIERS.TIER_2, reliability: 76, source_family: "middle-east-eye" }],
  ["jerusalem post", { source_class: SOURCE_CLASSES.REGIONAL_MEDIA, source_tier: SOURCE_TIERS.TIER_2, reliability: 78, source_family: "jerusalem-post" }],
  ["the jerusalem post", { source_class: SOURCE_CLASSES.REGIONAL_MEDIA, source_tier: SOURCE_TIERS.TIER_2, reliability: 78, source_family: "jerusalem-post" }],
  ["gdelt", { source_class: SOURCE_CLASSES.EVENT_DERIVED, source_tier: SOURCE_TIERS.TIER_3, reliability: 58, source_family: "gdelt" }],
]);

function normalizeToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value = "") {
  return normalizeToken(value).replace(/\s+/g, "-") || "unknown";
}

function getDomain(value = "") {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getSourceText(source = {}) {
  const raw = source.raw && typeof source.raw === "object" ? source.raw : {};
  return [
    source.source_id,
    source.id,
    source.source_name,
    source.name,
    source.source_type,
    source.type,
    source.source_category,
    source.category,
    source.region_scope,
    source.region,
    ...(Array.isArray(source.tags) ? source.tags : []),
    raw.source_id,
    raw.source_name,
  ].filter(Boolean).join(" ");
}

function findProfileOverride(source = {}) {
  const sourceText = normalizeToken(getSourceText(source));
  for (const [key, profile] of SOURCE_PROFILE_OVERRIDES) {
    if (sourceText === key || sourceText.includes(key)) return profile;
  }
  return null;
}

function detectUpstreamWireFamily(source = {}) {
  const raw = source.raw && typeof source.raw === "object" ? source.raw : {};
  const text = [
    source.title,
    source.summary,
    source.description,
    source.author,
    raw.creator,
    raw.author,
    raw["dc:creator"],
    raw.source,
  ].filter(Boolean).join(" ");
  if (/\bReuters\b/i.test(text)) return "reuters";
  if (/\b(?:Associated Press|AP News)\b/i.test(text)) return "associated-press";
  if (/\b(?:Agence France-Presse|AFP)\b/i.test(text)) return "afp";
  if (/\bBloomberg\b/i.test(text)) return "bloomberg";
  return "";
}

function inferSourceClass(source = {}) {
  const text = normalizeToken(getSourceText(source));
  const type = normalizeToken(source.source_type || source.type || source.parser);
  if (source.official_status === true || /\b(?:ministry|department|government|gov|centcom|mil|cisa|nasa|usgs|reliefweb)\b/.test(text)) return SOURCE_CLASSES.OFFICIAL;
  if (type.includes("telegram") || text.includes("telegram")) return SOURCE_CLASSES.TELEGRAM;
  if (/\b(?:x search|twitter|reddit|social)\b/.test(`${type} ${text}`)) return SOURCE_CLASSES.SOCIAL;
  if (/\b(?:satellite|copernicus|firms|imagery)\b/.test(text)) return SOURCE_CLASSES.SATELLITE;
  if (/\b(?:cyber|cisa|ooni|securityweek|hacker|bleeping|record)\b/.test(text)) return SOURCE_CLASSES.CYBER;
  if (/\b(?:aviation|airspace|notam|flight)\b/.test(text)) return SOURCE_CLASSES.AVIATION;
  if (/\b(?:maritime|naval|shipping|vessel|usni)\b/.test(text)) return SOURCE_CLASSES.MARITIME;
  if (/\b(?:defense|defence|military|war zone|c4isr|janes)\b/.test(text)) return SOURCE_CLASSES.SPECIALIST_DEFENSE;
  if (/\b(?:osint|bellingcat|oryx)\b/.test(text)) return SOURCE_CLASSES.OSINT;
  if (/\b(?:regional|middle east|ukraine|africa|asia|israel|iran)\b/.test(text)) return SOURCE_CLASSES.REGIONAL_MEDIA;
  if (/\b(?:rss|news|media|wire)\b/.test(text)) return SOURCE_CLASSES.MAJOR_MEDIA;
  if (/\b(?:event derived|gdelt|acled|ucdp)\b/.test(text)) return SOURCE_CLASSES.EVENT_DERIVED;
  return SOURCE_CLASSES.UNKNOWN;
}

function defaultTierForClass(sourceClass) {
  if ([SOURCE_CLASSES.OFFICIAL, SOURCE_CLASSES.MAJOR_MEDIA].includes(sourceClass)) return SOURCE_TIERS.TIER_1;
  if ([SOURCE_CLASSES.REGIONAL_MEDIA, SOURCE_CLASSES.SPECIALIST_DEFENSE, SOURCE_CLASSES.AVIATION, SOURCE_CLASSES.MARITIME, SOURCE_CLASSES.CYBER, SOURCE_CLASSES.SATELLITE].includes(sourceClass)) return SOURCE_TIERS.TIER_2;
  if ([SOURCE_CLASSES.OSINT, SOURCE_CLASSES.TELEGRAM, SOURCE_CLASSES.SOCIAL, SOURCE_CLASSES.EVENT_DERIVED].includes(sourceClass)) return SOURCE_TIERS.TIER_3;
  return SOURCE_TIERS.UNRATED;
}

function defaultReliabilityForTier(tier) {
  if (tier === SOURCE_TIERS.TIER_1) return 86;
  if (tier === SOURCE_TIERS.TIER_2) return 74;
  if (tier === SOURCE_TIERS.TIER_3) return 48;
  return 55;
}

function deriveSourceFamily(source = {}, sourceClass = SOURCE_CLASSES.UNKNOWN) {
  const explicit = source.source_family || source.sourceFamily;
  if (explicit) return slug(explicit);
  const upstream = detectUpstreamWireFamily(source);
  if (upstream) return upstream;
  const sourceName = source.source_name || source.name || source.source_id || source.id || "";
  const normalizedName = normalizeToken(sourceName);
  const override = findProfileOverride(source);
  if (override?.source_family) return override.source_family;
  const domain = getDomain(source.url || source.source_url || source.source_base_url || source.base_url);
  if (sourceClass === SOURCE_CLASSES.TELEGRAM) return `telegram:${slug(normalizedName.replace(/^telegram\s*/, ""))}`;
  if (sourceClass === SOURCE_CLASSES.SOCIAL) return `social:${slug(normalizedName)}`;
  if (domain) return slug(domain.split(".").slice(-2).join("."));
  return slug(normalizedName);
}

function resolveSourceProfile(source = {}) {
  const override = findProfileOverride(source) || {};
  const sourceClass = source.source_class || source.sourceClass || override.source_class || inferSourceClass(source);
  const sourceTier = source.source_tier || source.sourceTier || override.source_tier || defaultTierForClass(sourceClass);
  const reliabilityValue = Number(source.source_reliability ?? source.reliability ?? override.reliability);
  const reliability = Number.isFinite(reliabilityValue)
    ? Math.max(0, Math.min(100, Math.round(reliabilityValue)))
    : defaultReliabilityForTier(sourceTier);
  const enabled = source.enabled !== false;
  const health = source.health || (enabled ? SOURCE_HEALTH_STATES.HEALTHY : SOURCE_HEALTH_STATES.DISABLED);
  return {
    source_class: sourceClass,
    source_tier: sourceTier,
    source_reliability: reliability,
    source_family: deriveSourceFamily({ ...source, ...override }, sourceClass),
    official_status: source.official_status === true || sourceClass === SOURCE_CLASSES.OFFICIAL,
    map_eligible: source.map_eligible !== false,
    intel_wire_eligible: source.intel_wire_eligible !== false,
    health,
    health_reason: source.health_reason || source.disabled_reason || source.note || null,
  };
}

function normalizeSourceDefinition(source = {}) {
  return { ...source, ...resolveSourceProfile(source) };
}

function normalizeCorroborationState(value, fallback = CORROBORATION_STATES.REPORTED) {
  const state = String(value || "").trim().toUpperCase();
  return Object.values(CORROBORATION_STATES).includes(state) ? state : fallback;
}

export {
  CORROBORATION_STATES,
  SOURCE_CLASSES,
  SOURCE_HEALTH_STATES,
  SOURCE_TIERS,
  detectUpstreamWireFamily,
  normalizeCorroborationState,
  normalizeSourceDefinition,
  normalizeToken,
  resolveSourceProfile,
};
