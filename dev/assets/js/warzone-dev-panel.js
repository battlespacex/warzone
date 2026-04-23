// File Path: /assets/js/warzone-dev-panel.js
import * as Cesium from "cesium";
import {
    handleIncomingEvent,
    triggerWarzoneAlert
} from "./essential.js";
import {
    startDevTrackSimulation,
    stopDevTrackSimulation,
    setAircraftModelHeadingOffset
} from "./warzone-live-airforce.js";
import { setNavalModelHeadingOffset } from "./warzone-live-naval.js";
import { showSirenAlert } from "./warzone-siren-alert.js";
/* ================= TEST EVENT TEMPLATES ================= */
const TEST_EVENTS = {
    missile_iran_israel: {
        id: "test-missile-1",
        title: "Ballistic Missile Launch Detected",
        summary: "MRBM launch detected from western Iran. Trajectory consistent with Israeli territory.",
        category: "strike",
        subcategory: "missile",
        weapon_type: "ballistic_missile",
        severity: "critical",
        lat: 32.08,
        lon: 34.78,
        impact_lat: 32.08,
        impact_lon: 34.78,
        origin_lat: 32.42,
        origin_lon: 53.69,
        origin_label: "Isfahan, Iran",
        impact_label: "Tel Aviv, Israel",
        location_label: "Israel",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    missile_russia_ukraine: {
        id: "test-missile-2",
        title: "Cruise Missile Strike — Kyiv Oblast",
        summary: "Multiple cruise missiles detected inbound. Air defense activated.",
        category: "strike",
        subcategory: "cruise_missile",
        weapon_type: "cruise_missile",
        severity: "critical",
        lat: 50.45,
        lon: 30.52,
        impact_lat: 50.45,
        impact_lon: 30.52,
        origin_lat: 55.75,
        origin_lon: 37.61,
        origin_label: "Moscow region",
        impact_label: "Kyiv, Ukraine",
        location_label: "Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    drone_kamikaze: {
        id: "test-drone-1",
        title: "Shahed-136 Drone Strike",
        summary: "Multiple loitering munitions detected. Moving in formation toward target.",
        category: "strike",
        subcategory: "drone",
        weapon_type: "drone",
        severity: "high",
        lat: 49.84,
        lon: 24.02,
        impact_lat: 49.84,
        impact_lon: 24.02,
        origin_lat: 47.51,
        origin_lon: 34.25,
        origin_label: "Zaporizhzhia region",
        impact_label: "Lviv, Ukraine",
        location_label: "Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    airstrike: {
        id: "test-airstrike-1",
        title: "IAF Air Strike — Southern Lebanon",
        summary: "Israeli Air Force conducted precision strikes on infrastructure targets.",
        category: "strike",
        subcategory: "airstrike",
        weapon_type: "air_strike",
        severity: "high",
        lat: 33.27,
        lon: 35.2,
        impact_lat: 33.27,
        impact_lon: 35.2,
        origin_lat: 32.08,
        origin_lon: 34.78,
        origin_label: "Israel",
        impact_label: "Southern Lebanon",
        location_label: "Lebanon",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    siren_israel: {
        id: "test-siren-1",
        title: "Red Alert — Air Raid Sirens Active",
        summary: "Sirens activated across Tel Aviv metropolitan area. Incoming threat detected.",
        category: "alert",
        subcategory: "siren",
        weapon_type: "unknown",
        severity: "critical",
        lat: 32.08,
        lon: 34.78,
        impact_lat: 32.08,
        impact_lon: 34.78,
        location_label: "Tel Aviv, Israel",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    siren_ukraine: {
        id: "test-siren-2",
        title: "Air Raid Warning — Kyiv",
        summary: "Air raid sirens activated. Take shelter immediately.",
        category: "alert",
        subcategory: "siren",
        severity: "critical",
        lat: 50.45,
        lon: 30.52,
        impact_lat: 50.45,
        impact_lon: 30.52,
        location_label: "Kyiv, Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    aircraft_fighter: {
        id: "test-aircraft-fighter-1",
        title: "FIGHTER F-35I — IAF",
        summary: "Israeli Air Force F-35I Adir detected. Combat patrol.",
        category: "military",
        subcategory: "fighter",
        severity: "medium",
        lat: 31.5,
        lon: 34.9,
        location_label: "Israel",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "IAF101", heading: 45, altitude_ft: 35000, speed_kts: 80, country: "Israel" },
        source_key: "adsb-test-fighter-1",
    },
    aircraft_awacs: {
        id: "test-aircraft-awacs-1",
        title: "AWACS E-3 Sentry — NATO",
        summary: "NATO Airborne Warning and Control System on patrol over Eastern Europe.",
        category: "military",
        subcategory: "awacs",
        severity: "medium",
        lat: 50.06,
        lon: 19.94,
        location_label: "Poland",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "NAEW01", heading: 270, altitude_ft: 29000, speed_kts: 80, country: "NATO" },
        source_key: "adsb-test-awacs-1",
    },
    aircraft_recon: {
        id: "test-aircraft-recon-1",
        title: "RECON RC-135 Rivet Joint — USAF",
        summary: "USAF signals intelligence aircraft conducting ISR mission.",
        category: "military",
        subcategory: "recon",
        severity: "medium",
        lat: 37.06,
        lon: 36.16,
        location_label: "Turkey / Syria border",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "JAKE21", heading: 180, altitude_ft: 40000, speed_kts: 420, country: "USA" },
        source_key: "adsb-test-recon-1",
    },
    aircraft_tanker: {
        id: "test-aircraft-tanker-1",
        title: "TANKER KC-135 — USAF AMC",
        summary: "Air Mobility Command tanker on refueling mission.",
        category: "military",
        subcategory: "tanker",
        severity: "low",
        lat: 48.2,
        lon: 16.37,
        location_label: "Austria / Germany region",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "RCH456", heading: 90, altitude_ft: 31000, speed_kts: 440, country: "USA" },
        source_key: "adsb-test-tanker-1",
    },
    ship_carrier: {
        id: "test-ship-carrier-1",
        title: "CARRIER USS Gerald R. Ford — USN",
        summary: "US Navy carrier strike group operating in Eastern Mediterranean.",
        category: "military",
        subcategory: "carrier",
        severity: "high",
        lat: 35.2,
        lon: 28.5,
        location_label: "Eastern Mediterranean",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "USS GERALD R FORD", mmsi: "338123456", heading: 135, speed_kts: 18, country: "USA" },
        source_key: "ais-test-carrier-1",
    },
    ship_destroyer: {
        id: "test-ship-destroyer-1",
        title: "DESTROYER USS Arleigh Burke — USN",
        summary: "Guided missile destroyer on patrol. Part of carrier strike group.",
        category: "military",
        subcategory: "destroyer",
        severity: "medium",
        lat: 35.5,
        lon: 29.2,
        location_label: "Eastern Mediterranean",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "USS ARLEIGH BURKE", mmsi: "338789012", heading: 200, speed_kts: 22, country: "USA" },
        source_key: "ais-test-destroyer-1",
    },
    ship_russian: {
        id: "test-ship-russian-1",
        title: "FRIGATE Admiral Gorshkov — Russian Navy",
        summary: "Russian Navy frigate operating in Black Sea.",
        category: "military",
        subcategory: "frigate",
        severity: "high",
        lat: 44.6,
        lon: 33.52,
        location_label: "Black Sea",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "ADMIRAL GORSHKOV", mmsi: "273456789", heading: 90, speed_kts: 15, country: "Russia" },
        source_key: "ais-test-russian-1",
    },
    cyber: {
        id: "test-cyber-1",
        title: "Critical Infrastructure Attack — Iran",
        summary: "State-sponsored cyber operation targeting power grid SCADA systems.",
        category: "cyber",
        subcategory: "cyber",
        severity: "high",
        lat: 35.69,
        lon: 51.38,
        location_label: "Tehran, Iran",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
    thermal: {
        id: "test-thermal-1",
        title: "Thermal Anomaly — Possible Strike Signature",
        summary: "NASA FIRMS satellite detected high-intensity thermal event. Consistent with explosion or fire.",
        category: "thermal",
        subcategory: "thermal",
        severity: "medium",
        lat: 33.51,
        lon: 36.29,
        location_label: "Damascus, Syria",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
};
const TEST_TRACK_ROUTES = {
    fighter_gulf_run: {
        track_key: "dev-track-fighter-1",
        title: "F-22 Demo Patrol",
        source_name: "DEV PANEL",
        category: "military",
        subcategory: "fighter",
        country: "USA",
        region: "Middle East",
        from: {
            lat: 26.7854,
            lon: 51.5310,
            altitude_ft: 32000,
            heading_deg: 90,
        },
        to: {
            lat: 27.3854,
            lon: 52.4310,
            altitude_ft: 34000,
            heading_deg: 135,
        },
        steps: 80,
        intervalMs: 180,
        loop: false,
    },
    fighter_orbit_right: {
        track_key: "dev-track-circle-right",
        title: "F-22 101",
        source_name: "DEV PANEL",
        category: "military",
        subcategory: "fighter",
        country: "USA",
        region: "Middle East",
        mode: "orbit-right",
        center: {
            lat: 31.9,
            lon: 35.2,
        },
        radiusMeters: 25000,
        altitude_ft: 32000,
        startAngleDeg: 0,
        steps: 120,
        intervalMs: 140,
        loop: true,
    },
    fighter_orbit_left: {
        track_key: "dev-track-circle-left",
        title: "F-22 101",
        source_name: "DEV PANEL",
        category: "military",
        subcategory: "fighter",
        country: "USA",
        region: "Middle East",
        mode: "orbit-left",
        center: {
            lat: 31.9,
            lon: 35.2,
        },
        radiusMeters: 25000,
        altitude_ft: 32000,
        startAngleDeg: 0,
        steps: 120,
        intervalMs: 140,
        loop: true,
    },
    fighter_turn_test: {
        track_key: "dev-track-turns",
        title: "F-16 Sq Detected",
        source_name: "DEV PANEL",
        category: "military",
        subcategory: "fighter",
        country: "USA",
        region: "Middle East",
        mode: "route",
        waypoints: [
            { lat: 31.2, lon: 34.4, altitude_ft: 32000, heading_deg: 60 },
            { lat: 31.8, lon: 35.0, altitude_ft: 32000, heading_deg: 90 },
            { lat: 32.3, lon: 35.8, altitude_ft: 32000, heading_deg: 135 },
            { lat: 31.9, lon: 36.5, altitude_ft: 32000, heading_deg: 210 },
            { lat: 31.1, lon: 36.0, altitude_ft: 32000, heading_deg: 270 },
        ],
        steps: 140,
        intervalMs: 140,
        loop: true,
    },
};
const DEV_SIM_PRESETS = {
    fighter: {
        track_key: "dev-sim-fighter",
        title: "Live Fighter Test",
        country: "USA",
        lat: 31.5,
        lon: 34.9,
        toLat: 31.95,
        toLon: 35.45,
        altitudeFt: 35000,
        headingDeg: 45,
        radiusMeters: 25000,
        steps: 120,
        intervalMs: 140,
        loop: true,
        motion: "route",
    },
    awacs: {
        track_key: "dev-sim-awacs",
        title: "Live AWACS Test",
        country: "NATO",
        lat: 50.06,
        lon: 19.94,
        toLat: 50.4,
        toLon: 20.5,
        altitudeFt: 29000,
        headingDeg: 270,
        radiusMeters: 38000,
        steps: 140,
        intervalMs: 170,
        loop: true,
        motion: "orbit-right",
    },
    recon: {
        track_key: "dev-sim-recon",
        title: "Live Recon Test",
        country: "USA",
        lat: 37.06,
        lon: 36.16,
        toLat: 37.8,
        toLon: 37.2,
        altitudeFt: 40000,
        headingDeg: 180,
        radiusMeters: 22000,
        steps: 150,
        intervalMs: 170,
        loop: true,
        motion: "route",
    },
    tanker: {
        track_key: "dev-sim-tanker",
        title: "Live Tanker Test",
        country: "USA",
        lat: 48.2,
        lon: 16.37,
        toLat: 48.9,
        toLon: 17.2,
        altitudeFt: 31000,
        headingDeg: 90,
        radiusMeters: 28000,
        steps: 160,
        intervalMs: 180,
        loop: true,
        motion: "route",
    },
    drone: {
        track_key: "dev-sim-drone",
        title: "Live UAV Test",
        country: "Unknown",
        lat: 33.8,
        lon: 36.2,
        toLat: 34.1,
        toLon: 36.6,
        altitudeFt: 18000,
        headingDeg: 120,
        radiusMeters: 18000,
        steps: 150,
        intervalMs: 190,
        loop: true,
        motion: "orbit-left",
    },
    uav: {
        track_key: "dev-sim-uav",
        title: "Live UAV Test",
        country: "Unknown",
        lat: 33.8,
        lon: 36.2,
        toLat: 34.1,
        toLon: 36.6,
        altitudeFt: 18000,
        headingDeg: 120,
        radiusMeters: 18000,
        steps: 150,
        intervalMs: 190,
        loop: true,
        motion: "orbit-left",
    },
    helicopter: {
        track_key: "dev-sim-helicopter",
        title: "Live Helicopter Test",
        country: "Unknown",
        lat: 34.3,
        lon: 36.0,
        toLat: 34.6,
        toLon: 36.25,
        altitudeFt: 9000,
        headingDeg: 80,
        radiusMeters: 12000,
        steps: 140,
        intervalMs: 170,
        loop: true,
        motion: "route",
    },
    transport: {
        track_key: "dev-sim-transport",
        title: "Live Transport Test",
        country: "Unknown",
        lat: 25.2,
        lon: 55.3,
        toLat: 26.1,
        toLon: 56.1,
        altitudeFt: 28000,
        headingDeg: 60,
        radiusMeters: 26000,
        steps: 150,
        intervalMs: 180,
        loop: true,
        motion: "route",
    },
    logistics: {
        track_key: "dev-sim-logistics",
        title: "Live Logistics Test",
        country: "Unknown",
        lat: 25.2,
        lon: 55.3,
        toLat: 26.1,
        toLon: 56.1,
        altitudeFt: 28000,
        headingDeg: 60,
        radiusMeters: 26000,
        steps: 150,
        intervalMs: 180,
        loop: true,
        motion: "route",
    },
};
function devLog(msg) {
    const log = document.getElementById("wz-dev-log");
    if (!log) return;
    const line = document.createElement("div");
    line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    log.prepend(line);
    while (log.children.length > 20) {
        log.removeChild(log.lastChild);
    }
}
function getDevSimElements() {
    return {
        subtype: document.getElementById("wz-dev-sim-subtype"),
        motion: document.getElementById("wz-dev-sim-motion"),
        trackKey: document.getElementById("wz-dev-sim-trackkey"),
        title: document.getElementById("wz-dev-sim-title"),
        country: document.getElementById("wz-dev-sim-country"),
        lat: document.getElementById("wz-dev-sim-lat"),
        lon: document.getElementById("wz-dev-sim-lon"),
        toLat: document.getElementById("wz-dev-sim-to-lat"),
        toLon: document.getElementById("wz-dev-sim-to-lon"),
        altitudeFt: document.getElementById("wz-dev-sim-altitude"),
        headingDeg: document.getElementById("wz-dev-sim-heading"),
        radiusMeters: document.getElementById("wz-dev-sim-radius"),
        steps: document.getElementById("wz-dev-sim-steps"),
        intervalMs: document.getElementById("wz-dev-sim-interval"),
        loop: document.getElementById("wz-dev-sim-loop"),
        startBtn: document.getElementById("wz-dev-sim-start"),
        stopBtn: document.getElementById("wz-dev-sim-stop"),
        focusBtn: document.getElementById("wz-dev-sim-focus"),
        resetBtn: document.getElementById("wz-dev-sim-reset"),
    };
}
function normalizeDevTrackKey(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
function getStableDevSimTrackKey(subtype = "fighter") {
    return `dev-sim-${normalizeDevTrackKey(subtype || "fighter")}`;
}
function getQuickAircraftTrackKey(event = {}) {
    const sourceKey = normalizeDevTrackKey(event.source_key || event.id || event.subcategory || "aircraft");
    return `dev-quick-${sourceKey}`;
}
function restartDevSimulation(config, logLabel = "") {
    if (!config?.track_key) return;
    stopDevTrackSimulation(config.track_key);
    setTimeout(() => {
        startDevTrackSimulation(config);
    }, 40);
    if (logLabel) {
        devLog(logLabel);
    }
    document.dispatchEvent(new CustomEvent("wz:aircraft-log-updated"));
}
function updateDevSimTrackKey(subtype) {
    const els = getDevSimElements();
    if (!els.trackKey) return;
    const current = String(els.trackKey.value || "").trim();
    if (!current || current.startsWith("dev-sim-")) {
        els.trackKey.value = getStableDevSimTrackKey(subtype);
    }
}
function applyDevSimPreset(subtype = "fighter") {
    const preset = DEV_SIM_PRESETS[subtype] || DEV_SIM_PRESETS.fighter;
    const els = getDevSimElements();
    if (!els.subtype) return;
    els.subtype.value = subtype;
    els.motion.value = preset.motion;
    els.trackKey.value = preset.track_key || getStableDevSimTrackKey(subtype);
    els.title.value = preset.title;
    els.country.value = preset.country;
    els.lat.value = preset.lat;
    els.lon.value = preset.lon;
    els.toLat.value = preset.toLat;
    els.toLon.value = preset.toLon;
    els.altitudeFt.value = preset.altitudeFt;
    els.headingDeg.value = preset.headingDeg;
    els.radiusMeters.value = preset.radiusMeters;
    els.steps.value = preset.steps;
    els.intervalMs.value = preset.intervalMs;
    els.loop.checked = Boolean(preset.loop);
    syncDevSimFieldState();
}
function syncDevSimFieldState() {
    const els = getDevSimElements();
    if (!els.motion) return;
    const motion = els.motion.value;
    const isOrbit = motion === "orbit-right" || motion === "orbit-left";
    const isTurn = motion === "turn-test";
    [els.toLat, els.toLon].forEach((input) => {
        if (!input) return;
        input.disabled = isOrbit || isTurn;
        input.closest(".wz-dev-field")?.classList.toggle("is-disabled", isOrbit || isTurn);
    });
    if (els.radiusMeters) {
        els.radiusMeters.disabled = !isOrbit;
        els.radiusMeters.closest(".wz-dev-field")?.classList.toggle("is-disabled", !isOrbit);
    }
}
function buildGeneratedTurnWaypoints(baseLat, baseLon, altitudeFt, headingDeg) {
    return [
        { lat: baseLat, lon: baseLon, altitude_ft: altitudeFt, heading_deg: headingDeg },
        { lat: baseLat + 0.45, lon: baseLon + 0.45, altitude_ft: altitudeFt, heading_deg: headingDeg + 35 },
        { lat: baseLat + 0.95, lon: baseLon + 1.0, altitude_ft: altitudeFt, heading_deg: headingDeg + 80 },
        { lat: baseLat + 0.35, lon: baseLon + 1.45, altitude_ft: altitudeFt, heading_deg: headingDeg + 155 },
        { lat: baseLat - 0.25, lon: baseLon + 0.9, altitude_ft: altitudeFt, heading_deg: headingDeg + 240 },
    ];
}
function buildDevSimConfigFromForm() {
    const els = getDevSimElements();
    if (!els.subtype) return null;
    const subtype = String(els.subtype.value || "fighter").toLowerCase();
    const motion = String(els.motion.value || "route").toLowerCase();
    const trackKey = normalizeDevTrackKey(els.trackKey.value) || getStableDevSimTrackKey(subtype);
    const title = String(els.title.value || `Live ${subtype} Test`).trim();
    const country = String(els.country.value || "Unknown").trim();
    const lat = Number(els.lat.value);
    const lon = Number(els.lon.value);
    const toLat = Number(els.toLat.value);
    const toLon = Number(els.toLon.value);
    const altitudeFt = Number(els.altitudeFt.value || 32000);
    const headingDeg = Number(els.headingDeg.value || 0);
    const radiusMeters = Number(els.radiusMeters.value || 25000);
    const steps = Number(els.steps.value || 120);
    const intervalMs = Number(els.intervalMs.value || 140);
    const loop = Boolean(els.loop.checked);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const base = {
        track_key: trackKey,
        title,
        source_name: "DEV PANEL",
        category: "military",
        subcategory: subtype,
        country,
        region: "global",
        steps,
        intervalMs,
        loop,
    };
    if (motion === "orbit-right" || motion === "orbit-left") {
        return {
            ...base,
            mode: motion,
            center: { lat, lon },
            radiusMeters,
            altitude_ft: altitudeFt,
            startAngleDeg: headingDeg,
        };
    }
    if (motion === "turn-test") {
        return {
            ...base,
            mode: "route",
            waypoints: buildGeneratedTurnWaypoints(lat, lon, altitudeFt, headingDeg),
        };
    }
    return {
        ...base,
        mode: "route",
        from: {
            lat,
            lon,
            altitude_ft: altitudeFt,
            heading_deg: headingDeg,
        },
        to: {
            lat: Number.isFinite(toLat) ? toLat : lat + 0.5,
            lon: Number.isFinite(toLon) ? toLon : lon + 0.6,
            altitude_ft: altitudeFt,
            heading_deg: headingDeg + 35,
        },
    };
}
function focusDevSimFromForm() {
    const els = getDevSimElements();
    const lat = Number(els.lat?.value);
    const lon = Number(els.lon?.value);
    const viewer = window.__warzoneViewer;
    if (!viewer || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 900000),
        duration: 1.2,
    });
}
function isStrikeLikeEvent(event) {
    const weaponType = String(event.weapon_type || "").toLowerCase();
    const subcategory = String(event.subcategory || "").toLowerCase();
    return (
        event.origin_lat != null &&
        event.origin_lon != null &&
        (
            weaponType.includes("missile") ||
            weaponType.includes("drone") ||
            weaponType.includes("air_strike") ||
            subcategory.includes("missile") ||
            subcategory.includes("drone")
        )
    );
}
function buildDevSirenMeta(event) {
    const weaponType = String(event.weapon_type || "").toLowerCase();
    const subcategory = String(event.subcategory || "").toLowerCase();
    if (weaponType.includes("drone") || subcategory.includes("drone")) {
        return "via DEV TEST · INCOMING UAV / DRONE THREAT";
    }
    if (weaponType.includes("air_strike")) {
        return "via DEV TEST · AIR STRIKE WARNING";
    }
    if (weaponType.includes("missile") || subcategory.includes("missile")) {
        return "via DEV TEST · TAKE SHELTER IMMEDIATELY";
    }
    return "via DEV TEST · INCOMING STRIKE";
}
function getSirenLevel(severity) {
    if (severity === "critical") return "red";
    if (severity === "high") return "orange";
    return "yellow";
}
function buildQuickAircraftSimulationConfig(event, trackKey) {
    const baseLat = Number(event.lat);
    const baseLon = Number(event.lon);
    const headingDeg = Number(event.metadata?.heading || 0);
    const altitudeFt = Number(event.metadata?.altitude_ft || 32000);
    const subtype = String(event.subcategory || "fighter").toLowerCase();
    if (!Number.isFinite(baseLat) || !Number.isFinite(baseLon)) return null;
    const base = {
        track_key: trackKey,
        title: event.title,
        source_name: "DEV PANEL",
        category: "military",
        subcategory: subtype,
        country: event.metadata?.country || "Unknown",
        region: "global",
    };
    if (subtype === "awacs") {
        return {
            ...base,
            mode: "orbit-right",
            center: { lat: baseLat, lon: baseLon },
            radiusMeters: 38000,
            altitude_ft: altitudeFt,
            startAngleDeg: headingDeg,
            steps: 140,
            intervalMs: 170,
            loop: true,
        };
    }
    if (subtype === "recon") {
        return {
            ...base,
            from: {
                lat: baseLat,
                lon: baseLon,
                altitude_ft: altitudeFt,
                heading_deg: headingDeg,
            },
            to: {
                lat: baseLat + 0.9,
                lon: baseLon + 1.1,
                altitude_ft: altitudeFt,
                heading_deg: headingDeg + 20,
            },
            steps: 150,
            intervalMs: 170,
            loop: true,
        };
    }
    if (subtype === "tanker") {
        return {
            ...base,
            from: {
                lat: baseLat,
                lon: baseLon,
                altitude_ft: altitudeFt,
                heading_deg: headingDeg,
            },
            to: {
                lat: baseLat + 0.7,
                lon: baseLon + 0.9,
                altitude_ft: altitudeFt,
                heading_deg: headingDeg + 12,
            },
            steps: 160,
            intervalMs: 180,
            loop: true,
        };
    }
    if (subtype === "drone" || subtype === "uav") {
        return {
            ...base,
            mode: "orbit-left",
            center: { lat: baseLat, lon: baseLon },
            radiusMeters: 18000,
            altitude_ft: altitudeFt,
            startAngleDeg: headingDeg,
            steps: 150,
            intervalMs: 190,
            loop: true,
        };
    }
    return {
        ...base,
        from: {
            lat: baseLat,
            lon: baseLon,
            altitude_ft: altitudeFt,
            heading_deg: headingDeg,
        },
        to: {
            lat: baseLat + 0.6,
            lon: baseLon + 0.8,
            altitude_ft: altitudeFt,
            heading_deg: headingDeg + 25,
        },
        steps: 120,
        intervalMs: 140,
        loop: true,
    };
}
function fireTestEvent(key) {
    const template = TEST_EVENTS[key];
    if (!template) return;
    const event = {
        ...template,
        id: `${template.id}-${Date.now()}`,
        occurred_at: new Date().toISOString(),
    };
    const globe = window.__warzoneViewer?.__warzone;
    handleIncomingEvent(event);
    if (isStrikeLikeEvent(event)) {
        const impactLabel = String(
            event.impact_label || event.location_label || "IMPACT ZONE"
        ).toUpperCase();
        showSirenAlert({
            title: `SIRENS GOING OFF IN: ${impactLabel}`,
            meta: buildDevSirenMeta(event),
            level: getSirenLevel(event.severity),
            sound: true,
        });
        devLog(`🚀 Fired: ${event.title} → Siren: ${impactLabel}`);
    }
    if (
        event.category === "alert" ||
        String(`${event.title} ${event.summary}`).toLowerCase().includes("siren")
    ) {
        triggerWarzoneAlert({
            title: event.title,
            location: event.location_label,
            level: "critical",
            playSound: true,
        });
        globe?.highlightAlertRegion?.(event);
        devLog(`🔴 Alert: ${event.title}`);
        return;
    }
    if (event.category === "military") {
        const trackKey = getQuickAircraftTrackKey(event);
        const config = buildQuickAircraftSimulationConfig(event, trackKey);
        if (!config) return;
        restartDevSimulation(
            config,
            `✈ LIVE AIRCRAFT: ${event.title} [${config.subcategory}]`
        );
        return;
    }
    devLog(`📍 Event: ${event.title}`);
}
function initDevSimulatorControls() {
    const els = getDevSimElements();
    if (!els.subtype) return;
    els.subtype.addEventListener("change", () => {
        const subtype = String(els.subtype.value || "fighter").toLowerCase();
        applyDevSimPreset(subtype);
        updateDevSimTrackKey(subtype);
        devLog(`🧪 Preset loaded: ${subtype}`);
    });
    els.motion.addEventListener("change", () => {
        syncDevSimFieldState();
    });
    els.resetBtn?.addEventListener("click", () => {
        const subtype = String(els.subtype.value || "fighter").toLowerCase();
        applyDevSimPreset(subtype);
        updateDevSimTrackKey(subtype);
        devLog(`↺ Simulator reset: ${subtype}`);
    });
    els.focusBtn?.addEventListener("click", () => {
        focusDevSimFromForm();
        devLog("🎯 Simulator focus moved");
    });
    els.startBtn?.addEventListener("click", () => {
        const config = buildDevSimConfigFromForm();
        if (!config) {
            devLog("⚠ Invalid simulator coordinates");
            return;
        }
        els.trackKey.value = config.track_key;
        restartDevSimulation(
            config,
            `✈ Simulator started: ${config.title} [${config.subcategory}]`
        );
    });
    els.stopBtn?.addEventListener("click", () => {
        const trackKey = normalizeDevTrackKey(els.trackKey?.value || "");
        if (!trackKey) {
            devLog("⚠ No track key to stop");
            return;
        }
        stopDevTrackSimulation(trackKey);
        devLog(`✖ Simulator stopped: ${trackKey}`);
    });
    applyDevSimPreset("fighter");
    updateDevSimTrackKey("fighter");
}

