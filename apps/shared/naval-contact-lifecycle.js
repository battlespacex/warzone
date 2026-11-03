export const NAVAL_CONTACT_AGE_MS = Object.freeze({
    LIVE: 15 * 60_000,
    DELAYED: 60 * 60_000,
    LAST_KNOWN: 24 * 60 * 60_000,
    HISTORICAL: 7 * 24 * 60 * 60_000,
});

export function getNavalContactStatus(lastSeenAt, now = Date.now()) {
    const seenAt = typeof lastSeenAt === "number" ? lastSeenAt : Date.parse(lastSeenAt);
    if (!Number.isFinite(seenAt) || seenAt <= 0) return "UNKNOWN";
    const age = Math.max(0, now - seenAt);
    if (age <= NAVAL_CONTACT_AGE_MS.LIVE) return "LIVE";
    if (age <= NAVAL_CONTACT_AGE_MS.DELAYED) return "DELAYED";
    if (age <= NAVAL_CONTACT_AGE_MS.LAST_KNOWN) return "LAST KNOWN";
    if (age <= NAVAL_CONTACT_AGE_MS.HISTORICAL) return "HISTORICAL";
    return "ARCHIVED";
}

export function matchesNavalContactStatus(status, filter = "recent") {
    if (filter === "all") return true;
    if (filter === "recent") return status === "LIVE" || status === "DELAYED" || status === "LAST KNOWN";
    return status.toLowerCase().replace(/\s+/g, "_") === filter;
}
