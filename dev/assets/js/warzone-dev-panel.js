// assets/js/warzone-dev-panel.js
//
// DEV TEST PANEL — development only
// Production mein automatically disable ho jaata hai
//
// IMPORTANT:
// - Ye file sirf synthetic test harness hai
// - Real production aircraft movement live telemetry / ADS-B style updates se aayega
// - Is file mein "debug route preview" alag layer hai
// - Live trail aur debug route preview ko confuse mat karo

import * as Cesium from "cesium";
import {
    handleIncomingEvent,
    triggerWarzoneAlert
} from "./essential.js";
import {
    startDevTrackSimulation,
    stopDevTrackSimulation
} from "./warzone-live-fighter.js";
import { showSirenAlert } from "./warzone-siren-alert.js";

/* ================= DEV PREVIEW STATE ================= */

const __devRoutePreviewEntities = new Map();

/* ================= TEST EVENTS ================= */

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
        metadata: { callsign: "IAF101", heading: 45, altitude_ft: 30000, speed_kts: 480, country: "Israel" },
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
        metadata: { callsign: "NAEW01", heading: 270, altitude_ft: 29000, speed_kts: 380, country: "NATO" },
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

function normalizeDevHeading(deg = 0) {
    return ((deg % 360) + 360) % 360;
}

function offsetPointByHeading(lat, lon, headingDeg, distanceKm) {
    const headingRad = Cesium.Math.toRadians(normalizeDevHeading(headingDeg));
    const meters = distanceKm * 1000;

    const latOffset = (meters * Math.cos(headingRad)) / 110540;
    const lonOffset =
        (meters * Math.sin(headingRad)) /
        Math.max(111320 * Math.cos(Cesium.Math.toRadians(lat)), 1);

    return {
        lat: lat + latOffset,
        lon: lon + lonOffset,
    };
}

function buildGeneratedTurnWaypoints(baseLat, baseLon, altitudeFt, headingDeg) {
    const segments = [
        { heading: headingDeg + 12, distanceKm: 22 },
        { heading: headingDeg + 28, distanceKm: 28 },
        { heading: headingDeg + 52, distanceKm: 34 },
        { heading: headingDeg + 86, distanceKm: 32 },
        { heading: headingDeg + 132, distanceKm: 27 },
        { heading: headingDeg + 182, distanceKm: 21 },
        { heading: headingDeg + 228, distanceKm: 18 },
        { heading: headingDeg + 286, distanceKm: 20 },
    ];

    const points = [{
        lat: baseLat,
        lon: baseLon,
        altitude_ft: altitudeFt,
        heading_deg: normalizeDevHeading(headingDeg),
    }];

    let currentLat = baseLat;
    let currentLon = baseLon;

    segments.forEach((segment) => {
        const next = offsetPointByHeading(
            currentLat,
            currentLon,
            segment.heading,
            segment.distanceKm
        );

        currentLat = next.lat;
        currentLon = next.lon;

        points.push({
            lat: currentLat,
            lon: currentLon,
            altitude_ft: altitudeFt,
            heading_deg: normalizeDevHeading(segment.heading),
        });
    });

    return points;
}

function catmullRomScalar(p0, p1, p2, p3, t) {
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
    );
}

function sampleSmoothWaypoint(waypoints, t) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return null;

    const n = waypoints.length;
    const clampedT = Math.max(0, Math.min(1, t));
    const scaled = clampedT * (n - 1);
    const i = Math.floor(scaled);

    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[Math.min(n - 1, i)];
    const p2 = waypoints[Math.min(n - 1, i + 1)];
    const p3 = waypoints[Math.min(n - 1, i + 2)];
    const localT = scaled - i;

    return {
        lat: catmullRomScalar(p0.lat, p1.lat, p2.lat, p3.lat, localT),
        lon: catmullRomScalar(p0.lon, p1.lon, p2.lon, p3.lon, localT),
        altitude_ft:
            (p1.altitude_ft || 0) +
            (((p2.altitude_ft || 0) - (p1.altitude_ft || 0)) * localT),
    };
}

function buildOrbitPreviewPositions(config, samples = 220) {
    if (!config?.center) return [];

    const positions = [];
    const directionSign = config.mode === "orbit-left" ? -1 : 1;
    const centerLat = Number(config.center.lat);
    const centerLon = Number(config.center.lon);
    const radiusMeters = Number(config.radiusMeters || 30000);
    const altitudeMeters = Number(config.altitude_ft || 32000) * 0.3048;
    const startAngleDeg = Number(config.startAngleDeg || 0);

    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const angleDeg = normalizeDevHeading(startAngleDeg + (directionSign * 360 * t));
        const angleRad = Cesium.Math.toRadians(angleDeg);

        const latOffsetDeg = (radiusMeters * Math.sin(angleRad)) / 110540;
        const lonOffsetDeg =
            (radiusMeters * Math.cos(angleRad)) /
            Math.max(111320 * Math.cos(Cesium.Math.toRadians(centerLat)), 1);

        positions.push(
            Cesium.Cartesian3.fromDegrees(
                centerLon + lonOffsetDeg,
                centerLat + latOffsetDeg,
                altitudeMeters
            )
        );
    }

    return positions;
}

