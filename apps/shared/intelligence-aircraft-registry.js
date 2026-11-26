import entries from "./intelligence-aircraft-registry.json" with { type: "json" };
export const INTELLIGENCE_ROLES = Object.freeze(["AWACS", "AEW&C", "ISR", "SIGINT", "ELINT", "COMINT", "MASINT", "IMINT", "GEOINT", "Maritime surveillance", "Ground surveillance", "Electronic warfare", "Airborne command and control", "Communications relay", "Reconnaissance UAV"]);
export const intelligenceAircraftRegistry = entries;
export function isIntelligenceRole(role) { return /^(awacs|aew|aewc|aew&c|isr|recon|intelligence|surveillance|sigint|elint|comint|masint|imint|geoint|maritime surveillance|ground surveillance|electronic warfare|airborne command and control|communications relay|reconnaissance uav)$/i.test(role); }
export function resolveIntelligenceAircraft(track = {}, role = "") {
    const m = track.metadata || {};
    const identity = [track.model_name, track.title, m.model_name].filter(Boolean).join(" ").toLowerCase();
    // Match mission variants, never a shared civilian ICAO airframe code alone.
    const entry = entries.find(e => [e.model, ...e.aliases].some(name => identity.includes(name.toLowerCase())));
    const eligibleRole = isIntelligenceRole(role);
    if (!eligibleRole) return null;
    return entry || { primaryRole: role, secondaryRoles: [], sensorCategory: null, verificationStatus: "Classification supplied by existing tracker; sensor specifications unavailable", };
}
