// Display reported telemetry only. Render/interpolation defaults are not measurements.
const number = (value) => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export { number as aircraftTelemetryNumber };
const text = (value) => /^(unknown|null|undefined|n\/a)$/i.test(String(value || "").trim()) ? "" : String(value || "").trim();
export function getAircraftTelemetry(track = {}) {
    let metadata = track.metadata || {};
    if (typeof metadata === "string") { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    if (!metadata || typeof metadata !== "object") metadata = {};
    const measured = metadata.telemetry || track.telemetry || {};
    const reported = (key, fallback) => Object.hasOwn(measured, key) ? number(measured[key]) : number(fallback);
    const speed = reported("speed_kts", Object.hasOwn(metadata, "speed_kts") ? metadata.speed_kts : track.speed_kts);
    const altitude = reported("altitude_ft", Object.hasOwn(metadata, "altitude_ft") ? metadata.altitude_ft : track.altitude_ft);
    const trackDegrees = reported("track_deg", metadata.track_deg ?? track.track_deg);
    const trueHeading = reported("true_heading_deg", metadata.true_heading_deg ?? track.true_heading_deg);
    const magneticHeading = reported("mag_heading_deg", metadata.mag_heading_deg ?? track.mag_heading_deg);
    const geometricAltitude = reported("altitude_geom_ft", metadata.altitude_geom_ft ?? track.altitude_geom_ft);
    const direction = trackDegrees != null ? `TRK ${Math.round(trackDegrees)}°`
        : trueHeading != null ? `HDG true ${Math.round(trueHeading)}°`
            : magneticHeading != null ? `HDG mag ${Math.round(magneticHeading)}°`
                : "TRK/HDG N/A";
    const timestamp = (value) => {
        if (value == null || value === "") return "Unavailable";
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : "Unavailable";
    };
    const operator = text(measured.operator ?? metadata.operator ?? track.operator);
    const callsign = text(track.callsign || metadata.callsign || track.flight);
    const source = text(measured.source || track.source_name || track.source || metadata.source);
    const observedAt = Object.hasOwn(measured, "observed_at") ? measured.observed_at : metadata.observed_at || track.occurred_at;
    const observedMs = observedAt == null ? Number.NaN : new Date(observedAt).getTime();
    // Match the existing 90-second aircraft stale timeout; receipt isn't observation freshness.
    const sourceStale = Number.isFinite(observedMs) && Date.now() - observedMs > 90_000;
    const hex = text(track.icao24 || metadata.icao || track.hex).toUpperCase();
    const value = (n, unit) => n == null ? "N/A" : `${Math.round(n).toLocaleString("en-US")} ${unit}`;
    const fields = [
        ["Callsign", callsign || "N/A"], ["ICAO 24-bit Hex", /^[A-F0-9]{6}$/.test(hex) ? hex : "N/A"],
        ["Registration", text(track.registration || metadata.registration) || "N/A"],
        ["Aircraft / ICAO type", [text(track.model_name || metadata.model_name), text(track.type_code || metadata.type_code)].filter(Boolean).join(" / ") || "N/A"],
        ["Reported operator", operator || "Unavailable"], ["Barometric altitude", value(altitude, "ft")],
        ["Geometric altitude", value(geometricAltitude, "ft")], ["Ground speed", value(speed, "kt")],
        ["Ground track", value(trackDegrees, "°")], ["True heading", value(trueHeading, "°")],
        ["Magnetic heading", value(magneticHeading, "°")],
        ["Barometric vertical rate", value(reported("baro_rate_fpm", metadata.baro_rate_fpm), "ft/min")],
        ["Geometric vertical rate", value(reported("geom_rate_fpm", metadata.geom_rate_fpm), "ft/min")],
        ["Vertical rate (unspecified)", value(reported("vertical_rate_fpm", metadata.vertical_rate_fpm), "ft/min")],
        ["Data source", source || "Unavailable"],
        ["Position observed (UTC)", timestamp(observedAt)],
        ["Last received (UTC)", timestamp(track.last_received_at)],
        ["Record updated (UTC)", timestamp(track.updated_at)],
        ["Contact state", track.active === false ? "Ended / stale telemetry" : sourceStale ? "Stale source observation" : track.liveness_state || "Source-reported observation"],
    ];
    return { fields, callsign, operator, country: text(metadata.country), direction, speedLabel: value(speed, "kt"), altitudeLabel: value(altitude, "ft") };
}

export function renderAircraftTelemetry(container, fields, focusPanel = false) {
    const signature = JSON.stringify(fields);
    if (container.dataset.telemetrySignature === signature) return;
    container.dataset.telemetrySignature = signature;
    // Own detail container only; never replaces a shared widget or Cesium parent.
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const [label, value] of fields) {
        const item = document.createElement("span");
        item.dataset.label = label;
        if (focusPanel) {
            item.className = "wz-aircraft-focus-panel__metric";
            const name = document.createElement("span"); name.className = "wz-aircraft-focus-panel__metric-label"; name.textContent = label;
            const content = document.createElement("span"); content.className = "wz-aircraft-focus-panel__metric-value"; content.textContent = value;
            item.append(name, content);
        } else item.textContent = value;
        container.appendChild(item);
    }
}