const DEV_MAP_TUNER_FIELDS = [
    { key: "saturation", cssVar: "--warzone-map-saturation", min: 0, max: 2, step: 0.01, fallback: 0.2 },
    { key: "brightness", cssVar: "--warzone-map-brightness", min: 0, max: 2, step: 0.01, fallback: 0.8 },
    { key: "contrast", cssVar: "--warzone-map-contrast", min: 0, max: 3, step: 0.01, fallback: 1.2 },
    { key: "gamma", cssVar: "--warzone-map-gamma", min: 0, max: 2, step: 0.01, fallback: 0.7 },
    { key: "hue", cssVar: "--warzone-map-hue", min: -360, max: 360, step: 1, fallback: 170 },
    { key: "tint", cssVar: "--warzone-map-tint", min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: "warmth", cssVar: "--warzone-map-warmth", min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: "red", cssVar: "--warzone-map-red-level", min: 0, max: 2, step: 0.01, fallback: 1 },
    { key: "green", cssVar: "--warzone-map-green-level", min: 0, max: 2, step: 0.01, fallback: 1 },
    { key: "blue", cssVar: "--warzone-map-blue-level", min: 0, max: 2, step: 0.01, fallback: 1 },
    { key: "cyan", cssVar: "--warzone-map-cyan-level", min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: "magenta", cssVar: "--warzone-map-magenta-level", min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: "yellow", cssVar: "--warzone-map-yellow-level", min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: "alpha", cssVar: "--warzone-map-alpha", min: 0, max: 1, step: 0.01, fallback: 1 },
];