function buildRoutePreviewPositions(config, samples = 180) {
    if (Array.isArray(config?.waypoints) && config.waypoints.length >= 2) {
        const positions = [];
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const point = sampleSmoothWaypoint(config.waypoints, t);
            if (!point) continue;

            positions.push(
                Cesium.Cartesian3.fromDegrees(
                    Number(point.lon),
                    Number(point.lat),
                    Number(point.altitude_ft || 0) * 0.3048
                )
            );
        }
        return positions;
    }

    if (config?.from && config?.to) {
        return [
            Cesium.Cartesian3.fromDegrees(
                Number(config.from.lon),
                Number(config.from.lat),
                Number(config.from.altitude_ft || 0) * 0.3048
            ),
            Cesium.Cartesian3.fromDegrees(
                Number(config.to.lon),
                Number(config.to.lat),
                Number(config.to.altitude_ft || 0) * 0.3048
            ),
        ];
    }

    if (config?.center) {
        return buildOrbitPreviewPositions(config, samples);
    }

    return [];
}

function clearDevTrackPreview(trackKey) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return;

    const entity = __devRoutePreviewEntities.get(trackKey);
    if (entity) {
        viewer.entities.remove(entity);
        __devRoutePreviewEntities.delete(trackKey);
    }
}

function renderDevTrackPreview(config) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !config?.track_key) return;

    clearDevTrackPreview(config.track_key);

    const positions =
        config.mode === "orbit-left" || config.mode === "orbit-right"
            ? buildOrbitPreviewPositions(config)
            : buildRoutePreviewPositions(config);

    if (!positions.length) return;

    const entity = viewer.entities.add({
        id: `dev-route-preview-${config.track_key}`,
        polyline: {
            positions,
            width: 1.8,
            material: Cesium.Color.LIME.withAlpha(0.85),
            clampToGround: false,
        }
    });

    __devRoutePreviewEntities.set(config.track_key, entity);
}

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
        waypoints: buildGeneratedTurnWaypoints(31.2, 34.4, 32000, 58),
        steps: 180,
        intervalMs: 150,
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

function updateDevSimTrackKey(subtype) {
    const els = getDevSimElements();
    if (!els.trackKey) return;
    const current = String(els.trackKey.value || "").trim();
    if (!current || current.startsWith("dev-sim-")) {
        els.trackKey.value = `dev-sim-${subtype}`;
    }
}

