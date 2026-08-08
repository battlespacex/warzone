import {
    CORROBORATION_STATES,
    SOURCE_CLASSES,
    SOURCE_TIERS,
    normalizeCorroborationState,
    resolveSourceProfile,
} from "../../shared/source-quality-policy.js";

function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteCount(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function getPublicEventQuality(item = {}) {
    const metadata = asObject(item.metadata);
    const raw = asObject(item.raw);
    const quality = asObject(item.event_quality || metadata.event_quality || raw._event_quality);
    const profile = resolveSourceProfile(item);
    const fallbackState = [SOURCE_CLASSES.TELEGRAM, SOURCE_CLASSES.SOCIAL, SOURCE_CLASSES.OSINT].includes(profile.source_class)
        || profile.source_tier === SOURCE_TIERS.TIER_3
        ? CORROBORATION_STATES.UNVERIFIED
        : CORROBORATION_STATES.REPORTED;
    const corroborationState = normalizeCorroborationState(quality.corroboration_state, fallbackState);

    return {
        corroboration_state: corroborationState,
        verification_state: corroborationState,
        raw_report_count: finiteCount(quality.raw_report_count, 1),
        independent_source_family_count: finiteCount(quality.independent_source_family_count, 1),
        official_confirmation: quality.official_confirmation === true,
        direct_evidence: quality.direct_evidence === true,
        disputed: quality.disputed === true || corroborationState === CORROBORATION_STATES.DISPUTED,
        source_class: quality.source_class || profile.source_class,
        source_tier: quality.source_tier || profile.source_tier,
        source_reliability: finiteCount(quality.source_reliability, profile.source_reliability),
    };
}

export { getPublicEventQuality };