let __devMapRefreshRaf = 0;

function getStepPrecision(step = 1) {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot >= 0 ? text.length - dot - 1 : 0;
}
function clampDevMapValue(value, def) {
    const next = Number(value);
    if (!Number.isFinite(next)) return Number(def.fallback);
    return Math.max(def.min, Math.min(def.max, next));
}
function formatDevMapValue(value, def) {
    const precision = getStepPrecision(def.step);
    const rounded = Number(clampDevMapValue(value, def).toFixed(precision));
    return precision > 0 ? rounded.toFixed(precision) : String(Math.round(rounded));
}
function getRootCssNumber(varName, fallback = 0) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function refreshMapOnlyNow() {
    const viewer = window.__warzoneViewer;
    viewer?.__warzone?.refreshMapTuning?.();
    viewer?.scene?.requestRender?.();
}
function requestMapOnlyRefresh() {
    if (__devMapRefreshRaf) return;
    __devMapRefreshRaf = requestAnimationFrame(() => {
        __devMapRefreshRaf = 0;
        refreshMapOnlyNow();
    });
}
function buildMapRootCssBlock(values = {}) {
    const lines = [":root {"];
    DEV_MAP_TUNER_FIELDS.forEach((def) => {
        const value = values[def.key] ?? getRootCssNumber(def.cssVar, def.fallback);
        lines.push(`    ${def.cssVar}: ${formatDevMapValue(value, def)};`);
    });
    lines.push("}");
    return lines.join("\n");
}
function initMapTunerControls() {
    const root = document.documentElement;
    const tunerRoot = document.getElementById("wz-dev-map-tuner");
    if (!tunerRoot || tunerRoot.dataset.bound === "1") return;
    tunerRoot.dataset.bound = "1";

    const output = document.getElementById("wz-map-css-output");
    const refreshBtn = document.getElementById("wz-map-refresh-only");
    const loadCurrentBtn = document.getElementById("wz-map-load-current");
    const copyBtn = document.getElementById("wz-map-copy-css");
    const controls = new Map();

    const updateOutput = () => {
        if (!output) return;
        const values = {};
        DEV_MAP_TUNER_FIELDS.forEach((def) => {
            const entry = controls.get(def.key);
            if (!entry) return;
            values[def.key] = Number(entry.input.value);
        });
        output.value = buildMapRootCssBlock(values);
    };
    const applyControlValue = (def, nextValue, source = "") => {
        const entry = controls.get(def.key);
        if (!entry) return;
        const clamped = clampDevMapValue(nextValue, def);
        const formatted = formatDevMapValue(clamped, def);
        if (source !== "range") entry.range.value = formatted;
        if (source !== "input") entry.input.value = formatted;
        root.style.setProperty(def.cssVar, formatted);
        updateOutput();
        requestMapOnlyRefresh();
    };
    const loadCurrentValues = () => {
        DEV_MAP_TUNER_FIELDS.forEach((def) => {
            const current = getRootCssNumber(def.cssVar, def.fallback);
            applyControlValue(def, current);
        });
    };

    DEV_MAP_TUNER_FIELDS.forEach((def) => {
        const range = document.getElementById(`wz-map-${def.key}-range`);
        const input = document.getElementById(`wz-map-${def.key}-input`);
        if (!range || !input) return;
        range.min = String(def.min);
        range.max = String(def.max);
        range.step = String(def.step);
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        controls.set(def.key, { range, input });
        const initial = getRootCssNumber(def.cssVar, def.fallback);
        applyControlValue(def, initial);
        range.addEventListener("input", () => applyControlValue(def, range.value, "range"));
        input.addEventListener("input", () => applyControlValue(def, input.value, "input"));
        input.addEventListener("change", () => applyControlValue(def, input.value, "input"));
    });

    refreshBtn?.addEventListener("click", () => {
        refreshMapOnlyNow();
        devLog("🗺 Map-only refresh triggered");
    });
    loadCurrentBtn?.addEventListener("click", () => {
        loadCurrentValues();
        devLog("↺ Loaded current map CSS values");
    });
    copyBtn?.addEventListener("click", async () => {
        const text = output?.value || buildMapRootCssBlock();
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                output?.focus();
                output?.select();
                document.execCommand("copy");
            }
            devLog("📋 Copied :root map block");
        } catch {
            devLog("⚠ Copy blocked — select and copy manually");
        }
    });

    updateOutput();
    refreshMapOnlyNow();
}
export function initDevPanel() {
    const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "" ||
        window.location.search.includes("devpanel=1") ||
        localStorage.getItem("wz_dev") === "1";
    const panel = document.getElementById("wz-dev-panel");
    if (!panel) {
        console.warn("[DevPanel] #wz-dev-panel not found — ensure partials/popups.html is loaded.");
        return;
    }
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "`" || e.key === "~" || e.code === "Backquote")) {
            e.preventDefault();
            if (panel.hidden) {
                panel.hidden = false;
                localStorage.setItem("wz_dev", "1");
                devLog("🔑 Dev panel unlocked via keyboard shortcut");
                console.log("[dev] Warzone dev panel activated — Ctrl+Shift+` pressed");
            } else {
                const body = document.getElementById("wz-dev-body");
                if (body) body.hidden = !body.hidden;
            }
        }
    });
    if (!isLocal) return;
    panel.hidden = false;
    document.getElementById("wz-dev-toggle")?.addEventListener("click", () => {
        const body = document.getElementById("wz-dev-body");
        if (body) body.hidden = !body.hidden;
    });
    document.querySelectorAll(".wz-dev-btn[data-event]").forEach((btn) => {
        btn.addEventListener("click", () => {
            fireTestEvent(btn.dataset.event);
        });
    });
    document.querySelectorAll(".wz-dev-btn[data-siren]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const level = btn.dataset.siren;
            const titles = {
                red: "TEL AVIV, HAIFA, CENTRAL ISRAEL",
                orange: "BEIRUT, SOUTHERN LEBANON, SIDON",
                yellow: "NORTHERN ISRAEL, HAMIFRATZ, HAMAKIM",
            };
            const metas = {
                red: "via Alert Feed",
                orange: "via Telegram OSINT",
                yellow: "via Alert Feed",
            };
            showSirenAlert({
                title: titles[level],
                meta: metas[level],
                level,
                sound: true,
            });
            devLog(`🔔 Siren [${level.toUpperCase()}]: ${titles[level]}`);
        });
    });
    const HIGHLIGHT_LOCATIONS = {
        israel: { lat: 31.5, lon: 34.8, severity: "critical", label: "Israel" },
        uae: { lat: 24.2, lon: 54.4, severity: "high", label: "UAE" },
        iran: { lat: 32.4, lon: 53.7, severity: "critical", label: "Iran" },
        ukraine: { lat: 49.0, lon: 32.0, severity: "high", label: "Ukraine" },
    };
    document.querySelectorAll(".wz-dev-btn[data-highlight]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.highlight;
            const globe = window.__warzoneViewer?.__warzone;
            if (key === "clear") {
                globe?.clearAlertHighlight?.();
                devLog("✖ Highlight cleared");
                return;
            }
            const loc = HIGHLIGHT_LOCATIONS[key];
            if (!loc || !globe) return;
            globe.highlightAlertRegion({
                lat: loc.lat,
                lon: loc.lon,
                severity: loc.severity,
            });
            window.__warzoneViewer?.camera.cancelFlight?.();
            window.__warzoneViewer?.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, 900000),
                duration: 1.2,
            });
            devLog(`🔴 Pulse highlight: ${loc.label} [${loc.severity}]`);
        });
    });
    document.querySelectorAll(".wz-dev-btn[data-track-route]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.trackRoute;
            const route = TEST_TRACK_ROUTES[key];
            if (!route) return;
            restartDevSimulation(route, `✈ Route sim started: ${route.title}`);
        });
    });
    document.querySelectorAll(".wz-dev-btn[data-track-stop]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.trackStop || "dev-track-fighter-1";
            stopDevTrackSimulation(key);
            devLog(`✖ Route sim stopped: ${key}`);
        });
    });
    document.getElementById("wz-dev-fire-all")?.addEventListener("click", () => {
        let delay = 0;
        Object.keys(TEST_EVENTS).forEach((key) => {
            setTimeout(() => fireTestEvent(key), delay);
            delay += 800;
        });
        devLog(`⚡ Firing all ${Object.keys(TEST_EVENTS).length} test events...`);
    });
    document.getElementById("wz-dev-clear")?.addEventListener("click", () => {
        const log = document.getElementById("wz-dev-log");
        if (log) log.innerHTML = "";
    });
    initDevSimulatorControls();
    initMapTunerControls();
    devLog("Dev panel ready");
}


