import {
  CORROBORATION_STATES,
  SOURCE_TIERS,
  normalizeCorroborationState,
  resolveSourceProfile,
} from "../../shared/source-quality-policy.js";

const DENIAL_RE = /\b(?:denies|denied|deny|disputes|disputed|rejects? reports?|false report|no attack occurred|did not occur|not responsible)\b/i;
const DIRECT_EVIDENCE_RE = /\b(?:video|footage|photograph|photo|satellite imagery|geolocated|verified imagery|eyewitness|on-scene)\b/i;
const OFFICIAL_CONFIRMATION_RE = /\b(?:confirm(?:s|ed)?|acknowledg(?:es|ed)|announc(?:es|ed)|official statement|claims? responsibility)\b/i;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonicalizeUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function makeReportEvidence(item = {}) {
  const profile = resolveSourceProfile(item);
  const raw = asObject(item.raw);
  const text = [item.title, item.summary, item.description, raw.title, raw.summary, raw.description].filter(Boolean).join(" ");
  const url = canonicalizeUrl(item.url || item.source_url || item.guid || "");
  const denial = DENIAL_RE.test(text);
  const directEvidence = item.primary_evidence === true || item.direct_evidence === true || DIRECT_EVIDENCE_RE.test(text);
  const officialConfirmation = profile.official_status && OFFICIAL_CONFIRMATION_RE.test(text);
  return {
    source_id: item.source_id || item.id || null,
    source_name: item.source_name || item.name || null,
    source_type: item.source_type || item.type || item.parser || null,
    source_class: profile.source_class,
    source_tier: profile.source_tier,
    source_reliability: profile.source_reliability,
    source_family: profile.source_family,
    official_status: profile.official_status,
    official_confirmation: officialConfirmation,
    direct_evidence: directEvidence,
    claim_stance: denial ? "denial" : "report",
    url: url || null,
    published_at: item.published_at || item.occurred_at || item.fetched_at || null,
  };
}

function provenanceKey(report = {}) {
  return report.url || [report.source_family, report.source_id, report.published_at].filter(Boolean).join("|");
}

function uniqueReports(reports = []) {
  const seen = new Set();
  return reports.filter((report) => {
    const key = provenanceKey(report);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveCorroborationState(reports = []) {
  const sourceFamilies = new Set(reports.map((report) => report.source_family).filter(Boolean));
  const credibleFamilies = new Set(
    reports
      .filter((report) => [SOURCE_TIERS.TIER_1, SOURCE_TIERS.TIER_2].includes(report.source_tier))
      .map((report) => report.source_family)
      .filter(Boolean)
  );
  const hasReport = reports.some((report) => report.claim_stance !== "denial");
  const hasDenial = reports.some((report) => report.claim_stance === "denial");
  const officialConfirmation = reports.some((report) => report.official_confirmation);
  const directEvidence = reports.some((report) => report.direct_evidence);
  if (hasReport && hasDenial) return CORROBORATION_STATES.DISPUTED;
  if ((officialConfirmation || directEvidence) && sourceFamilies.size >= 2) return CORROBORATION_STATES.CONFIRMED;
  if (sourceFamilies.size >= 2 && credibleFamilies.size >= 1) return CORROBORATION_STATES.CORROBORATED;
  if (reports.some((report) => [SOURCE_TIERS.TIER_1, SOURCE_TIERS.TIER_2].includes(report.source_tier))) return CORROBORATION_STATES.REPORTED;
  return CORROBORATION_STATES.UNVERIFIED;
}

function calculateEvidenceConfidence(reports = [], state = CORROBORATION_STATES.REPORTED) {
  if (!reports.length) return 35;
  const familyReliability = new Map();
  reports.forEach((report) => {
    const family = report.source_family || "unknown";
    familyReliability.set(family, Math.max(familyReliability.get(family) || 0, Number(report.source_reliability || 0)));
  });
  const values = [...familyReliability.values()];
  const highest = Math.max(...values, 0);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  let score = 10 + highest * 0.45 + average * 0.2 + Math.min(20, Math.max(0, values.length - 1) * 10);
  if (reports.some((report) => report.official_confirmation)) score += 8;
  if (reports.some((report) => report.direct_evidence)) score += 6;
  if (state === CORROBORATION_STATES.CONFIRMED) score = Math.max(score, 88);
  if (state === CORROBORATION_STATES.CORROBORATED) score = Math.max(score, 75);
  if (state === CORROBORATION_STATES.REPORTED) score = Math.min(84, Math.max(50, score));
  if (state === CORROBORATION_STATES.UNVERIFIED) score = Math.min(49, score);
  if (state === CORROBORATION_STATES.DISPUTED) score = Math.min(62, Math.max(35, score - 18));
  return Math.max(20, Math.min(98, Math.round(score)));
}

function aggregateEventQuality(items = [], options = {}) {
  const evidence = uniqueReports((Array.isArray(items) ? items : []).map(makeReportEvidence));
  const state = deriveCorroborationState(evidence);
  const sourceFamilies = [...new Set(evidence.map((report) => report.source_family).filter(Boolean))];
  return {
    corroboration_state: state,
    confidence: calculateEvidenceConfidence(evidence, state),
    raw_report_count: evidence.length,
    independent_source_family_count: sourceFamilies.length,
    independent_source_families: sourceFamilies,
    official_confirmation: evidence.some((report) => report.official_confirmation),
    direct_evidence: evidence.some((report) => report.direct_evidence),
    disputed: state === CORROBORATION_STATES.DISPUTED,
    source_provenance: evidence,
    event_fingerprint: options.event_fingerprint || null,
    quality_version: "2026-08-08.phase3-v1",
  };
}

function readEventQuality(value = {}) {
  const metadata = asObject(value.metadata);
  const raw = asObject(value.raw);
  return asObject(value.event_quality || metadata.event_quality || raw._event_quality);
}

function mergeEventQuality(existingValue = {}, incomingValue = {}, options = {}) {
  const existing = readEventQuality(existingValue);
  const incoming = readEventQuality(incomingValue);
  const evidence = [
    ...(Array.isArray(existing.source_provenance) ? existing.source_provenance : []),
    ...(Array.isArray(incoming.source_provenance) ? incoming.source_provenance : []),
  ];
  const normalizedEvidence = uniqueReports(evidence.map((report) => ({
    ...report,
    source_tier: report.source_tier || SOURCE_TIERS.UNRATED,
    source_reliability: Number(report.source_reliability || 55),
    source_family: report.source_family || "unknown",
    claim_stance: report.claim_stance === "denial" ? "denial" : "report",
  })));
  const state = deriveCorroborationState(normalizedEvidence);
  const families = [...new Set(normalizedEvidence.map((report) => report.source_family).filter(Boolean))];
  return {
    corroboration_state: normalizeCorroborationState(state),
    confidence: calculateEvidenceConfidence(normalizedEvidence, state),
    raw_report_count: normalizedEvidence.length,
    independent_source_family_count: families.length,
    independent_source_families: families,
    official_confirmation: normalizedEvidence.some((report) => report.official_confirmation),
    direct_evidence: normalizedEvidence.some((report) => report.direct_evidence),
    disputed: state === CORROBORATION_STATES.DISPUTED,
    source_provenance: normalizedEvidence,
    event_fingerprint: options.event_fingerprint || incoming.event_fingerprint || existing.event_fingerprint || null,
    quality_version: "2026-08-08.phase3-v1",
  };
}

export {
  aggregateEventQuality,
  calculateEvidenceConfidence,
  deriveCorroborationState,
  makeReportEvidence,
  mergeEventQuality,
  readEventQuality,
};
