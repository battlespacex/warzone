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

import { triggerWarzoneAlert } from "./essential.js";
import { isMilitaryTrackEvent } from "./warzone-military-tracks.js";
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

// ─── Panel HTML ────────────────────────────────────────────────────────────────

const PANEL_HTML = `
<div id="wz-dev-panel" style="
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 9999;
    font-family: 'Rajdhani', monospace, sans-serif;
">
    <!-- Toggle button -->
    <button id="wz-dev-toggle" style="
        display: block;
        margin-left: auto;
        padding: 0.4rem 0.9rem;
        background: rgba(255,7,83,0.15);
        border: 1px solid rgba(255,7,83,0.5);
        color: #ff0753;
        font-family: inherit;
        font-size: 0.85rem;
        letter-spacing: 0.15em;
        cursor: pointer;
        clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
    ">⚙ DEV</button>

    <!-- Panel -->
    <div id="wz-dev-body" style="
        display: none;
        margin-top: 0.5rem;
        width: 22rem;
        background: rgba(4, 7, 12, 0.97);
        border: 1px solid rgba(255,7,83,0.3);
        padding: 1rem;
        clip-path: polygon(0 0, calc(100% - 1rem) 0, 100% 1rem, 100% 100%, 1rem 100%, 0 calc(100% - 1rem));
        box-shadow: 0 8px 32px rgba(0,0,0,0.8);
    ">
        <div style="color:#ff0753;font-size:0.8rem;letter-spacing:0.15em;margin-bottom:0.8rem;border-bottom:1px solid rgba(255,7,83,0.2);padding-bottom:0.5rem;">
            ⚠ DEV TEST PANEL — LOCAL ONLY
        </div>

        <div style="display:grid;gap:0.4rem;">

            <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;letter-spacing:0.1em;margin-top:0.3rem;">MISSILE / STRIKE</div>
            <button class="wz-dev-btn" data-event="missile_iran_israel"    style="--c:#ff0753">🚀 Missile — Iran → Israel</button>
            <button class="wz-dev-btn" data-event="missile_russia_ukraine" style="--c:#ff0753">🚀 Missile — Russia → Ukraine</button>
            <button class="wz-dev-btn" data-event="drone_kamikaze"         style="--c:#ff6a00">🛸 Drone Strike (Shahed)</button>
            <button class="wz-dev-btn" data-event="airstrike"              style="--c:#ff6a00">💥 Air Strike (IAF)</button>

            <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;letter-spacing:0.1em;margin-top:0.5rem;">SIRENS / ALERTS</div>
            <button class="wz-dev-btn" data-siren="red"    style="--c:#d42020">🔴 RED — Sirens Going Off (Israel)</button>
            <button class="wz-dev-btn" data-siren="orange" style="--c:#d45a00">🟠 ORANGE — Sirens Reported (Lebanon)</button>
            <button class="wz-dev-btn" data-siren="yellow" style="--c:#b88000">🟡 YELLOW — Incoming Warning</button>

            <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;letter-spacing:0.1em;margin-top:0.5rem;">MILITARY AIRCRAFT</div>
            <button class="wz-dev-btn" data-event="aircraft_fighter" style="--c:#56d80e">✈ Fighter — F-35I (IAF)</button>
            <button class="wz-dev-btn" data-event="aircraft_awacs"   style="--c:#ffd24d">✈ AWACS E-3 Sentry (NATO)</button>
            <button class="wz-dev-btn" data-event="aircraft_recon"   style="--c:#ff6a00">✈ Recon RC-135 (USAF)</button>
            <button class="wz-dev-btn" data-event="aircraft_tanker"  style="--c:#00d8b2">✈ Tanker KC-135 (USAF)</button>

            <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;letter-spacing:0.1em;margin-top:0.5rem;">NAVAL</div>
            <button class="wz-dev-btn" data-event="ship_carrier"   style="--c:#ff2a2a">⛵ Carrier — USS Gerald R Ford</button>
            <button class="wz-dev-btn" data-event="ship_destroyer" style="--c:#9b7bff">⛵ Destroyer — USS Arleigh Burke</button>
            <button class="wz-dev-btn" data-event="ship_russian"   style="--c:#ff6a00">⛵ Frigate — Admiral Gorshkov</button>

            <div style="color:rgba(255,255,255,0.4);font-size:0.75rem;letter-spacing:0.1em;margin-top:0.5rem;">OTHER</div>
            <button class="wz-dev-btn" data-event="cyber"   style="--c:#9b7bff">💻 Cyber Attack — Iran</button>
            <button class="wz-dev-btn" data-event="thermal" style="--c:#ff7a00">🔥 Thermal Anomaly — Syria</button>

            <div style="margin-top:0.8rem;display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
                <button id="wz-dev-fire-all" style="
                    padding:0.4rem;
                    background:rgba(255,7,83,0.1);
                    border:1px solid rgba(255,7,83,0.4);
                    color:#ff0753;
                    font-family:inherit;
                    font-size:0.8rem;
                    letter-spacing:0.08em;
                    cursor:pointer;
                ">⚡ FIRE ALL</button>
                <button id="wz-dev-clear" style="
                    padding:0.4rem;
                    background:rgba(255,255,255,0.04);
                    border:1px solid rgba(255,255,255,0.12);
                    color:rgba(255,255,255,0.5);
                    font-family:inherit;
                    font-size:0.8rem;
                    letter-spacing:0.08em;
                    cursor:pointer;
                ">✕ CLEAR LOG</button>
            </div>

            <div id="wz-dev-log" style="
                margin-top:0.5rem;
                max-height:6rem;
                overflow-y:auto;
                font-size:0.78rem;
                color:rgba(255,255,255,0.35);
                font-family:monospace;
                border-top:1px solid rgba(255,255,255,0.06);
                padding-top:0.5rem;
            "></div>
        </div>
    </div>
</div>

<style>
.wz-dev-btn {
    padding: 0.45rem 0.7rem;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-left: 2px solid var(--c, #ff0753);
    color: rgba(255,255,255,0.75);
    font-family: 'Rajdhani', monospace, sans-serif;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
    letter-spacing: 0.03em;
}
.wz-dev-btn:hover {
    background: rgba(255,255,255,0.07);
    border-left-color: var(--c, #ff0753);
    color: #fff;
}
.wz-dev-btn:active {
    background: rgba(255,255,255,0.12);
}
</style>
`;

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
        devLog(`🚀 Fired: ${event.title}`);
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

    // Military track (aircraft / naval)
    if (event.category === "military" && tracks) {
        const isMilTrack =
            event.source_name?.includes("ADS-B") ||
            event.source_name?.includes("AIS");

        if (isMilTrack) {
            tracks.addTrack(event);
            devLog(`✈ Track: ${event.title}`);
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
    // Only show on localhost / dev
    const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "" ||
        window.location.search.includes("devpanel=1");  // ?devpanel=1 for staging test

    if (!isLocal) return;

    // Inject HTML
    const container = document.createElement("div");
    container.innerHTML = PANEL_HTML;
    document.body.appendChild(container);

    // Toggle
    document.getElementById("wz-dev-toggle").addEventListener("click", () => {
        const body = document.getElementById("wz-dev-body");
        body.style.display = body.style.display === "none" ? "block" : "none";
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