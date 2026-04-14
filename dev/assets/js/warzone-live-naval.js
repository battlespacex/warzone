// File Path: /assets/js/live-naval.js
//
// Naval vessel tracker — frontend counterpart to warzone-live-fighter.js
// Renders AIS military vessels on the Cesium globe with:
//  - Ship billboard icons with heading rotation
//  - Zoom-level labels (vessel name + class)
//  - Click → X-lines targeting reticle + info panel near vessel
//  - Naval Tracker widget list with live positions
import * as Cesium from "cesium";

// ─── State ────────────────────────────────────────────────────────────────────
const __navalState = {
    vessels: new Map(),    // track_key → { entity, data }
    overlayRoot: null,
    overlayBound: false,
    clickBound: false,
    clickHandler: null,
    selectedKey: null,
    focusGuideEl: null,
    isCameraFlying: false,
};

// ─── Constants ────────────────────────────────────────────────────────────────
const NAVAL_LABEL_HEIGHT_MAX = 3500000;  // Show labels below this camera altitude
const NAVAL_FOCUS_GUIDE_COLOR = "rgba(51, 217, 255, 0.75)";
const NAVAL_MIN_ANIM_DISTANCE_METERS = 40;
const NAVAL_MIN_ANIM_MS = 1800;
const NAVAL_MAX_ANIM_MS = 18000;
const NAVAL_FOCUS_CAMERA_RANGE_METERS = 120000;
const NAVAL_FOCUS_CAMERA_PITCH_DEG = -89;
let __navalRenderDebounceTimer = null;