/* ================= AIRCRAFT CALIBRATION MODE (INLAND + LIVE TUNER) ================= */

const DEV_AIRCRAFT_CALIBRATION_CODES = [
    "aw-1", "aw-2", "aw-3",
    "bb-1", "bb-2",
    "dd-1",
    "ff-1", "ff-2", "ff-3", "ff-4", "ff-5",
    "hh-1", "hh-2",
    "rr-1",
    "tn-1", "tn-2",
    "tp-1", "tp-2",
];
const DEV_AIRCRAFT_CALIBRATION_LABELS = Object.freeze({
    "aw-1": "AW-1",
    "aw-2": "AW-2",
    "aw-3": "AW-3",
    "bb-1": "BB-1",
    "bb-2": "BB-2",
    "dd-1": "DD-1",
    "ff-1": "FF-1",
    "ff-2": "FF-2",
    "ff-3": "FF-3",
    "ff-4": "FF-4",
    "ff-5": "FF-5",
    "hh-1": "HH-1",
    "hh-2": "HH-2",
    "rr-1": "RR-1",
    "tn-1": "TN-1",
    "tn-2": "TN-2",
    "tp-1": "TP-1",
    "tp-2": "TP-2",
});
const DEV_CALIBRATION_GRID_COLUMNS = 10;
const DEV_CALIBRATION_GRID_BASE_LAT = 23.8;
const DEV_CALIBRATION_GRID_BASE_LON = 43.4;
const DEV_CALIBRATION_GRID_LAT_STEP = 0.32;
const DEV_CALIBRATION_GRID_LON_STEP = 0.55;

