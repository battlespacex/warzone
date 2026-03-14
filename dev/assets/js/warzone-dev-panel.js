// assets/js/warzone-dev-panel.js
//
// DEV TEST PANEL — sirf development mein use karo
// Production mein automatically disable ho jaata hai
// (window.location.hostname === "localhost" ya "127.0.0.1" check karta hai)
//
// Kaise use karein:
//   1. Page load ho
//   2. Bottom-right corner mein "DEV" button dikhega
//   3. Click karo — panel khulega
//   4. Har button ek alag event type fire karta hai globe pe
//
// Koi server ya database nahi chahiye — seedha globe functions call karta hai

import * as Cesium from "cesium";
import { triggerWarzoneAlert } from "./essential.js";
import { showSirenAlert } from "./warzone-siren-alert.js";

// ─── Test event templates ──────────────────────────────────────────────────────

const TEST_EVENTS = {

    // ── Missile arc (Iran → Israel) ────────────────────────────────────────
    missile_iran_israel: {
        id: "test-missile-1",
        title: "Ballistic Missile Launch Detected",
        summary: "MRBM launch detected from western Iran. Trajectory consistent with Israeli territory.",
        category: "strike",
        subcategory: "missile",
        weapon_type: "ballistic_missile",
        severity: "critical",
        lat: 32.08, lon: 34.78,       // Tel Aviv (impact)
        impact_lat: 32.08, impact_lon: 34.78,
        origin_lat: 32.42, origin_lon: 53.69,  // Iran
        origin_label: "Isfahan, Iran",
        impact_label: "Tel Aviv, Israel",
        location_label: "Israel",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Missile arc (Russia → Ukraine) ─────────────────────────────────────
    missile_russia_ukraine: {
        id: "test-missile-2",
        title: "Cruise Missile Strike — Kyiv Oblast",
        summary: "Multiple cruise missiles detected inbound. Air defense activated.",
        category: "strike",
        subcategory: "cruise_missile",
        weapon_type: "cruise_missile",
        severity: "critical",
        lat: 50.45, lon: 30.52,
        impact_lat: 50.45, impact_lon: 30.52,
        origin_lat: 55.75, origin_lon: 37.61,
        origin_label: "Moscow region",
        impact_label: "Kyiv, Ukraine",
        location_label: "Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Drone (kamikaze) ────────────────────────────────────────────────────
    drone_kamikaze: {
        id: "test-drone-1",
        title: "Shahed-136 Drone Strike",
        summary: "Multiple loitering munitions detected. Moving in formation toward target.",
        category: "strike",
        subcategory: "drone",
        weapon_type: "drone",
        severity: "high",
        lat: 49.84, lon: 24.02,
        impact_lat: 49.84, impact_lon: 24.02,
        origin_lat: 47.51, origin_lon: 34.25,
        origin_label: "Zaporizhzhia region",
        impact_label: "Lviv, Ukraine",
        location_label: "Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Air strike ──────────────────────────────────────────────────────────
    airstrike: {
        id: "test-airstrike-1",
        title: "IAF Air Strike — Southern Lebanon",
        summary: "Israeli Air Force conducted precision strikes on infrastructure targets.",
        category: "strike",
        subcategory: "airstrike",
        weapon_type: "air_strike",
        severity: "high",
        lat: 33.27, lon: 35.20,
        impact_lat: 33.27, impact_lon: 35.20,
        origin_lat: 32.08, origin_lon: 34.78,
        origin_label: "Israel",
        impact_label: "Southern Lebanon",
        location_label: "Lebanon",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Siren / Air raid warning ────────────────────────────────────────────
    siren_israel: {
        id: "test-siren-1",
        title: "Red Alert — Air Raid Sirens Active",
        summary: "Sirens activated across Tel Aviv metropolitan area. Incoming threat detected.",
        category: "alert",
        subcategory: "siren",
        weapon_type: "unknown",
        severity: "critical",
        lat: 32.08, lon: 34.78,
        impact_lat: 32.08, impact_lon: 34.78,
        location_label: "Tel Aviv, Israel",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Siren Ukraine ───────────────────────────────────────────────────────
    siren_ukraine: {
        id: "test-siren-2",
        title: "Air Raid Warning — Kyiv",
        summary: "Air raid sirens activated. Take shelter immediately.",
        category: "alert",
        subcategory: "siren",
        severity: "critical",
        lat: 50.45, lon: 30.52,
        impact_lat: 50.45, impact_lon: 30.52,
        location_label: "Kyiv, Ukraine",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Military aircraft — Fighter ─────────────────────────────────────────
    aircraft_fighter: {
        id: "test-aircraft-fighter-1",
        title: "FIGHTER F-35I — IAF",
        summary: "Israeli Air Force F-35I Adir detected. Combat patrol.",
        category: "military",
        subcategory: "fighter",
        severity: "medium",
        lat: 31.50, lon: 34.90,
        lon: 34.90,
        location_label: "Israel",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "IAF101", heading: 45, altitude_ft: 35000, speed_kts: 480, country: "Israel" },
        source_key: "adsb-test-fighter-1",
    },

    // ── Military aircraft — AWACS ───────────────────────────────────────────
    aircraft_awacs: {
        id: "test-aircraft-awacs-1",
        title: "AWACS E-3 Sentry — NATO",
        summary: "NATO Airborne Warning and Control System on patrol over Eastern Europe.",
        category: "military",
        subcategory: "awacs",
        severity: "medium",
        lat: 50.06, lon: 19.94,
        location_label: "Poland",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "NAEW01", heading: 270, altitude_ft: 29000, speed_kts: 380, country: "NATO" },
        source_key: "adsb-test-awacs-1",
    },

    // ── Military aircraft — Recon ───────────────────────────────────────────
    aircraft_recon: {
        id: "test-aircraft-recon-1",
        title: "RECON RC-135 Rivet Joint — USAF",
        summary: "USAF signals intelligence aircraft conducting ISR mission.",
        category: "military",
        subcategory: "recon",
        severity: "medium",
        lat: 37.06, lon: 36.16,
        location_label: "Turkey / Syria border",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "JAKE21", heading: 180, altitude_ft: 40000, speed_kts: 420, country: "USA" },
        source_key: "adsb-test-recon-1",
    },

    // ── Military aircraft — Tanker ──────────────────────────────────────────
    aircraft_tanker: {
        id: "test-aircraft-tanker-1",
        title: "TANKER KC-135 — USAF AMC",
        summary: "Air Mobility Command tanker on refueling mission.",
        category: "military",
        subcategory: "tanker",
        severity: "low",
        lat: 48.20, lon: 16.37,
        location_label: "Austria / Germany region",
        source_name: "ADS-B / OpenSky Network",
        occurred_at: new Date().toISOString(),
        metadata: { callsign: "RCH456", heading: 90, altitude_ft: 31000, speed_kts: 440, country: "USA" },
        source_key: "adsb-test-tanker-1",
    },

    // ── Naval — Carrier ─────────────────────────────────────────────────────
    ship_carrier: {
        id: "test-ship-carrier-1",
        title: "CARRIER USS Gerald R. Ford — USN",
        summary: "US Navy carrier strike group operating in Eastern Mediterranean.",
        category: "military",
        subcategory: "carrier",
        severity: "high",
        lat: 35.20, lon: 28.50,
        location_label: "Eastern Mediterranean",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "USS GERALD R FORD", mmsi: "338123456", heading: 135, speed_kts: 18, country: "USA" },
        source_key: "ais-test-carrier-1",
    },

    // ── Naval — Destroyer ───────────────────────────────────────────────────
    ship_destroyer: {
        id: "test-ship-destroyer-1",
        title: "DESTROYER USS Arleigh Burke — USN",
        summary: "Guided missile destroyer on patrol. Part of carrier strike group.",
        category: "military",
        subcategory: "destroyer",
        severity: "medium",
        lat: 35.50, lon: 29.20,
        location_label: "Eastern Mediterranean",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "USS ARLEIGH BURKE", mmsi: "338789012", heading: 200, speed_kts: 22, country: "USA" },
        source_key: "ais-test-destroyer-1",
    },

    // ── Naval — Russian frigate ─────────────────────────────────────────────
    ship_russian: {
        id: "test-ship-russian-1",
        title: "FRIGATE Admiral Gorshkov — Russian Navy",
        summary: "Russian Navy frigate operating in Black Sea.",
        category: "military",
        subcategory: "frigate",
        severity: "high",
        lat: 44.60, lon: 33.52,
        location_label: "Black Sea",
        source_name: "AIS / AISStream.io",
        occurred_at: new Date().toISOString(),
        metadata: { vessel_name: "ADMIRAL GORSHKOV", mmsi: "273456789", heading: 90, speed_kts: 15, country: "Russia" },
        source_key: "ais-test-russian-1",
    },

    // ── Cyber alert ─────────────────────────────────────────────────────────
    cyber: {
        id: "test-cyber-1",
        title: "Critical Infrastructure Attack — Iran",
        summary: "State-sponsored cyber operation targeting power grid SCADA systems.",
        category: "cyber",
        subcategory: "cyber",
        severity: "high",
        lat: 35.69, lon: 51.38,
        location_label: "Tehran, Iran",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },

    // ── Thermal / FIRMS ─────────────────────────────────────────────────────
    thermal: {
        id: "test-thermal-1",
        title: "Thermal Anomaly — Possible Strike Signature",
        summary: "NASA FIRMS satellite detected high-intensity thermal event. Consistent with explosion or fire.",
        category: "thermal",
        subcategory: "thermal",
        severity: "medium",
        lat: 33.51, lon: 36.29,
        location_label: "Damascus, Syria",
        occurred_at: new Date().toISOString(),
        source_name: "DEV TEST",
    },
};

// ─── Log helper ───────────────────────────────────────────────────────────────

function devLog(msg) {
    const log = document.getElementById("wz-dev-log");
    if (!log) return;
    const line = document.createElement("div");
    line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    log.prepend(line);
    // Keep max 20 lines
    while (log.children.length > 20) log.removeChild(log.lastChild);
}

// ─── Fire a test event ────────────────────────────────────────────────────────

function fireTestEvent(key) {
    const template = TEST_EVENTS[key];
    if (!template) return;

    // Fresh copy with new ID and timestamp
    const event = {
        ...template,
        id: `${template.id}-${Date.now()}`,
        occurred_at: new Date().toISOString(),
    };

    const globe = window.__warzoneViewer?.__warzone;
    const tracks = window.__militaryTracks;

    // Add to globe circles
    globe?.addEvent?.(event);

    // Missile / drone arc
    // Missile / drone / airstrike arc + linked siren popup
    if (
        event.origin_lat != null && event.origin_lat !== "" &&
        event.origin_lon != null && event.origin_lon !== "" &&
        (String(event.weapon_type).includes("missile") ||
            String(event.weapon_type).includes("drone") ||
            String(event.subcategory).includes("drone") ||
            String(event.subcategory).includes("missile") ||
            String(event.weapon_type).includes("air_strike"))
    ) {
        globe?.animateMissileTrack?.(event);

        const impactLabel = String(event.impact_label || event.location_label || "IMPACT ZONE").toUpperCase();

        let sirenLevel = "orange";
        if (event.severity === "critical") sirenLevel = "red";
        else if (event.severity === "high") sirenLevel = "orange";
        else sirenLevel = "yellow";

        let sirenMeta = "via DEV TEST · INCOMING STRIKE";
        if (String(event.weapon_type).includes("drone") || String(event.subcategory).includes("drone")) {
            sirenMeta = "via DEV TEST · INCOMING UAV / DRONE THREAT";
        } else if (String(event.weapon_type).includes("air_strike")) {
            sirenMeta = "via DEV TEST · AIR STRIKE WARNING";
        } else if (String(event.weapon_type).includes("missile")) {
            sirenMeta = "via DEV TEST · TAKE SHELTER IMMEDIATELY";
        }

        showSirenAlert({
            title: `SIRENS GOING OFF IN: ${impactLabel}`,
            meta: sirenMeta,
            level: sirenLevel,
            sound: true,
        });

        devLog(`🚀 Fired: ${event.title} → Siren: ${impactLabel}`);
    }

    // Siren / alert
    if (event.category === "alert" || String(event.title + event.summary).toLowerCase().includes("siren")) {
        triggerWarzoneAlert({
            title: event.title,
            location: event.location_label,
            level: "critical",
            playSound: true,
        });
        globe?.highlightAlertRegion?.(event);
        devLog(`🔴 Alert: ${event.title}`);
    }

    // Military track (aircraft / naval) — always fire from dev panel
    if (event.category === "military" && tracks) {
        tracks.addTrack(event);
        devLog(`✈ Track: ${event.title}`);

        // Fly camera to track location
        const viewer = window.__warzoneViewer;
        if (viewer) {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                    Number(event.lon), Number(event.lat), 800000
                ),
                duration: 1.2,
            });
        }
    }

    // Hotspot layer
    window.__hotspotLayer?.addEvent?.(event);

    // Generic event (cyber, thermal, etc.)
    if (!["military", "alert"].includes(event.category)) {
        devLog(`📍 Event: ${event.title}`);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initDevPanel() {
    // ── Activation check ────────────────────────────────────────────────────
    // Show dev panel if:
    //   1. localhost / 127.0.0.1 / empty hostname (direct file open)
    //   2. URL has ?devpanel=1 (staging / any URL)
    //   3. localStorage flag: localStorage.setItem('wz_dev','1') then refresh
    //   4. Keyboard shortcut Ctrl+Shift+` (backtick) anytime — activates for session
    const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "" ||
        window.location.search.includes("devpanel=1") ||
        localStorage.getItem("wz_dev") === "1";

    // Panel HTML lives in partials/popups.html → #wz-dev-panel
    // JS just reveals it and wires events
    const panel = document.getElementById("wz-dev-panel");
    if (!panel) {
        console.warn("[DevPanel] #wz-dev-panel not found — ensure partials/popups.html is loaded.");
        return;
    }

    // ── Secret keyboard shortcut: Ctrl+Shift+` ────────────────────────────
    // Works on any hostname — no URL change needed.
    // Once activated, writes localStorage flag so it persists across refreshes.
    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "`" || e.key === "~" || e.code === "Backquote")) {
            e.preventDefault();
            if (panel.hidden) {
                panel.hidden = false;
                localStorage.setItem("wz_dev", "1");
                devLog("🔑 Dev panel unlocked via keyboard shortcut");
                console.log("[dev] Warzone dev panel activated — Ctrl+Shift+` pressed");
            } else {
                // Toggle body collapse (don't hide the whole panel, just collapse it)
                const body = document.getElementById("wz-dev-body");
                if (body) body.hidden = !body.hidden;
            }
        }
    });

    if (!isLocal) return;

    panel.hidden = false;

    // Toggle body
    document.getElementById("wz-dev-toggle").addEventListener("click", () => {
        const body = document.getElementById("wz-dev-body");
        if (body) body.hidden = !body.hidden;
    });

    // Individual buttons
    document.querySelectorAll(".wz-dev-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            fireTestEvent(btn.dataset.event);
        });
    });

    // Siren buttons
    document.querySelectorAll(".wz-dev-btn[data-siren]").forEach(btn => {
        btn.addEventListener("click", () => {
            const level = btn.dataset.siren;
            const titles = {
                red: "TEL AVIV, HAIFA, CENTRAL ISRAEL",
                orange: "BEIRUT, SOUTHERN LEBANON, SIDON",
                yellow: "NORTHERN ISRAEL, HAMIFRATZ, HAMAKIM",
            };
            const metas = {
                red: "via IDF Home Front · TAKE SHELTER IMMEDIATELY",
                orange: "via Telegram (3 reports) · Confirmed",
                yellow: "via Tzofar (Tzeva Adom) · Unconfirmed",
            };
            showSirenAlert({ title: titles[level], meta: metas[level], level, sound: true });
            devLog(`🔔 Siren [${level.toUpperCase()}]: ${titles[level]}`);
        });
    });

    // Pulse highlight test buttons
    const HIGHLIGHT_LOCATIONS = {
        israel: { lat: 31.5, lon: 34.8, severity: "critical", label: "Israel" },
        uae: { lat: 24.2, lon: 54.4, severity: "high", label: "UAE" },
        iran: { lat: 32.4, lon: 53.7, severity: "critical", label: "Iran" },
        ukraine: { lat: 49.0, lon: 32.0, severity: "high", label: "Ukraine" },
    };

    document.querySelectorAll(".wz-dev-btn[data-highlight]").forEach(btn => {
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
            globe.highlightAlertRegion({ lat: loc.lat, lon: loc.lon, severity: loc.severity });
            // Also fly camera to it so you can see the effect
            window.__warzoneViewer?.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, 900000),
                duration: 1.2,
            });
            devLog(`🔴 Pulse highlight: ${loc.label} [${loc.severity}]`);
        });
    });

    // Fire all
    document.getElementById("wz-dev-fire-all").addEventListener("click", () => {
        let delay = 0;
        Object.keys(TEST_EVENTS).forEach(key => {
            setTimeout(() => fireTestEvent(key), delay);
            delay += 800;  // 800ms between each so globe doesn't get flooded
        });
        devLog(`⚡ Firing all ${Object.keys(TEST_EVENTS).length} test events...`);
    });

    // Clear log
    document.getElementById("wz-dev-clear").addEventListener("click", () => {
        const log = document.getElementById("wz-dev-log");
        if (log) log.innerHTML = "";
    });

    devLog("Dev panel ready");
    console.log("[dev] Warzone dev panel active — localhost only");
}