// ─── Ship icon canvases (cached) ──────────────────────────────────────────────
const __navalIconCache = new Map();
const NAVAL_SUBTYPE_META = {
    carrier: { label: "Carrier", color: "#ff3a3a", priority: 0 },
    amphibious: { label: "Amphibious", color: "#ff6a3d", priority: 1 },
    cruiser: { label: "Cruiser", color: "#ff9b40", priority: 2 },
    destroyer: { label: "Destroyer", color: "#ff7820", priority: 3 },
    frigate: { label: "Frigate", color: "#ffcc00", priority: 4 },
    corvette: { label: "Corvette", color: "#f29f05", priority: 5 },
    ssbn: { label: "SSBN", color: "#8d63ff", priority: 6 },
    ssn: { label: "SSN", color: "#7b7cff", priority: 7 },
    ssk: { label: "SSK", color: "#60a4ff", priority: 8 },
    aip_submarine: { label: "AIP Sub", color: "#49b8ff", priority: 9 },
    submarine: { label: "Submarine", color: "#9b7bff", priority: 10 },
    missile_boat: { label: "Missile Boat", color: "#ff8d5a", priority: 11 },
    patrol: { label: "Patrol", color: "#33d9ff", priority: 12 },
    logistics: { label: "Logistics", color: "#57b8ff", priority: 13 },
    minesweeper: { label: "Minesweeper", color: "#00d9b2", priority: 14 },
    naval: { label: "Naval", color: "#33d9ff", priority: 15 },
};
const NAVAL_SUBTYPE_ALIASES = new Map([
    ["aircraft_carrier", "carrier"],
    ["helicopter_carrier", "carrier"],
    ["carrier_group", "carrier"],
    ["amphibious_assault", "amphibious"],
    ["landing_platform_dock", "amphibious"],
    ["landing_helicopter_dock", "amphibious"],
    ["amphibious_transport_dock", "amphibious"],
    ["guided_missile_cruiser", "cruiser"],
    ["guided_missile_destroyer", "destroyer"],
    ["guided_missile_frigate", "frigate"],
    ["fast_attack_craft", "missile_boat"],
    ["attack_submarine", "ssn"],
    ["nuclear_attack_submarine", "ssn"],
    ["ballistic_missile_submarine", "ssbn"],
    ["nuclear_submarine", "ssn"],
    ["diesel_submarine", "ssk"],
    ["diesel_electric_submarine", "ssk"],
    ["aip", "aip_submarine"],
    ["aip_sub", "aip_submarine"],
    ["sub", "submarine"],
]);
const NAVAL_SUBTYPE_INFER_PATTERNS = [
    { subtype: "ssbn", pattern: /\bssbn\b|ballistic missile submarine|boomer|trident|borei|vanguard|triomphant|jin[-\s]?class|type[-\s]?094|type[-\s]?096|arihant/i },
    { subtype: "ssn", pattern: /\bssn\b|nuclear attack submarine|attack submarine|virginia class|seawolf|astute|yasen|akula|suffren|rubis/i },
    { subtype: "aip_submarine", pattern: /\baip\b|air independent propulsion|type[-\s]?212|type[-\s]?214|scorpene|kalvari|soryu|taigei|gotland|blekinge/i },
    { subtype: "ssk", pattern: /\bssk\b|diesel[-\s]?electric submarine|kilo class|yuan class|type[-\s]?039|type[-\s]?041|agosta|dolphin class|collins class/i },
    { subtype: "carrier", pattern: /\bcvn[-\s]?\d+\b|\bcv[-\s]?\d+\b|aircraft carrier|helicopter carrier|light carrier|gerald r ford|nimitz|liaoning|shandong|fujian|queen elizabeth|charles de gaulle|cavour|kuznetsov|vikramaditya|vikrant|izumo|kaga|juan carlos/i },
    { subtype: "amphibious", pattern: /\blhd[-\s]?\d+\b|\blha[-\s]?\d+\b|\blpd[-\s]?\d+\b|\blph[-\s]?\d+\b|\blsd[-\s]?\d+\b|\blst[-\s]?\d+\b|amphibious assault|landing platform dock|landing helicopter dock|amphibious transport dock|mistral class|dokdo class|wasp class|america class|san antonio/i },
    { subtype: "cruiser", pattern: /\bcg[-\s]?\d+\b|guided missile cruiser|\bcruiser\b|slava class|kirov class|ticonderoga class|type[-\s]?055|renhai/i },
    { subtype: "destroyer", pattern: /\bddg[-\s]?\d+\b|\bdd[-\s]?\d+\b|guided missile destroyer|\bdestroyer\b|arleigh burke|zumwalt|daring class|type[-\s]?052|atago class|maya class|kongo class|sejong|kolkata class|visakhapatnam class|sovremenny|udaloy/i },
    { subtype: "frigate", pattern: /\bffg[-\s]?\d+\b|\bfrigate\b|admiral gorshkov|fremm|constellation class|type[-\s]?054|type[-\s]?26|type[-\s]?31|la fayette|talwar class|shivalik class/i },
    { subtype: "corvette", pattern: /\bcorvette\b|type[-\s]?056|sa['’]?ar|karakurt|buyan|ada class|kamorta|braunschweig/i },
    { subtype: "missile_boat", pattern: /missile boat|fast attack craft|\bfac\b|type[-\s]?022|molniya class|houbei/i },
    { subtype: "minesweeper", pattern: /mine countermeasure|minehunter|minesweeper|\bmcm\b/i },
    { subtype: "logistics", pattern: /fleet oiler|combat support ship|replenishment|\baor[-\s]?\d+\b|\baoe[-\s]?\d+\b|\bt-ao[-\s]?\d+\b|\bt-ake[-\s]?\d+\b|sealift|auxiliary|support ship|supply ship|ammunition ship/i },
    { subtype: "patrol", pattern: /offshore patrol vessel|patrol vessel|patrol ship|\bopv\b|coast guard cutter/i },
    { subtype: "submarine", pattern: /\bsubmarine\b|\bsub\b/i },
];
const NAVAL_OPERATOR_DIRECTORY = [
    { pattern: /\bUSS\b|\bUSNS\b|\bUSCGC\b|\bUS NAVY\b|MILITARY SEALIFT COMMAND/i, operator: "US Navy", country: "United States" },
    { pattern: /\bRFS\b|RUSSIAN NAVY|RUSSIAN FEDERATION NAVY/i, operator: "Russian Navy", country: "Russia" },
    { pattern: /\bPLAN\b|\bPLA NAVY\b|PEOPLE'?S LIBERATION ARMY NAVY/i, operator: "PLA Navy", country: "China" },
    { pattern: /\bHMS\b|ROYAL NAVY/i, operator: "Royal Navy", country: "United Kingdom" },
    { pattern: /\bRFA\b/i, operator: "Royal Fleet Auxiliary", country: "United Kingdom" },
    { pattern: /\bFS\b|MARINE NATIONALE|FRENCH NAVY/i, operator: "French Navy", country: "France" },
    { pattern: /\bITS\b|MARINA MILITARE|ITALIAN NAVY/i, operator: "Italian Navy", country: "Italy" },
    { pattern: /\bTCG\b|TURKISH NAVY/i, operator: "Turkish Navy", country: "Turkey" },
    { pattern: /\bINS\b|INDIAN NAVY/i, operator: "Indian Navy", country: "India" },
    { pattern: /\bPNS\b|PAKISTAN NAVY/i, operator: "Pakistan Navy", country: "Pakistan" },
    { pattern: /\bJDS\b|\bJMSDF\b|JAPAN MARITIME SELF[- ]DEFENSE FORCE/i, operator: "JMSDF", country: "Japan" },
    { pattern: /\bROKS\b|REPUBLIC OF KOREA NAVY|\bROK NAVY\b/i, operator: "ROK Navy", country: "South Korea" },
    { pattern: /\bHMAS\b|ROYAL AUSTRALIAN NAVY/i, operator: "Royal Australian Navy", country: "Australia" },
    { pattern: /\bHMCS\b|ROYAL CANADIAN NAVY/i, operator: "Royal Canadian Navy", country: "Canada" },
    { pattern: /\bSPS\b|ARMADA ESPANOLA|SPANISH NAVY/i, operator: "Spanish Navy", country: "Spain" },
    { pattern: /\bHNLMS\b|ROYAL NETHERLANDS NAVY|DUTCH NAVY/i, operator: "Royal Netherlands Navy", country: "Netherlands" },
    { pattern: /\bFGS\b|GERMAN NAVY|DEUTSCHE MARINE/i, operator: "German Navy", country: "Germany" },
    { pattern: /\bNRP\b|PORTUGUESE NAVY/i, operator: "Portuguese Navy", country: "Portugal" },
    { pattern: /\bORP\b|POLISH NAVY/i, operator: "Polish Navy", country: "Poland" },
    { pattern: /\bBNS\b|BELGIAN NAVY/i, operator: "Belgian Navy", country: "Belgium" },
    { pattern: /\bHSWMS\b|SWEDISH NAVY/i, operator: "Swedish Navy", country: "Sweden" },
    { pattern: /\bIRIS\b|\bIRIN\b/i, operator: "Iranian Navy", country: "Iran" },
    { pattern: /\bIRGCN\b|ISLAMIC REVOLUTIONARY GUARD CORPS NAVY/i, operator: "IRGC Navy", country: "Iran" },
    { pattern: /ISRAELI NAVY/i, operator: "Israeli Navy", country: "Israel" },
    { pattern: /ROYAL SAUDI NAVAL FORCES|SAUDI NAVY/i, operator: "Royal Saudi Naval Forces", country: "Saudi Arabia" },
    { pattern: /EGYPTIAN NAVY/i, operator: "Egyptian Navy", country: "Egypt" },
    { pattern: /REPUBLIC OF SINGAPORE NAVY|\bRSN\b/i, operator: "Republic of Singapore Navy", country: "Singapore" },
    { pattern: /INDONESIAN NAVY|TENTARA NASIONAL INDONESIA ANGKATAN LAUT/i, operator: "Indonesian Navy", country: "Indonesia" },
    { pattern: /BRAZILIAN NAVY|MARINHA DO BRASIL/i, operator: "Brazilian Navy", country: "Brazil" },
    { pattern: /ARGENTINE NAVY|ARMADA ARGENTINA/i, operator: "Argentine Navy", country: "Argentina" },
    { pattern: /CHILEAN NAVY|ARMADA DE CHILE/i, operator: "Chilean Navy", country: "Chile" },
    { pattern: /PERUVIAN NAVY|MARINA DE GUERRA DEL PERU/i, operator: "Peruvian Navy", country: "Peru" },
];

function normalizeText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function normalizeAffiliationText(value = "") {
    const clean = normalizeText(value);
    if (!clean) return "";
    if (/^(unknown|n\/a|null|none|na|not available)$/i.test(clean)) return "";
    return clean;
}
function toFiniteNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseEventMetadata(raw) {
    if (!raw) return {};
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function normalizeNavalSubtypeKey(value = "") {
    const normalized = normalizeText(value)
        .toLowerCase()
        .replace(/[/-]+/g, " ")
        .replace(/\s+/g, "_");
    if (!normalized) return "";
    if (NAVAL_SUBTYPE_META[normalized]) return normalized;
    return NAVAL_SUBTYPE_ALIASES.get(normalized) || normalized;
}
function inferNavalSubtypeFromText(text = "") {
    const haystack = normalizeText(text);
    if (!haystack) return "";
    const hit = NAVAL_SUBTYPE_INFER_PATTERNS.find((entry) => entry.pattern.test(haystack));
    return hit ? hit.subtype : "";
}
function resolveNavalSubtype(rawSubtype = "", hintText = "") {
    const subtype = normalizeNavalSubtypeKey(rawSubtype);
    const inferred = inferNavalSubtypeFromText(hintText);
    if (!subtype) return inferred || "naval";
    if (subtype === "naval" && inferred) return inferred;
    if (subtype === "submarine" && ["ssbn", "ssn", "ssk", "aip_submarine"].includes(inferred)) {
        return inferred;
    }
    return NAVAL_SUBTYPE_META[subtype] ? subtype : (inferred || "naval");
}
function getNavalSubtypeLabel(subtype = "") {
    const key = normalizeNavalSubtypeKey(subtype);
    return (NAVAL_SUBTYPE_META[key] || NAVAL_SUBTYPE_META.naval).label;
}
function getNavalPriority(subtype = "") {
    const key = normalizeNavalSubtypeKey(subtype);
    return (NAVAL_SUBTYPE_META[key] || NAVAL_SUBTYPE_META.naval).priority;
}
function inferNavalOperatorFromText(text = "") {
    const haystack = normalizeText(text);
    if (!haystack) return { operator: "", country: "" };
    const hit = NAVAL_OPERATOR_DIRECTORY.find((entry) => entry.pattern.test(haystack));
    if (!hit) return { operator: "", country: "" };
    return { operator: hit.operator || "", country: hit.country || "" };
}
function resolveVesselAffiliation({ operator = "", country = "", hintText = "" } = {}) {
    const cleanOperator = normalizeAffiliationText(operator);
    const cleanCountry = normalizeAffiliationText(country);
    if (cleanOperator && cleanCountry) {
        return { operator: cleanOperator, country: cleanCountry };
    }
    const inferred = inferNavalOperatorFromText(hintText);
    return {
        operator: cleanOperator || inferred.operator || "",
        country: cleanCountry || inferred.country || "",
    };
}
function buildVesselHintText(event = {}, metadata = {}) {
    return [
        event.title,
        event.summary,
        event.subcategory,
        event.weapon_type,
        metadata.vessel_name,
        metadata.vessel_class,
        metadata.ship_class,
        metadata.ship_type_name,
        metadata.shipTypeName,
        metadata.operator,
        metadata.country,
        metadata.call_sign,
        metadata.callSign,
    ]
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join(" ");
}
function getVesselColor(subcat = "naval") {
    const key = normalizeNavalSubtypeKey(subcat);
    const meta = NAVAL_SUBTYPE_META[key] || NAVAL_SUBTYPE_META.naval;
    return meta.color;
}

function createShipIcon(color = "#33d9ff", subcat = "naval") {
    const key = `${color}:${subcat}`;
    if (__navalIconCache.has(key)) return __navalIconCache.get(key);

    const sz = 64;
    const cx = sz / 2;
    const cy = sz / 2;
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, sz, sz);

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    glow.addColorStop(0, color);
    glow.addColorStop(0.4, color + "60");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();

    // Ship silhouette — top-facing arrow for heading
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Hull: elongated diamond pointing up (north = ship bow)
    ctx.moveTo(cx, cy - 14); // bow (top)
    ctx.lineTo(cx + 6, cy + 2);
    ctx.lineTo(cx + 4, cy + 14); // stern right
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx - 4, cy + 14); // stern left
    ctx.lineTo(cx - 6, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");
    __navalIconCache.set(key, dataUrl);
    return dataUrl;
}

function getCssNumber(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function getCssColor(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}
function requestNavalRenderBatched() {
    if (__navalRenderDebounceTimer) return;
    __navalRenderDebounceTimer = setTimeout(() => {
        __navalRenderDebounceTimer = null;
        window.__warzoneViewer?.scene?.requestRender?.();
    }, 16);
}
function getNavalLabelStyleConfig() {
    return {
        scale: getCssNumber("--warzone-live-label-scale", 0.42),
        offsetY: getCssNumber("--warzone-live-label-offset-y", -18) - 8,
        fill: getCssColor("--warzone-live-label-fill", "#d7dee7"),
        background: getCssColor("--warzone-live-label-background", "rgba(8, 12, 20, 0.84)"),
        paddingX: getCssNumber("--warzone-live-label-padding-x", 6),
        paddingY: getCssNumber("--warzone-live-label-padding-y", 3),
        maxDistance: getCssNumber("--warzone-live-label-distance", 180000),
        animHeightMax: getCssNumber("--warzone-live-naval-anim-height-max", 2200000),
    };
}
function buildNavalLabel(vessel = {}, trackKey = "") {
    const labelStyle = getNavalLabelStyleConfig();
    return {
        text: vessel.vessel_name || vessel.title || getNavalSubtypeLabel(vessel.subcategory) || "Naval",
        show: new Cesium.CallbackProperty(() => shouldShowNavalLabel(trackKey), false),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelStyle.maxDistance),
        scale: labelStyle.scale,
        pixelOffset: new Cesium.Cartesian2(0, labelStyle.offsetY),
        fillColor: Cesium.Color.fromCssColorString(labelStyle.fill).withAlpha(0.98),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(labelStyle.background),
        backgroundPadding: new Cesium.Cartesian2(labelStyle.paddingX, labelStyle.paddingY),
        outlineWidth: 0,
        style: Cesium.LabelStyle.FILL,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
}
function applyNavalLabel(label, vessel = {}, trackKey = "") {
    if (!label) return;
    const nextConfig = buildNavalLabel(vessel, trackKey);
    label.text = nextConfig.text;
    label.show = nextConfig.show;
    label.distanceDisplayCondition = nextConfig.distanceDisplayCondition;
    label.scale = nextConfig.scale;
    label.pixelOffset = nextConfig.pixelOffset;
    label.fillColor = nextConfig.fillColor;
    label.showBackground = nextConfig.showBackground;
    label.backgroundColor = nextConfig.backgroundColor;
    label.backgroundPadding = nextConfig.backgroundPadding;
    label.outlineWidth = nextConfig.outlineWidth;
    label.style = nextConfig.style;
    label.horizontalOrigin = nextConfig.horizontalOrigin;
    label.verticalOrigin = nextConfig.verticalOrigin;
    label.disableDepthTestDistance = nextConfig.disableDepthTestDistance;
}

// ─── Label visibility ─────────────────────────────────────────────────────────
function shouldShowNavalLabel(trackKey) {
    if (__navalState.selectedKey === trackKey) return true;
    const h = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    return h > 0 && h <= NAVAL_LABEL_HEIGHT_MAX;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function getEntityPosition(entity) {
    if (!entity?.position) return null;
    try {
        if (typeof entity.position.getValue === "function") {
            return entity.position.getValue(Cesium.JulianDate.now());
        }
        return entity.position || null;
    } catch {
        return null;
    }
}
function animateVesselTo(entity, vessel) {
    if (!entity) return;
    if (entity.__navalAnimFrame) {
        cancelAnimationFrame(entity.__navalAnimFrame);
        entity.__navalAnimFrame = null;
    }
    const nextCartesian = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 0);
    const startCartesian = getEntityPosition(entity);
    const commitPosition = (cartesianPosition) => {
        entity.position = cartesianPosition;
        if (entity.billboard) {
            entity.billboard.rotation = Cesium.Math.toRadians(-(Number(vessel.heading_deg || 0)));
        }
        requestNavalRenderBatched();
    };
    if (!startCartesian) {
        commitPosition(nextCartesian);
        return;
    }
    const distanceMeters = Cesium.Cartesian3.distance(startCartesian, nextCartesian);
    const cameraHeight = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    const animHeightMax = getNavalLabelStyleConfig().animHeightMax;
    if (
        !Number.isFinite(distanceMeters) ||
        distanceMeters <= NAVAL_MIN_ANIM_DISTANCE_METERS ||
        (Number.isFinite(cameraHeight) && cameraHeight > animHeightMax)
    ) {
        commitPosition(nextCartesian);
        return;
    }
    const duration = clamp(distanceMeters * 0.2, NAVAL_MIN_ANIM_MS, NAVAL_MAX_ANIM_MS);
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startHeading = Number(entity.__navalHeadingDeg || 0);
    const endHeading = Number(vessel.heading_deg || 0);
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const lon = startLon + ((vessel.lon - startLon) * eased);
        const lat = startLat + ((vessel.lat - startLat) * eased);
        entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        if (entity.billboard) {
            entity.billboard.rotation = Cesium.Math.toRadians(-(startHeading + ((endHeading - startHeading) * eased)));
        }
        requestNavalRenderBatched();
        if (t < 1) {
            entity.__navalAnimFrame = requestAnimationFrame(step);
        } else {
            entity.__navalAnimFrame = null;
            entity.__navalHeadingDeg = endHeading;
        }
    };
    entity.__navalAnimFrame = requestAnimationFrame(step);
}

// ─── Create vessel entity ─────────────────────────────────────────────────────
function createVesselEntity(viewer, vessel) {
    const { track_key, lat, lon, heading_deg = 0, subcategory = "naval" } = vessel;
    const color = getVesselColor(subcategory);
    const icon = createShipIcon(color, subcategory);
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    // Heading: 0° = North. Convert to Cesium HPR.
    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(heading_deg || 0),
        0, 0
    );

    const entity = viewer.entities.add({
        id: `naval-${track_key}`,
        position: pos,
        billboard: {
            image: icon,
            scale: 0.7,
            rotation: Cesium.Math.toRadians(-(heading_deg || 0)),
            alignedAxis: Cesium.Cartesian3.UNIT_Z,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: buildNavalLabel(vessel, track_key),
    });

    entity.__navalKey = track_key;
    entity.__navalData = vessel;
    entity.__navalHeadingDeg = heading_deg || 0;
    return entity;
}

// ─── Update vessel position ───────────────────────────────────────────────────
function updateVesselEntity(entity, vessel) {
    const { heading_deg = 0 } = vessel;
    animateVesselTo(entity, vessel);
    if (entity.label) {
        applyNavalLabel(entity.label, vessel, vessel.track_key);
    }
    entity.__navalHeadingDeg = heading_deg || 0;
    entity.__navalData = vessel;
}

// ─── X-lines overlay (targeting reticle) ─────────────────────────────────────
function ensureNavalOverlayRoot(viewer) {
    if (__navalState.overlayRoot?.isConnected) return __navalState.overlayRoot;
    const host = viewer?.container || document.body;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";

    const root = document.createElement("div");
    root.id = "wz-naval-focus-overlay";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;display:none;pointer-events:none;z-index:28;transform:translate(-50%,-50%)";

    const arms = [
        { cls: "is-top-left", x: -132, y: -88, rotate: 48 },
        { cls: "is-top-right", x: 40, y: -88, rotate: -48 },
        { cls: "is-bottom-left", x: -132, y: 82, rotate: -48 },
        { cls: "is-bottom-right", x: 40, y: 82, rotate: 48 },
    ];
    arms.forEach(item => {
        const arm = document.createElement("span");
        arm.style.cssText = `position:absolute;display:block;width:92px;height:4px;border-radius:999px;background:${NAVAL_FOCUS_GUIDE_COLOR};box-shadow:0 0 10px rgba(51,217,255,0.32);transform-origin:center;transform:translate(${item.x}px,${item.y}px) rotate(${item.rotate}deg);pointer-events:none`;
        root.appendChild(arm);
    });

    host.appendChild(root);
    __navalState.overlayRoot = root;
    return root;
}

function getScreenPosForVessel(trackKey) {
    const viewer = window.__warzoneViewer;
    if (!viewer) return null;
    const entry = __navalState.vessels.get(trackKey);
    if (!entry?.entity) return null;
    try {
        const pos = entry.entity.position.getValue(Cesium.JulianDate.now());
        if (!pos) return null;
        const fn = Cesium.SceneTransforms.worldToWindowCoordinates
            ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        const screen = fn(viewer.scene, pos);
        if (!screen || !Number.isFinite(screen.x)) return null;
        return screen;
    } catch { return null; }
}

function syncNavalOverlay() {
    const root = __navalState.overlayRoot;
    if (!root) return;
    const key = __navalState.selectedKey;
    if (!key) { root.style.display = "none"; return; }
    const screen = getScreenPosForVessel(key);
    if (!screen) { root.style.display = "none"; return; }
    root.style.display = "block";
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
}
function clearNavalCameraLock() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    try {
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch { }
}
function syncNavalCameraLock() {
    const viewer = window.__warzoneViewer;
    const trackKey = String(__navalState.selectedKey || "");
    if (!viewer || !trackKey || __navalState.isCameraFlying) return;
    const entry = __navalState.vessels.get(trackKey);
    const position = getEntityPosition(entry?.entity);
    if (!position) return;
    try {
        viewer.camera.lookAt(
            position,
            new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(NAVAL_FOCUS_CAMERA_PITCH_DEG),
                NAVAL_FOCUS_CAMERA_RANGE_METERS
            )
        );
    } catch { }
}

function clearNavalSelection() {
    __navalState.selectedKey = null;
    clearNavalCameraLock();
    if (__navalState.overlayRoot) __navalState.overlayRoot.style.display = "none";
    document.getElementById("warzone-naval-panel")?.remove();
    syncNavalWidgetHighlight(null);
}
function focusNavalVessel(trackKey, options = {}) {
    const viewer = window.__warzoneViewer;
    const entry = __navalState.vessels.get(trackKey);
    if (!viewer || !entry?.entity || !trackKey) return false;

    __navalState.selectedKey = trackKey;
    __navalState.isCameraFlying = true;
    viewer.camera.cancelFlight?.();
    viewer.flyTo(entry.entity, {
        duration: Number(options.duration || 1.2),
        offset: new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(NAVAL_FOCUS_CAMERA_PITCH_DEG),
            Math.max(NAVAL_FOCUS_CAMERA_RANGE_METERS, Number(options.cameraHeight || 0))
        ),
    }).then(() => {
        __navalState.isCameraFlying = false;
        syncNavalCameraLock();
    }).catch(() => {
        __navalState.isCameraFlying = false;
    });

    const panelX = Number.isFinite(options.screenX) ? options.screenX : (window.innerWidth / 2);
    const panelY = Number.isFinite(options.screenY) ? options.screenY : (window.innerHeight / 2);
    showNavalPanel(entry.data, panelX, panelY);
    syncNavalWidgetHighlight(trackKey);
    return true;
}

// ─── Info panel near vessel ───────────────────────────────────────────────────
function showNavalPanel(data, sx, sy) {
    document.getElementById("warzone-naval-panel")?.remove();

    const sub = data.subcategory || data.vessel_class || "naval";
    const subLabel = getNavalSubtypeLabel(sub);
    const color = getVesselColor(sub);
    const name = data.vessel_name || data.title || "Unknown Vessel";
    const speed = data.speed_kts != null ? `${Number(data.speed_kts).toFixed(1)} kt` : "—";
    const hdg = data.heading_deg != null ? `${Math.round(data.heading_deg)}°` : "—";
    const mmsi = data.mmsi || data.metadata?.mmsi || "—";
    const flag = data.country || data.metadata?.country || data.flag_country || "—";
    const operator = data.operator || data.metadata?.operator || "—";

    const panel = document.createElement("div");
    panel.id = "warzone-naval-panel";
    panel.style.cssText = "position:fixed;width:280px;z-index:900;background:rgba(8,12,20,0.96);border:1px solid rgba(51,217,255,0.18);border-radius:6px;padding:14px 16px;color:#fff;font-family:var(--warzone-font,'Barlow Condensed',sans-serif);box-shadow:0 4px 24px rgba(0,0,0,0.6);backdrop-filter:blur(8px);animation:milbase-fadein 0.18s ease";
    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);flex:1">${subLabel.toUpperCase()}</span>
            <button id="wz-naval-panel-close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:13px;padding:0;line-height:1">✕</button>
        </div>
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:10px">${name}</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
            ${flag !== "—" ? `<div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Flag</span><span style="color:rgba(255,255,255,.85)">${flag}</span></div>` : ""}
            ${operator !== "—" ? `<div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Operator</span><span style="color:rgba(255,255,255,.85)">${operator}</span></div>` : ""}
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Speed</span><span style="color:rgba(255,255,255,.85)">${speed}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Heading</span><span style="color:rgba(255,255,255,.85)">${hdg}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">MMSI</span><span style="color:rgba(255,255,255,.85);font-family:var(--font-mono,monospace)">${mmsi}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Lat / Lon</span><span style="color:rgba(255,255,255,.85)">${Number(data.lat).toFixed(4)}°, ${Number(data.lon).toFixed(4)}°</span></div>
        </div>`;

    document.body.appendChild(panel);

    // Position near click, auto-adjust to stay on screen
    const W = 288, H = 200;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = sx + 16, top = sy - 16;
    if (left + W > vw - 8) left = sx - W - 16;
    if (top + H > vh - 8) top = vh - H - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    document.getElementById("wz-naval-panel-close")?.addEventListener("click", e => {
        e.stopPropagation();
        clearNavalSelection();
    });
}

// ─── Widget row highlight ─────────────────────────────────────────────────────
function syncNavalWidgetHighlight(trackKey) {
    try {
        const widget = document.querySelector('[data-widget-id="naval"]');
        if (!widget) return;
        widget.querySelectorAll(".wz-naval-item[data-track-key]").forEach(row => {
            const match = row.dataset.trackKey === trackKey;
            row.classList.toggle("is-selected", match);
            if (match) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    } catch { }
}

// ─── Click + hover binding ────────────────────────────────────────────────────
function bindNavalPicking(viewer) {
    if (__navalState.clickBound) return;
    __navalState.clickBound = true;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    __navalState.clickHandler = handler;

    // Hover — cursor
    handler.setInputAction(movement => {
        const picked = viewer.scene.pick(movement.endPosition);
        const isNaval = picked?.id?.__navalKey;
        if (isNaval) {
            viewer.container.style.cursor = "pointer";
        } else if (!window.__wzBaseHover) {
            viewer.container.style.cursor = "";
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Click
    handler.setInputAction(movement => {
        const picked = viewer.scene.pick(movement.position);
        const trackKey = picked?.id?.__navalKey;

        if (!trackKey) {
            clearNavalSelection();
            return;
        }

        const entry = __navalState.vessels.get(trackKey);
        if (!entry) return;
        focusNavalVessel(trackKey, {
            screenX: movement.position.x,
            screenY: movement.position.y,
        });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Clear on camera drag
    viewer.camera.moveStart.addEventListener(() => {
        if (!__navalState.isCameraFlying && __navalState.selectedKey) {
            clearNavalSelection();
        }
    });
}

// ─── Overlay sync post-render ─────────────────────────────────────────────────
function bindNavalOverlay(viewer) {
    if (__navalState.overlayBound) return;
    __navalState.overlayBound = true;
    ensureNavalOverlayRoot(viewer);
    viewer.scene.preRender.addEventListener(syncNavalCameraLock);
    viewer.scene.postRender.addEventListener(syncNavalOverlay);
}

// ─── Public: upsert vessel (called from essential.js event handler) ───────────
export function upsertNavalVessel(event) {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;

    bindNavalOverlay(viewer);
    bindNavalPicking(viewer);

    // Build a unified vessel data object from event fields
    const metadata = parseEventMetadata(event.metadata);
    const hintText = buildVesselHintText(event, metadata);
    const rawSubtype = event.subcategory || metadata.vessel_class || metadata.ship_class || metadata.ship_type_name || metadata.shipTypeName || "";
    const resolvedSubtype = resolveNavalSubtype(rawSubtype, hintText);
    const affiliation = resolveVesselAffiliation({
        operator: metadata.operator || event.operator || "",
        country: metadata.country || event.country || "",
        hintText,
    });
    const trackKey = event.dedupe_key || event.source_key || metadata.track_key || `naval-${event.id}`;
    const vesselName = normalizeText(
        metadata.vessel_name ||
        metadata.name ||
        event.title?.replace(/\s*[-—]\s.*$/, "") ||
        event.title ||
        ""
    );
    const vessel = {
        track_key: trackKey,
        vessel_name: vesselName,
        subcategory: resolvedSubtype,
        vessel_class: normalizeText(metadata.vessel_class || metadata.ship_class || getNavalSubtypeLabel(resolvedSubtype)),
        lat: Number(event.lat),
        lon: Number(event.lon),
        heading_deg: toFiniteNumber(metadata.heading ?? event.heading_deg ?? 0, 0),
        speed_kts: toFiniteNumber(metadata.speed_kts ?? event.speed_kts ?? null, null),
        mmsi: normalizeText(metadata.mmsi || metadata.MMSI || ""),
        country: affiliation.country,
        operator: affiliation.operator,
        title: event.title || "",
        metadata,
    };

    if (!Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lon)) return;

    const existing = __navalState.vessels.get(trackKey);
    const entityId = `naval-${trackKey}`;
    const sceneEntity = viewer.entities.getById(entityId);
    if (existing?.entity && sceneEntity === existing.entity) {
        updateVesselEntity(existing.entity, vessel);
        existing.data = vessel;
    } else if (sceneEntity) {
        updateVesselEntity(sceneEntity, vessel);
        __navalState.vessels.set(trackKey, { entity: sceneEntity, data: vessel });
    } else {
        const entity = createVesselEntity(viewer, vessel);
        __navalState.vessels.set(trackKey, { entity, data: vessel });
    }

    requestNavalRenderBatched();
    dispatchNavalRegistryUpdate();
}

// ─── Public: clear vessel ─────────────────────────────────────────────────────
export function clearNavalVessel(trackKey) {
    const viewer = window.__warzoneViewer;
    const entry = __navalState.vessels.get(trackKey);
    if (entry?.entity?.__navalAnimFrame) {
        cancelAnimationFrame(entry.entity.__navalAnimFrame);
        entry.entity.__navalAnimFrame = null;
    }
    if (entry?.entity && viewer) viewer.entities.remove(entry.entity);
    __navalState.vessels.delete(trackKey);
    if (__navalState.selectedKey === trackKey) clearNavalSelection();
    requestNavalRenderBatched();
}

// ─── Public: get all vessel snapshots (for widget) ────────────────────────────
export function getAllNavalSnapshots() {
    return [...__navalState.vessels.values()]
        .map(v => v.data)
        .sort((a, b) => {
            const priorityDiff = getNavalPriority(a.subcategory) - getNavalPriority(b.subcategory);
            if (priorityDiff !== 0) return priorityDiff;
            const nameA = normalizeText(a.vessel_name || a.title || "");
            const nameB = normalizeText(b.vessel_name || b.title || "");
            return nameA.localeCompare(nameB);
        });
}

// ─── Registry update event ────────────────────────────────────────────────────
function dispatchNavalRegistryUpdate() {
    document.dispatchEvent(new CustomEvent("wz:naval-log-updated"));
}

// ─── Widget renderer ──────────────────────────────────────────────────────────
// Called from essential.js or warzone-ui.js to populate the naval widget list
export function renderNavalTrackerWidget(options = {}) {
    const container = document.getElementById("wz-naval-panel-list");
    if (!container) return;

    const vessels = Array.isArray(options?.vessels)
        ? options.vessels
        : getAllNavalSnapshots();
    const emptyMessage = String(options?.emptyMessage || "No naval contacts in current filter");

    if (!vessels.length) {
        container.innerHTML = `<div class="wz-aircraft-empty">${emptyMessage}</div>`;
        return;
    }

    container.innerHTML = vessels.slice(0, 20).map(v => {
        const color = getVesselColor(v.subcategory);
        const name = v.vessel_name || v.title || "Unknown Vessel";
        const sub = getNavalSubtypeLabel(v.subcategory).toUpperCase();
        const speed = v.speed_kts != null ? `${Number(v.speed_kts).toFixed(0)} kt` : "";
        const operator = normalizeText(v.operator || "");
        const flag = v.country ? `${v.country}` : "";

        return `<div class="wz-aircraft-item wz-naval-item" data-track-key="${v.track_key}" style="cursor:pointer" onclick="window.__navalFocusVessel?.('${v.track_key}')">
            <div class="wz-aircraft-item__top">
                <span class="wz-aircraft-badge" style="background:${color}22;color:${color};border-color:${color}44">${sub}</span>
                <span class="wz-aircraft-title">
                    <strong class="wz-aircraft-title__name">${name}</strong>
                    ${flag ? `<span class="wz-aircraft-title__status">${flag}</span>` : ""}
                </span>
            </div>
            ${(speed || operator) ? `<div class="wz-aircraft-item__stats">${speed ? `<span>${speed}</span>` : ""}${operator ? `<span>${operator}</span>` : ""}</div>` : ""}
        </div>`;
    }).join("");
}

// ─── Global focus helper (called from widget onclick) ─────────────────────────
window.__navalFocusVessel = (trackKey) => {
    focusNavalVessel(trackKey, {
        screenX: window.innerWidth / 2,
        screenY: window.innerHeight / 2,
    });
};