function getCalibrationGridSlot(index = 0) {
    const safeIndex = Math.max(0, Number(index) || 0);
    const row = Math.floor(safeIndex / DEV_CALIBRATION_GRID_COLUMNS);
    const col = safeIndex % DEV_CALIBRATION_GRID_COLUMNS;
    return {
        lat: DEV_CALIBRATION_GRID_BASE_LAT + (row * DEV_CALIBRATION_GRID_LAT_STEP),
        lon: DEV_CALIBRATION_GRID_BASE_LON + (col * DEV_CALIBRATION_GRID_LON_STEP),
    };
}
function buildAircraftCalibrationDefaults(code = "ff-1") {
    void code;
    return {
        headingOffset: -90,
        pitch: 0,
        roll: 0,
        scale: 1,
        minimumPixelSize: 90,
        maximumScale: 1200,
        tailOffset: 600,
    };
}
const DEV_AIRCRAFT_CALIBRATION = Object.fromEntries(
    DEV_AIRCRAFT_CALIBRATION_CODES.map((code) => [code, buildAircraftCalibrationDefaults(code)])
);
function getSharedAircraftCalibrationConfig() {
    const primaryCode = DEV_AIRCRAFT_CALIBRATION_CODES[0] || "ff-1";
    if (!DEV_AIRCRAFT_CALIBRATION[primaryCode]) {
        DEV_AIRCRAFT_CALIBRATION[primaryCode] = buildAircraftCalibrationDefaults(primaryCode);
    }
    return DEV_AIRCRAFT_CALIBRATION[primaryCode];
}
function applySharedAircraftCalibrationToAll(patch = {}) {
    Object.values(DEV_AIRCRAFT_CALIBRATION).forEach((cfg) => {
        if (!cfg || typeof cfg !== "object") return;
        Object.assign(cfg, patch);
    });
}
function resetAircraftCalibrationValues() {
    DEV_AIRCRAFT_CALIBRATION_CODES.forEach((code) => {
        DEV_AIRCRAFT_CALIBRATION[code] = buildAircraftCalibrationDefaults(code);
    });
}

let __devCalibrationEntities = [];
const DEV_AIRCRAFT_CALIBRATION_FOCUS_RANGE_METERS = 95000;
const DEV_AIRCRAFT_CALIBRATION_FOCUS_PITCH_DEG = -89;
const DEV_AIRCRAFT_CALIBRATION_FOCUS_HEADING_DEG = 0;

function getCalibrationModelWhiteningConfig() {
    const styles = getComputedStyle(document.documentElement);
    const whiteness = Number.parseFloat(styles.getPropertyValue("--warzone-live-aircraft-model-whiteness"));
    const alpha = Number.parseFloat(styles.getPropertyValue("--warzone-live-aircraft-model-color-alpha"));
    const blendAmount = Number.parseFloat(styles.getPropertyValue("--warzone-live-aircraft-model-color-blend-amount"));
    return {
        alpha: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.96,
        blendAmount: Number.isFinite(whiteness)
            ? Math.max(0, Math.min(1, whiteness))
            : (Number.isFinite(blendAmount) ? Math.max(0, Math.min(1, blendAmount)) : 0.42),
    };
}

function applyCalibrationModelWhitening(model) {
    if (!model) return;
    const tint = getCalibrationModelWhiteningConfig();
    model.color = Cesium.Color.WHITE.withAlpha(tint.alpha);
    model.colorBlendMode = Cesium.ColorBlendMode.MIX;
    model.colorBlendAmount = tint.blendAmount;
}

function getModelUriBySubtype(subtype) {
    const modelBase = "/assets/images/models/air";
    const modelFilePrefix = "model-aircraft-";
    const normalized = String(subtype || "").trim().toLowerCase();
    const map = {
        "aw-1": "aw-1",
        "aw-2": "aw-2",
        "aw-3": "aw-3",
        "bb-1": "bb-1",
        "bb-2": "bb-2",
        "dd-1": "dd-1",
        "ff-1": "ff-1",
        "ff-2": "ff-2",
        "ff-3": "ff-3",
        "ff-4": "ff-4",
        "ff-5": "ff-5",
        "hh-1": "hh-1",
        "hh-2": "hh-2",
        "rr-1": "rr-1",
        "tn-1": "tn-1",
        "tn-2": "tn-2",
        "tp-1": "tp-1",
        "tp-2": "tp-2",
        bomber: "bb-1",
        fighter: "ff-1",
        awacs: "aw-1",
        recon: "aw-2",
        tanker: "tn-2",
        transport: "tp-2",
        drone: "dd-1",
        uav: "dd-1",
        helicopter: "hh-1",
    };
    const code = map[normalized] || "ff-1";
    return `${modelBase}/${modelFilePrefix}${code}.glb`;
}

function createCalibrationLine(viewer, position, headingDeg, lengthMeters = 8000) {
    const headingRad = Cesium.Math.toRadians(Number(headingDeg || 0));
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) return null;

    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const alt = Number(cartographic.height || 0);

    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.cos(Cesium.Math.toRadians(lat));
    const endLon = lon + ((lengthMeters * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));
    const endLat = lat + ((lengthMeters * Math.cos(headingRad)) / metersPerDegLat);

    return viewer.entities.add({
        polyline: {
            positions: [
                Cesium.Cartesian3.fromDegrees(lon, lat, alt),
                Cesium.Cartesian3.fromDegrees(endLon, endLat, alt)
            ],
            width: 3,
            material: Cesium.Color.LIME.withAlpha(0.9),
            clampToGround: false,
        }
    });
}

function createCalibrationAircraft(viewer, subtype, config, index) {
    // All calibration models use inland grid slots (10 per row) for easier visual tuning.
    const slot = getCalibrationGridSlot(index);
    const position = Cesium.Cartesian3.fromDegrees(slot.lon, slot.lat, 12000);

    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(Number(config.headingOffset || 0)),
        Cesium.Math.toRadians(Number(config.pitch || 0)),
        Cesium.Math.toRadians(Number(config.roll || 0))
    );

    const entity = viewer.entities.add({
        id: `wz-calibration-${subtype}`,
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
        model: {
            uri: getModelUriBySubtype(subtype),
            scale: Number(config.scale ?? 1),
            minimumPixelSize: Number(config.minimumPixelSize ?? 90),
            maximumScale: Number(config.maximumScale ?? 1200),
        },
        label: {
            text: subtype.toUpperCase(),
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -40),
        }
    });

    entity.__isCalibrationAircraft = true;
    entity.__subtype = subtype;
    applyCalibrationModelWhitening(entity.model);

    const line = createCalibrationLine(viewer, position, 0);
    if (line) {
        line.__isCalibrationLine = true;
        line.__subtype = subtype;
        line.__pairedCalibrationEntityId = entity.id;
        __devCalibrationEntities.push(line);
    }

    __devCalibrationEntities.push(entity);
    return entity;
}