function applyDevSimPreset(subtype = "fighter") {
    const preset = DEV_SIM_PRESETS[subtype] || DEV_SIM_PRESETS.fighter;
    const els = getDevSimElements();
    if (!els.subtype) return;

    els.subtype.value = subtype;
    els.motion.value = preset.motion;
    els.trackKey.value = preset.track_key;
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

function buildDevSimConfigFromForm() {
    const els = getDevSimElements();
    if (!els.subtype) return null;

    const subtype = String(els.subtype.value || "fighter").toLowerCase();
    const motion = String(els.motion.value || "route").toLowerCase();
    const trackKey = String(els.trackKey.value || `dev-sim-${subtype}`).trim();
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
            steps: Math.max(steps, 180),
            intervalMs: Math.max(intervalMs, 150),
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

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 900000),
        duration: 1.2,
    });
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
        const previousTrackKey = String(els.trackKey?.value || "").trim();
        if (previousTrackKey) {
            stopDevTrackSimulation(previousTrackKey);
            clearDevTrackPreview(previousTrackKey);
        }

        applyDevSimPreset(subtype);
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

        renderDevTrackPreview(config);
        startDevTrackSimulation(config);
        focusDevSimFromForm();
        devLog(`✈ Simulator started: ${config.title} [${config.subcategory}]`);
    });

    els.stopBtn?.addEventListener("click", () => {
        const trackKey = String(els.trackKey?.value || "").trim();
        if (!trackKey) {
            devLog("⚠ No track key to stop");
            return;
        }

        stopDevTrackSimulation(trackKey);
        clearDevTrackPreview(trackKey);
        devLog(`✖ Simulator stopped: ${trackKey}`);
    });

    applyDevSimPreset("fighter");
}

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
        const trackKey = `dev-track-${event.id}-${Date.now()}`;
        const baseLat = Number(event.lat);
        const baseLon = Number(event.lon);
        const headingDeg = Number(event.metadata?.heading || 0);
        const altitudeFt = Number(event.metadata?.altitude_ft || 32000);
        const subtype = String(event.subcategory || "fighter").toLowerCase();

        if (!Number.isFinite(baseLat) || !Number.isFinite(baseLon)) return;

        const viewer = window.__warzoneViewer;
        let config = null;

        if (subtype === "awacs") {
            config = {
                track_key: trackKey,
                title: event.title,
                source_name: "DEV PANEL",
                category: "military",
                subcategory: subtype,
                country: event.metadata?.country || "Unknown",
                region: "global",
                mode: "orbit-right",
                center: {
                    lat: baseLat,
                    lon: baseLon,
                },
                radiusMeters: 38000,
                altitude_ft: altitudeFt,
                startAngleDeg: headingDeg,
                steps: 140,
                intervalMs: 170,
                loop: true,
            };
        } else if (subtype === "recon") {
            config = {
                track_key: trackKey,
                title: event.title,
                source_name: "DEV PANEL",
                category: "military",
                subcategory: subtype,
                country: event.metadata?.country || "Unknown",
                region: "global",
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
        } else if (subtype === "tanker") {
            config = {
                track_key: trackKey,
                title: event.title,
                source_name: "DEV PANEL",
                category: "military",
                subcategory: subtype,
                country: event.metadata?.country || "Unknown",
                region: "global",
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
        } else if (subtype === "drone" || subtype === "uav") {
            config = {
                track_key: trackKey,
                title: event.title,
                source_name: "DEV PANEL",
                category: "military",
                subcategory: subtype,
                country: event.metadata?.country || "Unknown",
                region: "global",
                mode: "orbit-left",
                center: {
                    lat: baseLat,
                    lon: baseLon,
                },
                radiusMeters: 18000,
                altitude_ft: altitudeFt,
                startAngleDeg: headingDeg,
                steps: 150,
                intervalMs: 190,
                loop: true,
            };
        } else {
            config = {
                track_key: trackKey,
                title: event.title,
                source_name: "DEV PANEL",
                category: "military",
                subcategory: subtype,
                country: event.metadata?.country || "Unknown",
                region: "global",
                from: {
                    lat: baseLat,
                    lon: baseLon,
                    altitude_ft: altitudeFt,
                    heading_deg: headingDeg,
                },
                to: {
                    lat: baseLat + (Math.random() * 0.6 - 0.3),
                    lon: baseLon + (Math.random() * 0.6 - 0.3),
                    altitude_ft: altitudeFt,
                    heading_deg: headingDeg + 45,
                },
                steps: 120,
                intervalMs: 140,
                loop: true,
            };
        }

        renderDevTrackPreview(config);
        startDevTrackSimulation(config);

        if (viewer) {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(baseLon, baseLat, 900000),
                duration: 1.2,
            });
        }

        devLog(`✈ LIVE AIRCRAFT: ${event.title} [${subtype}]`);
        return;
    }

    devLog(`📍 Event: ${event.title}`);
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

    document.getElementById("wz-dev-toggle").addEventListener("click", () => {
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

            renderDevTrackPreview(route);
            startDevTrackSimulation(route);

            const viewer = window.__warzoneViewer;
            if (viewer) {
                const focusPoint = route.center || route.from || route.waypoints?.[0];

                if (focusPoint?.lon != null && focusPoint?.lat != null) {
                    viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(
                            Number(focusPoint.lon),
                            Number(focusPoint.lat),
                            900000
                        ),
                        duration: 1.2,
                    });
                }
            }

            devLog(`✈ Route sim started: ${route.title}`);
        });
    });

    document.querySelectorAll(".wz-dev-btn[data-track-stop]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.trackStop || "dev-track-fighter-1";
            stopDevTrackSimulation(key);
            clearDevTrackPreview(key);
            devLog(`✖ Route sim stopped: ${key}`);
        });
    });

    document.getElementById("wz-dev-fire-all").addEventListener("click", () => {
        let delay = 0;

        Object.keys(TEST_EVENTS).forEach((key) => {
            setTimeout(() => fireTestEvent(key), delay);
            delay += 800;
        });

        devLog(`⚡ Firing all ${Object.keys(TEST_EVENTS).length} test events...`);
    });

    document.getElementById("wz-dev-clear").addEventListener("click", () => {
        const log = document.getElementById("wz-dev-log");
        if (log) log.innerHTML = "";
    });

    initDevSimulatorControls();

    devLog("Dev panel ready");
    console.log("[dev] Warzone dev panel active — localhost only");
}