async function copyTextToClipboard(text = "") {
    const payload = String(text || "");
    if (!payload) return false;
    if (navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(payload);
            return true;
        } catch {
            // Fallback below.
        }
    }
    try {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-99999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
}
function showCopyButtonFeedback(button, ok = true) {
    if (!button) return;
    const defaultLabel = button.dataset.defaultLabel || button.textContent || "Copy Config";
    button.dataset.defaultLabel = defaultLabel;
    button.textContent = ok ? "Copied" : "Copy Failed";
    button.disabled = true;
    window.setTimeout(() => {
        button.textContent = defaultLabel;
        button.disabled = false;
    }, 900);
}
function buildAircraftCalibrationCopySnippet(subtype = "ff-1") {
    void subtype;
    const cfg = getSharedAircraftCalibrationConfig();
    const whiteness = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--warzone-live-aircraft-model-whiteness"));
    const nextWhiteness = Number.isFinite(whiteness) ? Math.max(0, Math.min(1, whiteness)) : 0.28;
    return [
        `/* Aircraft Calibration: ${subtype.toUpperCase()} */`,
        ":root {",
        `  --warzone-live-aircraft-model-whiteness: ${nextWhiteness.toFixed(2)};`,
        `  --warzone-live-aircraft-model-scale: ${Number(cfg.scale ?? 1)};`,
        `  --warzone-live-aircraft-model-scale-zoom-in: ${Number(cfg.scale ?? 1)};`,
        `  --warzone-live-aircraft-model-scale-zoom-out: ${Number(cfg.scale ?? 1)};`,
        `  --warzone-live-aircraft-model-min-pixel-size: ${Number(cfg.minimumPixelSize ?? 90)};`,
        `  --warzone-live-aircraft-model-max-scale: ${Number(cfg.maximumScale ?? 1200)};`,
        `  --warzone-live-aircraft-model-heading-offset-default: ${Number(cfg.headingOffset ?? 0)};`,
        `  --warzone-live-aircraft-model-pitch-offset-default: ${Number(cfg.pitch ?? 0)};`,
        `  --warzone-live-aircraft-model-roll-offset-default: ${Number(cfg.roll ?? 0)};`,
        "}",
    ].join("\n");
}
function buildNavalCalibrationCopySnippet(subtype = "ns-2") {
    const cfg = DEV_NAVAL_CALIBRATION[subtype] || {};
    return [
        `/* Naval Calibration: ${subtype.toUpperCase()} */`,
        ":root {",
        `  --warzone-live-naval-model-scale: ${Number(cfg.scale ?? 120)};`,
        "}",
        "",
        `// Heading Offset (${subtype}): ${Number(cfg.headingOffset ?? 0)}`,
        `// Min Pixel (${subtype}): ${Number(cfg.minimumPixelSize ?? 90)}`,
        `// Max Scale (${subtype}): ${Number(cfg.maximumScale ?? 1200)}`,
    ].join("\n");
}

function clearCalibration(viewer) {
    if (viewer) {
        __devCalibrationEntities.forEach((entity) => viewer.entities.remove(entity));
    }
    __devCalibrationEntities = [];
    const tuner = document.getElementById("wz-aircraft-tuner");
    if (tuner) tuner.style.display = "none";
}

function ensureAircraftTunerUI() {
    let panel = document.getElementById("wz-aircraft-tuner");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "wz-aircraft-tuner";
    panel.style.cssText = [
        "position:fixed",
        "right:20px",
        "top:180px",
        "width:250px",
        "padding:12px",
        "background:rgba(8,10,16,.96)",
        "border:1px solid rgba(255,255,255,.14)",
        "box-shadow:0 10px 30px rgba(0,0,0,.35)",
        "color:#fff",
        "z-index:999999",
        "font:12px/1.4 Arial,sans-serif",
        "border-radius:8px",
        "display:none"
    ].join(";");

    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-weight:700;letter-spacing:.04em;">AIRCRAFT TUNER</div>
            <button id="wz-tuner-close" type="button" aria-label="Close Aircraft Tuner" style="padding:2px 8px;cursor:pointer;line-height:1;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;border-radius:4px;">X</button>
        </div>

        <label style="display:block;margin-bottom:8px;">
            <div style="margin-bottom:4px;">Aircraft</div>
            <select id="wz-tuner-type" style="width:100%;padding:6px;">
                ${DEV_AIRCRAFT_CALIBRATION_CODES.map((code) => `<option value="${code}">${DEV_AIRCRAFT_CALIBRATION_LABELS[code] || code.toUpperCase()}</option>`).join("")}
            </select>
        </label>

        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Heading</span><strong id="wz-tuner-heading-value">0</strong></div>
            <input id="wz-tuner-heading" type="range" min="-180" max="180" step="1" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Pitch</span><strong id="wz-tuner-pitch-value">0</strong></div>
            <input id="wz-tuner-pitch" type="range" min="-90" max="90" step="1" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Roll</span><strong id="wz-tuner-roll-value">0</strong></div>
            <input id="wz-tuner-roll" type="range" min="-90" max="90" step="1" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Scale</span><strong id="wz-tuner-scale-value">0</strong></div>
            <input id="wz-tuner-scale" type="range" min="1" max="3000" step="1" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Min Pixel</span><strong id="wz-tuner-min-value">0</strong></div>
            <input id="wz-tuner-min" type="range" min="1" max="400" step="1" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;"><span>Max Scale</span><strong id="wz-tuner-max-value">0</strong></div>
            <input id="wz-tuner-max" type="range" min="50" max="10000" step="10" style="width:100%;" />
        </label>

        <label style="display:block;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;"><span>Whiteness (All)</span><strong id="wz-tuner-whiteness-value">0</strong></div>
            <input id="wz-tuner-whiteness" type="range" min="0" max="1" step="0.01" style="width:100%;" />
        </label>

        <button id="wz-tuner-zoom-focus" type="button" style="width:100%;padding:8px 10px;cursor:pointer;margin-bottom:8px;">Zoom Focus Level</button>
        <button id="wz-tuner-log" type="button" style="width:100%;padding:8px 10px;cursor:pointer;">Copy Config</button>
    `;

    document.body.appendChild(panel);
    return panel;
}

function getTunerSubtype() {
    return document.getElementById("wz-tuner-type")?.value || "ff-1";
}

function refreshTunerReadouts() {
    const heading = document.getElementById("wz-tuner-heading");
    const pitch = document.getElementById("wz-tuner-pitch");
    const roll = document.getElementById("wz-tuner-roll");
    const scale = document.getElementById("wz-tuner-scale");
    const min = document.getElementById("wz-tuner-min");
    const max = document.getElementById("wz-tuner-max");
    const whiteness = document.getElementById("wz-tuner-whiteness");

    if (heading) document.getElementById("wz-tuner-heading-value").textContent = heading.value;
    if (pitch) document.getElementById("wz-tuner-pitch-value").textContent = pitch.value;
    if (roll) document.getElementById("wz-tuner-roll-value").textContent = roll.value;
    if (scale) document.getElementById("wz-tuner-scale-value").textContent = scale.value;
    if (min) document.getElementById("wz-tuner-min-value").textContent = min.value;
    if (max) document.getElementById("wz-tuner-max-value").textContent = max.value;
    if (whiteness) document.getElementById("wz-tuner-whiteness-value").textContent = Number(whiteness.value).toFixed(2);
}

function loadTunerValues() {
    const subtype = getTunerSubtype();
    const cfg = DEV_AIRCRAFT_CALIBRATION[subtype];
    if (!cfg) return;
    const sharedCfg = getSharedAircraftCalibrationConfig();

    const heading = document.getElementById("wz-tuner-heading");
    const pitch = document.getElementById("wz-tuner-pitch");
    const roll = document.getElementById("wz-tuner-roll");
    const scale = document.getElementById("wz-tuner-scale");
    const min = document.getElementById("wz-tuner-min");
    const max = document.getElementById("wz-tuner-max");
    const whiteness = document.getElementById("wz-tuner-whiteness");
    const cssWhiteness = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--warzone-live-aircraft-model-whiteness"));
    const cssBlendFallback = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--warzone-live-aircraft-model-color-blend-amount"));
    const nextWhiteness = Number.isFinite(cssWhiteness)
        ? Math.max(0, Math.min(1, cssWhiteness))
        : (Number.isFinite(cssBlendFallback) ? Math.max(0, Math.min(1, cssBlendFallback)) : 0.28);

    if (heading) heading.value = Number(sharedCfg.headingOffset ?? cfg.headingOffset ?? 0);
    if (pitch) pitch.value = Number(sharedCfg.pitch ?? cfg.pitch ?? 0);
    if (roll) roll.value = Number(sharedCfg.roll ?? cfg.roll ?? 0);
    if (scale) scale.value = Number(sharedCfg.scale ?? cfg.scale ?? 1);
    if (min) min.value = Number(sharedCfg.minimumPixelSize ?? cfg.minimumPixelSize ?? 90);
    if (max) max.value = Number(sharedCfg.maximumScale ?? cfg.maximumScale ?? 1200);
    if (whiteness) whiteness.value = nextWhiteness.toFixed(2);

    refreshTunerReadouts();
}

function applyAircraftCalibrationConfig() {
    const viewer = window.__warzoneViewer;
    if (!viewer || !Array.isArray(__devCalibrationEntities)) return;
    const sharedCfg = getSharedAircraftCalibrationConfig();

    __devCalibrationEntities.forEach((entity) => {
        if (!entity || !entity.__isCalibrationAircraft) return;

        const subtype = entity.__subtype;
        const config = DEV_AIRCRAFT_CALIBRATION[subtype];
        if (!config) return;

        const position = entity.position?.getValue?.(Cesium.JulianDate.now()) || entity.position;
        if (!position) return;

        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(Number(sharedCfg.headingOffset || 0)),
                Cesium.Math.toRadians(Number(sharedCfg.pitch || 0)),
                Cesium.Math.toRadians(Number(sharedCfg.roll || 0))
            )
        );

        if (entity.model) {
            entity.model.scale = Number(sharedCfg.scale ?? 1);
            entity.model.minimumPixelSize = Number(sharedCfg.minimumPixelSize ?? 90);
            entity.model.maximumScale = Number(sharedCfg.maximumScale ?? 1200);
            applyCalibrationModelWhitening(entity.model);
        }
    });

    refreshTunerReadouts();
    viewer.scene.requestRender();
}

function applyTunerValues() {
    const subtype = getTunerSubtype();
    const cfg = DEV_AIRCRAFT_CALIBRATION[subtype];
    if (!cfg) return;

    const heading = document.getElementById("wz-tuner-heading");
    const pitch = document.getElementById("wz-tuner-pitch");
    const roll = document.getElementById("wz-tuner-roll");
    const scale = document.getElementById("wz-tuner-scale");
    const min = document.getElementById("wz-tuner-min");
    const max = document.getElementById("wz-tuner-max");
    const whiteness = document.getElementById("wz-tuner-whiteness");

    if (heading) applySharedAircraftCalibrationToAll({ headingOffset: Number(heading.value) });
    if (pitch) applySharedAircraftCalibrationToAll({ pitch: Number(pitch.value) });
    if (roll) applySharedAircraftCalibrationToAll({ roll: Number(roll.value) });
    if (scale) applySharedAircraftCalibrationToAll({ scale: Number(scale.value) });
    if (min) applySharedAircraftCalibrationToAll({ minimumPixelSize: Number(min.value) });
    if (max) applySharedAircraftCalibrationToAll({ maximumScale: Number(max.value) });
    const sharedCfg = getSharedAircraftCalibrationConfig();
    const globalWhiteness = whiteness
        ? Math.max(0, Math.min(1, Number(whiteness.value)))
        : 0.28;

    // Live renderer keeps one shared aircraft model scale band as requested.
    const sharedScale = Number(sharedCfg.scale || 1);
    const sharedMinPixel = Number(sharedCfg.minimumPixelSize || 90);
    const sharedMaxScale = Number(sharedCfg.maximumScale || 1200);
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale", String(sharedScale));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale-zoom-in", String(sharedScale));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale-zoom-out", String(sharedScale));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-min-pixel-size", String(sharedMinPixel));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-max-scale", String(sharedMaxScale));
    // Backward-compatible aliases used by older live-track style lookups.
    document.documentElement.style.setProperty("--warzone-live-track-min-pixel-size", String(sharedMinPixel));
    document.documentElement.style.setProperty("--warzone-live-track-max-scale", String(sharedMaxScale));
    // One global control for all live aircraft model tint.
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-whiteness", String(globalWhiteness));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-color-blend-amount", String(globalWhiteness));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-heading-offset-default", String(Number(sharedCfg.headingOffset || 0)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-pitch-offset-default", String(Number(sharedCfg.pitch || 0)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-roll-offset-default", String(Number(sharedCfg.roll || 0)));
    setAircraftModelHeadingOffset("default", Number(sharedCfg.headingOffset || 0));

    applyAircraftCalibrationConfig();
}

function zoomAircraftCalibrationToFocusLevel() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    const subtype = getTunerSubtype();
    const target = __devCalibrationEntities.find(
        (entity) => entity?.__isCalibrationAircraft && entity.__subtype === subtype
    );
    if (!target) return;
    viewer.camera.cancelFlight?.();
    viewer.flyTo(target, {
        duration: 0.9,
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(DEV_AIRCRAFT_CALIBRATION_FOCUS_HEADING_DEG),
            Cesium.Math.toRadians(DEV_AIRCRAFT_CALIBRATION_FOCUS_PITCH_DEG),
            DEV_AIRCRAFT_CALIBRATION_FOCUS_RANGE_METERS
        ),
    });
}

function bindAircraftTunerUI() {
    const panel = ensureAircraftTunerUI();
    if (panel.dataset.bound === "1") return;
    panel.dataset.bound = "1";

    document.getElementById("wz-tuner-type")?.addEventListener("change", loadTunerValues);
    document.getElementById("wz-tuner-heading")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-pitch")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-roll")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-scale")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-min")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-max")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-whiteness")?.addEventListener("input", applyTunerValues);
    document.getElementById("wz-tuner-zoom-focus")?.addEventListener("click", zoomAircraftCalibrationToFocusLevel);
    document.getElementById("wz-tuner-close")?.addEventListener("click", () => {
        clearCalibration(window.__warzoneViewer);
    });

    document.getElementById("wz-tuner-log")?.addEventListener("click", async (event) => {
        const subtype = getTunerSubtype();
        const text = buildAircraftCalibrationCopySnippet(subtype);
        const ok = await copyTextToClipboard(text);
        showCopyButtonFeedback(event.currentTarget, ok);
    });
}

function startAircraftCalibration() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;

    clearCalibration(viewer);
    resetAircraftCalibrationValues();

    let i = 0;
    for (const subtype in DEV_AIRCRAFT_CALIBRATION) {
        createCalibrationAircraft(viewer, subtype, DEV_AIRCRAFT_CALIBRATION[subtype], i++);
    }
    const sharedCfg = getSharedAircraftCalibrationConfig();
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale", String(Number(sharedCfg.scale || 1)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale-zoom-in", String(Number(sharedCfg.scale || 1)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-scale-zoom-out", String(Number(sharedCfg.scale || 1)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-min-pixel-size", String(Number(sharedCfg.minimumPixelSize || 90)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-max-scale", String(Number(sharedCfg.maximumScale || 1200)));
    document.documentElement.style.setProperty("--warzone-live-track-min-pixel-size", String(Number(sharedCfg.minimumPixelSize || 90)));
    document.documentElement.style.setProperty("--warzone-live-track-max-scale", String(Number(sharedCfg.maximumScale || 1200)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-heading-offset-default", String(Number(sharedCfg.headingOffset || 0)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-pitch-offset-default", String(Number(sharedCfg.pitch || 0)));
    document.documentElement.style.setProperty("--warzone-live-aircraft-model-roll-offset-default", String(Number(sharedCfg.roll || 0)));
    setAircraftModelHeadingOffset("default", Number(sharedCfg.headingOffset || 0));

    const tuner = ensureAircraftTunerUI();
    bindAircraftTunerUI();
    tuner.style.display = "block";
    loadTunerValues();

    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(45.9, 24.15, 1200000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-78),
            roll: 0,
        },
        duration: 1.2,
    });

    console.log("=== AIRCRAFT CALIBRATION ACTIVE ===");
    console.log("Aircraft calibration grid loaded on inland terrain (10 columns per row).");
    viewer.scene.requestRender();
}

window.__DEV_AIRCRAFT_CALIBRATION = DEV_AIRCRAFT_CALIBRATION;
window.startAircraftCalibration = startAircraftCalibration;
window.applyAircraftCalibrationConfig = applyAircraftCalibrationConfig;
window.clearAircraftCalibration = () => clearCalibration(window.__warzoneViewer);

document.addEventListener("click", (e) => {
    if (e.target.closest("#wz-dev-aircraft-calibrate")) {
        startAircraftCalibration();
    }
});

/* ================= NAVAL CALIBRATION MODE ================= */
const DEV_NAVAL_CALIBRATION_CODES = [
    "ac-us-1",
    "ac-cn-1",
    "ac-uk-1",
    "ac-rs-1",
    "hc-1",
    "ni-1",
    "ns-1",
    "ns-2",
    "ns-3",
    "sb-1",
];
const DEV_NAVAL_CALIBRATION_LABELS = Object.freeze({
    "ac-us-1": "AC-US-1",
    "ac-cn-1": "AC-CN-1",
    "ac-uk-1": "AC-UK-1",
    "ac-rs-1": "AC-RS-1",
    "hc-1": "HC-1",
    "ni-1": "NI-1",
    "ns-1": "NS-1",
    "ns-2": "NS-2",
    "ns-3": "NS-3",
    "sb-1": "SB-1",
});
const DEV_NAVAL_LIVE_SUBTYPE_BY_CODE = Object.freeze({
    "ac-us-1": "carrier",
    "ac-cn-1": "carrier",
    "ac-uk-1": "carrier",
    "ac-rs-1": "carrier",
    "hc-1": "amphibious",
    "ni-1": "intelligence",
    "ns-1": "patrol",
    "ns-2": "naval",
    "ns-3": "logistics",
    "sb-1": "submarine",
});
const DEV_NAVAL_CALIBRATION = Object.fromEntries(
    DEV_NAVAL_CALIBRATION_CODES.map((code) => {
        const isSubmarine = code === "sb-1";
        return [code, {
            headingOffset: 0,
            scale: isSubmarine ? 118 : 130,
            minimumPixelSize: 90,
            maximumScale: 1200,
        }];
    })
);
const DEV_CALIBRATION_NAVAL_INDEX_OFFSET = DEV_AIRCRAFT_CALIBRATION_CODES.length;

function getNavalLiveSubtypeKey(code = "") {
    return DEV_NAVAL_LIVE_SUBTYPE_BY_CODE[String(code || "").trim().toLowerCase()] || "naval";
}
let __devNavalCalibrationEntities = [];
function getNavalModelUriBySubtype(subtype) {
    const modelBase = "/assets/images/models/naval";
    const normalized = String(subtype || "").trim().toLowerCase();
    const map = {
        "ac-us-1": "ac-us-1",
        "ac-cn-1": "ac-cn-1",
        "ac-uk-1": "ac-uk-1",
        "ac-rs-1": "ac-rs-1",
        "hc-1": "hc-1",
        "ni-1": "ni-1",
        "ns-1": "ns-1",
        "ns-2": "ns-2",
        "ns-3": "ns-3",
        "sb-1": "sb-1",
        carrier: "ac-rs-1",
        amphibious: "hc-1",
        intelligence: "ni-1",
        patrol: "ns-1",
        naval: "ns-2",
        logistics: "ns-3",
        submarine: "sb-1",
        ssn: "sb-1",
        ssbn: "sb-1",
    };
    const code = map[normalized] || "ns-2";
    return `${modelBase}/${code}.glb`;
}
function createCalibrationNaval(viewer, subtype, config, index) {
    // Continue the same 10-column inland grid after aircraft slots.
    const slot = getCalibrationGridSlot(DEV_CALIBRATION_NAVAL_INDEX_OFFSET + index);
    const position = Cesium.Cartesian3.fromDegrees(slot.lon, slot.lat, 0);
    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(Number(config.headingOffset || 0)),
        0,
        0
    );
    const entity = viewer.entities.add({
        id: `wz-calibration-naval-${subtype}`,
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
        model: {
            uri: getNavalModelUriBySubtype(subtype),
            scale: Number(config.scale ?? 120),
            minimumPixelSize: Number(config.minimumPixelSize ?? 90),
            maximumScale: Number(config.maximumScale ?? 1200),
        },
        label: {
            text: subtype.toUpperCase(),
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -35),
        }
    });
    entity.__isCalibrationNaval = true;
    entity.__subtype = subtype;
    applyCalibrationModelWhitening(entity.model);

    const line = createCalibrationLine(viewer, position, 0, 12000);
    if (line) {
        line.__isCalibrationLine = true;
        line.__subtype = subtype;
        line.__pairedCalibrationEntityId = entity.id;
        __devNavalCalibrationEntities.push(line);
    }
    __devNavalCalibrationEntities.push(entity);
    return entity;
}
function clearNavalCalibration(viewer) {
    if (viewer) {
        __devNavalCalibrationEntities.forEach((entity) => viewer.entities.remove(entity));
    }
    __devNavalCalibrationEntities = [];
    const tuner = document.getElementById("wz-naval-tuner");
    if (tuner) tuner.style.display = "none";
}
function ensureNavalTunerUI() {
    let panel = document.getElementById("wz-naval-tuner");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "wz-naval-tuner";
    panel.style.cssText = [
        "position:fixed",
        "right:284px",
        "top:180px",
        "width:250px",
        "padding:12px",
        "background:rgba(8,10,16,.96)",
        "border:1px solid rgba(255,255,255,.14)",
        "box-shadow:0 10px 30px rgba(0,0,0,.35)",
        "color:#fff",
        "z-index:999998",
        "font:12px/1.4 Arial,sans-serif",
        "border-radius:8px",
        "display:none"
    ].join(";");
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-weight:700;letter-spacing:.04em;">NAVAL TUNER</div>
            <button id="wz-naval-tuner-close" type="button" aria-label="Close Naval Tuner" style="padding:2px 8px;cursor:pointer;line-height:1;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;border-radius:4px;">X</button>
        </div>
        <label style="display:block;margin-bottom:8px;">
            <div style="margin-bottom:4px;">Asset</div>
            <select id="wz-naval-tuner-type" style="width:100%;padding:6px;">
                ${DEV_NAVAL_CALIBRATION_CODES.map((code) => `<option value="${code}">${DEV_NAVAL_CALIBRATION_LABELS[code] || code.toUpperCase()}</option>`).join("")}
            </select>
        </label>
        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Heading</span><strong id="wz-naval-tuner-heading-value">0</strong></div>
            <input id="wz-naval-tuner-heading" type="range" min="-180" max="180" step="1" style="width:100%;" />
        </label>
        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Scale</span><strong id="wz-naval-tuner-scale-value">0</strong></div>
            <input id="wz-naval-tuner-scale" type="range" min="1" max="3000" step="1" style="width:100%;" />
        </label>
        <label style="display:block;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;"><span>Min Pixel</span><strong id="wz-naval-tuner-min-value">0</strong></div>
            <input id="wz-naval-tuner-min" type="range" min="1" max="400" step="1" style="width:100%;" />
        </label>
        <label style="display:block;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;"><span>Max Scale</span><strong id="wz-naval-tuner-max-value">0</strong></div>
            <input id="wz-naval-tuner-max" type="range" min="50" max="10000" step="10" style="width:100%;" />
        </label>
        <button id="wz-naval-tuner-log" type="button" style="width:100%;padding:8px 10px;cursor:pointer;">Copy Config</button>
    `;
    document.body.appendChild(panel);
    return panel;
}
function getNavalTunerSubtype() {
    return document.getElementById("wz-naval-tuner-type")?.value || "ns-2";
}
function refreshNavalTunerReadouts() {
    const heading = document.getElementById("wz-naval-tuner-heading");
    const scale = document.getElementById("wz-naval-tuner-scale");
    const min = document.getElementById("wz-naval-tuner-min");
    const max = document.getElementById("wz-naval-tuner-max");
    if (heading) document.getElementById("wz-naval-tuner-heading-value").textContent = heading.value;
    if (scale) document.getElementById("wz-naval-tuner-scale-value").textContent = scale.value;
    if (min) document.getElementById("wz-naval-tuner-min-value").textContent = min.value;
    if (max) document.getElementById("wz-naval-tuner-max-value").textContent = max.value;
}
function loadNavalTunerValues() {
    const subtype = getNavalTunerSubtype();
    const cfg = DEV_NAVAL_CALIBRATION[subtype];
    if (!cfg) return;
    const heading = document.getElementById("wz-naval-tuner-heading");
    const scale = document.getElementById("wz-naval-tuner-scale");
    const min = document.getElementById("wz-naval-tuner-min");
    const max = document.getElementById("wz-naval-tuner-max");
    if (heading) heading.value = Number(cfg.headingOffset ?? 0);
    if (scale) scale.value = Number(cfg.scale ?? 120);
    if (min) min.value = Number(cfg.minimumPixelSize ?? 90);
    if (max) max.value = Number(cfg.maximumScale ?? 1200);
    refreshNavalTunerReadouts();
}
function applyNavalCalibrationConfig() {
    const viewer = window.__warzoneViewer;
    if (!viewer || !Array.isArray(__devNavalCalibrationEntities)) return;
    __devNavalCalibrationEntities.forEach((entity) => {
        if (!entity || !entity.__isCalibrationNaval) return;
        const subtype = entity.__subtype;
        const config = DEV_NAVAL_CALIBRATION[subtype];
        if (!config) return;
        const position = entity.position?.getValue?.(Cesium.JulianDate.now()) || entity.position;
        if (!position) return;
        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(Number(config.headingOffset || 0)), 0, 0)
        );
        if (entity.model) {
            entity.model.scale = Number(config.scale ?? 120);
            entity.model.minimumPixelSize = Number(config.minimumPixelSize ?? 90);
            entity.model.maximumScale = Number(config.maximumScale ?? 1200);
            applyCalibrationModelWhitening(entity.model);
        }
    });
    refreshNavalTunerReadouts();
    viewer.scene.requestRender();
}
function applyNavalTunerValues() {
    const subtype = getNavalTunerSubtype();
    const cfg = DEV_NAVAL_CALIBRATION[subtype];
    if (!cfg) return;
    const heading = document.getElementById("wz-naval-tuner-heading");
    const scale = document.getElementById("wz-naval-tuner-scale");
    const min = document.getElementById("wz-naval-tuner-min");
    const max = document.getElementById("wz-naval-tuner-max");
    if (heading) cfg.headingOffset = Number(heading.value);
    if (scale) cfg.scale = Number(scale.value);
    if (min) cfg.minimumPixelSize = Number(min.value);
    if (max) cfg.maximumScale = Number(max.value);

    const liveSubtype = getNavalLiveSubtypeKey(subtype);
    document.documentElement.style.setProperty("--warzone-live-naval-model-scale", String(Number(cfg.scale || 120)));
    setNavalModelHeadingOffset(subtype, Number(cfg.headingOffset || 0));
    setNavalModelHeadingOffset(liveSubtype, Number(cfg.headingOffset || 0));
    applyNavalCalibrationConfig();
}
function bindNavalTunerUI() {
    const panel = ensureNavalTunerUI();
    if (panel.dataset.bound === "1") return;
    panel.dataset.bound = "1";

    document.getElementById("wz-naval-tuner-type")?.addEventListener("change", loadNavalTunerValues);
    document.getElementById("wz-naval-tuner-heading")?.addEventListener("input", applyNavalTunerValues);
    document.getElementById("wz-naval-tuner-scale")?.addEventListener("input", applyNavalTunerValues);
    document.getElementById("wz-naval-tuner-min")?.addEventListener("input", applyNavalTunerValues);
    document.getElementById("wz-naval-tuner-max")?.addEventListener("input", applyNavalTunerValues);
    document.getElementById("wz-naval-tuner-close")?.addEventListener("click", () => {
        clearNavalCalibration(window.__warzoneViewer);
    });
    document.getElementById("wz-naval-tuner-log")?.addEventListener("click", async (event) => {
        const subtype = getNavalTunerSubtype();
        const text = buildNavalCalibrationCopySnippet(subtype);
        const ok = await copyTextToClipboard(text);
        showCopyButtonFeedback(event.currentTarget, ok);
    });
}
function startNavalCalibration() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    clearNavalCalibration(viewer);

    let i = 0;
    Object.keys(DEV_NAVAL_CALIBRATION).forEach((subtype) => {
        createCalibrationNaval(viewer, subtype, DEV_NAVAL_CALIBRATION[subtype], i++);
        const headingOffset = Number(DEV_NAVAL_CALIBRATION[subtype]?.headingOffset || 0);
        const liveSubtype = getNavalLiveSubtypeKey(subtype);
        setNavalModelHeadingOffset(subtype, headingOffset);
        setNavalModelHeadingOffset(liveSubtype, headingOffset);
    });

    const tuner = ensureNavalTunerUI();
    bindNavalTunerUI();
    tuner.style.display = "block";
    loadNavalTunerValues();

    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(45.9, 24.15, 1500000),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-78),
            roll: 0,
        },
        duration: 1.2,
    });
    console.log("=== NAVAL CALIBRATION ACTIVE ===");
    console.log("Naval calibration grid loaded on inland terrain (continues aircraft 10-column grid).");
    viewer.scene.requestRender();
}

window.__DEV_NAVAL_CALIBRATION = DEV_NAVAL_CALIBRATION;
window.startNavalCalibration = startNavalCalibration;
window.applyNavalCalibrationConfig = applyNavalCalibrationConfig;
window.clearNavalCalibration = () => clearNavalCalibration(window.__warzoneViewer);

document.addEventListener("click", (e) => {
    if (e.target.closest("#wz-dev-naval-calibrate")) {
        startNavalCalibration();
    }
});
