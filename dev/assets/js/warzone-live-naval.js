// File Path: /assets/js/live-naval.js
//
// Naval vessel tracker — frontend counterpart to warzone-live-fighter.js
// Renders AIS military vessels on the Cesium globe with:
//  - Ship billboard icons with heading rotation
//  - Zoom-level labels (vessel name + class)
//  - Click → short-lived X-lines targeting reticle
//  - Naval Tracker widget list with live positions
import * as Cesium from "cesium";
import { getLiveTrackSelection, showFocusDriftWarningModal, closeFocusDriftWarningModal } from "./warzone-live-airforce.js";

// ─── State ────────────────────────────────────────────────────────────────────
const __navalState = {
    vessels: new Map(),    // track_key → { entity, data }
    overlayRoot: null,
    overlayBound: false,
    overlayLastVisible: false,
    overlayLastX: Number.NaN,
    overlayLastY: Number.NaN,
    clickBound: false,
    clickHandler: null,
    selectedKey: null,
    isCameraFlying: false,
    focusWarningActive: false,
};

// ─── Constants ────────────────────────────────────────────────────────────────
const NAVAL_LABEL_HEIGHT_MAX = 3500000;  // Show labels below this camera altitude
const NAVAL_FOCUS_GUIDE_COLOR = "rgba(51, 217, 255, 0.75)";
const NAVAL_MIN_ANIM_DISTANCE_METERS = 40;
const NAVAL_MIN_ANIM_MS = 900;
const NAVAL_MAX_ANIM_MS = 9000;
const NAVAL_DEFAULT_ANIM_MS = 2600;
const NAVAL_FOCUS_CAMERA_RANGE_METERS = 120000;
const NAVAL_FOCUS_CAMERA_PITCH_DEG = -89;
const NAVAL_FOCUS_WARNING_RANGE_METERS = 90000;
const NAVAL_FOCUS_FINAL_RANGE_METERS = 160000;
let __navalRenderDebounceTimer = null;
const NAVAL_BILLBOARD_CANVAS_SIZE = 64;
const NAVAL_RENDER_MODE = Object.freeze({
    PNG: "png",
    CHAR: "char",
    MODEL: "model",
});
const NAVAL_MODEL_DEFAULT_MAX_ACTIVE = 14;
const NAVAL_MODEL_DEFAULT_ZOOM_HEIGHT = 280000;
const NAVAL_CHAR_FALLBACK_DEFAULT_COUNT = 80;
const NAVAL_CONTACT_STALE_MS = 45 * 60 * 1000;
let __navalGlbMaterialShader = null;
const NAVAL_CONTACT_MAX_ITEMS = 320;
const NAVAL_ICON_CACHE_MAX_ITEMS = 128;
const NAVAL_NON_OPERATIONAL_PATTERNS = [
    /\bCV[-\s]?0?9\b/i, // USS Essex (CV-9), decommissioned in 1969.
    /\b(?:DECOMMISSIONED|RETIRED|MUSEUM(?:\s+SHIP)?|PRESERVED|SCRAPPED|STRICKEN|DISPOSED)\b/i,
];
const NAVAL_MODEL_BASE_PATH = "/assets/images/models/sea";
const NAVAL_MODEL_DEFAULT_ASSET_KEY = "Vessel-Frigate";
const LIVE_NAVAL_ICON_BASE_PATH = "/assets/images/live";
const LIVE_NAVAL_ICON_DEFAULT_CODE = "Vessel-Frigate";
const NAVAL_ASSET_FILES = Object.freeze({
    Boat: Object.freeze({ category: "small_vessel", model: "Vessel-Frigate.glb", icon: "live-naval-ns-1.png" }),
    "Carrier-US": Object.freeze({ category: "carrier", model: "Carrier-US.glb", icon: "live-naval-ac-us-1.png" }),
    "Carrier-France": Object.freeze({ category: "carrier", model: "Carrier-France.glb", icon: "live-naval-ac-fr-1.png" }),
    "Carrier-Fujian": Object.freeze({ category: "carrier", model: "Carrier-Fujian.glb", icon: "live-naval-ac-cn-1.png" }),
    "Carrier-HMS": Object.freeze({ category: "carrier", model: "Carrier-HMS.glb", icon: "live-naval-ac-uk-1.png" }),
    "Carrier-LHD": Object.freeze({ category: "amphibious", model: "Carrier-LHD.glb", icon: "live-naval-hc-1.png" }),
    "Carrier-Russian": Object.freeze({ category: "carrier", model: "Carrier-Russian.glb", icon: "live-naval-ac-rs-1.png" }),
    "Submarine-API": Object.freeze({ category: "submarine", model: "Submarine-API.glb", icon: "live-naval-sb-1.png" }),
    "Submarine-SSN": Object.freeze({ category: "submarine", model: "Submarine-SSN.glb", icon: "live-naval-sb-1.png" }),
    "Vessel-Frigate": Object.freeze({ category: "surface_combatant", model: "Vessel-Frigate.glb", icon: "live-naval-ns-2.png" }),
    "Vessel-ISR": Object.freeze({ category: "intelligence", model: "Vessel-ISR.glb", icon: "live-naval-ni-1.png" }),
    "Vessel-Zumwalt": Object.freeze({ category: "surface_combatant", model: "Vessel-Zumwalt.glb", icon: "live-naval-ns-3.png" }),
});
const NAVAL_ASSET_KEY_BY_ICON_CODE = Object.freeze({
    "ni-1": "Vessel-ISR",
    "ns-1": "Boat",
    "ns-2": "Vessel-Frigate",
    "ns-3": "Vessel-Frigate",
    "sb-1": "Submarine-SSN",
    "ac-us-1": "Carrier-US",
    "ac-cn-1": "Carrier-Fujian",
    "ac-uk-1": "Carrier-HMS",
    "ac-rs-1": "Carrier-Russian",
    "ac-fr-1": "Carrier-France",
    "hc-1": "Carrier-LHD",
});
const LIVE_NAVAL_ICON_CODES = new Set([
    ...Object.keys(NAVAL_ASSET_FILES),
    "ni-1",
    "ns-1",
    "ns-2",
    "ns-3",
    "sb-1",
    "ac-us-1",
    "ac-cn-1",
    "ac-uk-1",
    "ac-rs-1",
    "ac-fr-1",
    "hc-1",
]);
const NAVAL_ASSET_KEY_BY_SUBTYPE = {
    carrier: "Carrier-Fujian",
    amphibious: "Carrier-LHD",
    cruiser: "Vessel-Frigate",
    destroyer: "Vessel-Frigate",
    frigate: "Vessel-Frigate",
    corvette: "Vessel-Frigate",
    missile_boat: "Boat",
    patrol: "Boat",
    logistics: "Vessel-Frigate",
    minesweeper: "Boat",
    intelligence: "Vessel-ISR",
    submarine: "Submarine-SSN",
    ssbn: "Submarine-SSN",
    ssn: "Submarine-SSN",
    ssk: "Submarine-API",
    aip_submarine: "Submarine-API",
    naval: "Vessel-Frigate",
};

// ─── Ship icon canvases (cached) ──────────────────────────────────────────────
const __navalIconCache = new Map();
const __navalIconCodeCache = new Map();
function setLimitedMapCache(map, key, value, maxItems = NAVAL_ICON_CACHE_MAX_ITEMS) {
    if (!(map instanceof Map)) return value;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    const max = Math.max(16, Number(maxItems || NAVAL_ICON_CACHE_MAX_ITEMS));
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
    return value;
}
const NAVAL_SUBTYPE_META = {
    carrier: { label: "Carrier", color: "#ff3a3a", priority: 0 },
    amphibious: { label: "Amphibious", color: "#ff6a3d", priority: 1 },
    cruiser: { label: "Cruiser", color: "#ff9b40", priority: 2 },
    destroyer: { label: "Destroyer", color: "#ff7820", priority: 3 },
    frigate: { label: "Frigate", color: "#ffcc00", priority: 4 },
    corvette: { label: "Corvette", color: "#f29f05", priority: 5 },
    intelligence: { label: "Intelligence", color: "#8dd8ff", priority: 6 },
    ssbn: { label: "SSBN", color: "#8d63ff", priority: 7 },
    ssn: { label: "SSN", color: "#7b7cff", priority: 8 },
    ssk: { label: "SSK", color: "#60a4ff", priority: 9 },
    aip_submarine: { label: "AIP Sub", color: "#49b8ff", priority: 10 },
    submarine: { label: "Submarine", color: "#9b7bff", priority: 11 },
    missile_boat: { label: "Missile Boat", color: "#ff8d5a", priority: 12 },
    patrol: { label: "Patrol", color: "#33d9ff", priority: 13 },
    logistics: { label: "Logistics", color: "#57b8ff", priority: 14 },
    minesweeper: { label: "Minesweeper", color: "#00d9b2", priority: 15 },
    naval: { label: "Naval", color: "#33d9ff", priority: 16 },
};
const NAVAL_MODEL_HEADING_OFFSETS = Object.create(null);
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
    ["surveillance", "intelligence"],
    ["reconnaissance_ship", "intelligence"],
    ["tracking_ship", "intelligence"],
    ["special_mission", "intelligence"],
    ["sigint", "intelligence"],
    ["elint", "intelligence"],
    ["agi", "intelligence"],
    ["isr", "intelligence"],
    ["auxiliary", "logistics"],
    ["fleet_oiler", "logistics"],
    ["replenishment", "logistics"],
    ["support_ship", "logistics"],
    ["tanker", "logistics"],
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
    { subtype: "intelligence", pattern: /\b(intelligence|sigint|elint|agi|isr|tracking ship|telemetry|range instrumentation|reconnaissance ship|special mission|ocean surveillance|space tracking|missile tracking|yuan wang|vishnya|marshal krylov|howard o lorenzen)\b/i },
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
const LIVE_NAVAL_US_CARRIER_TOKENS = [
    "united states",
    "united states of america",
    "usa",
    "american",
    "us navy",
    "u s navy",
    "usn",
    "uss",
];
const LIVE_NAVAL_CN_CARRIER_TOKENS = [
    "china",
    "chinese",
    "prc",
    "pla navy",
    "plan",
    "people s liberation army navy",
];
const LIVE_NAVAL_UK_CARRIER_TOKENS = [
    "united kingdom",
    "uk",
    "british",
    "great britain",
    "royal navy",
    "hms",
];
const LIVE_NAVAL_FR_CARRIER_TOKENS = [
    "france",
    "french",
    "marine nationale",
    "fs",
];
const LIVE_NAVAL_RU_IN_CARRIER_TOKENS = [
    "russia",
    "russian",
    "russian navy",
    "rfs",
    "india",
    "indian",
    "indian navy",
    "ins",
];
const LIVE_NAVAL_COUNTRY_DEFAULTS = Object.freeze([
    { tokens: ["united states", "usa", "us navy", "usn", "uss", "american"], assetKey: "Carrier-US" },
    { tokens: ["united kingdom", "uk", "great britain", "british", "royal navy", "hms"], assetKey: "Carrier-HMS" },
    { tokens: ["france", "french", "marine nationale"], assetKey: "Carrier-France" },
    { tokens: ["italy", "italian", "spain", "spanish", "turkey", "turkish", "japan", "japanese", "south korea", "australia", "new zealand"], assetKey: "Carrier-LHD" },
    { tokens: ["india", "indian", "russia", "russian"], assetKey: "Carrier-Russian" },
    { tokens: ["china", "chinese", "prc", "pla navy", "plan", "people s liberation army navy"], assetKey: "Carrier-Fujian" },
    { tokens: ["iran", "syria", "iraq", "north korea", "dprk", "myanmar", "bangladesh", "sri lanka", "cambodia", "laos"], assetKey: "Boat" },
]);
const LIVE_NAVAL_FIXED_WING_CARRIER_PATTERNS = [
    /\bcvn ?\d+\b/i,
    /\bcv ?\d+\b/i,
    /\b(aircraft carrier|fleet carrier|supercarrier|catobar|stobar|stovl|ski jump)\b/i,
    /\b(nimitz|gerald r ford|ford class|liaoning|shandong|fujian|queen elizabeth|prince of wales|charles de gaulle|admiral kuznetsov|vikramaditya|vikrant)\b/i,
];
const LIVE_NAVAL_AMPHIBIOUS_CARRIER_PATTERNS = [
    /\b(lhd|lha|lph)\b/i,
    /\b(landing helicopter dock|amphibious assault|helicopter carrier|helicopter destroyer|drone carrier|sea based aviation|aviation deck)\b/i,
    /\b(type ?075|america class|wasp class|anadolu|juan carlos|trieste|mistral class|izumo class|hyuga class|dokdo class|canberra class|atlantico|giuseppe garibaldi|cavour)\b/i,
];
const LIVE_NAVAL_SUBMARINE_PATTERNS = [
    /\b(ssbn|ssn|ssgn|ssk|aip)\b/i,
    /\b(submarine|diesel electric|nuclear attack submarine|ballistic missile submarine|midget submarine|special mission submarine)\b/i,
    /\b(borei|yasen|akula|kilo|lada|virginia class|los angeles class|seawolf|ohio class|astute|vanguard|arihant|scorpene|suffren|triomphant|taigei|soryu|oyashio|dosan ahn changho|kss)\b/i,
];
const LIVE_NAVAL_REPLENISHMENT_PATTERNS = [
    /\b(fleet oiler|replenishment|underway replenishment|support tanker|naval tanker|auxiliary oiler|combat support ship|fast combat support|logistics support|fleet support|supply ship|auxiliary support)\b/i,
    /\b(aor|aoe|ao)\b/i,
    /\b(t ?ao|t ?ake)\b/i,
];
const LIVE_NAVAL_INTELLIGENCE_PATTERNS = [
    /\b(intelligence|sigint|elint|agi|isr|special mission|reconnaissance ship|tracking ship|telemetry|range instrumentation|missile tracking|space tracking|satellite tracking|ocean surveillance|electronic intelligence|hydroacoustic|sonar intelligence)\b/i,
    /\b(yuan wang|vishnya|marshal krylov|howard o lorenzen)\b/i,
];
const LIVE_NAVAL_LARGE_SURFACE_PATTERNS = [
    /\b(destroyer|cruiser|frigate|guided missile|major surface combatant|escort|arsenal ship|stealth destroyer)\b/i,
    /\b(type ?055|type ?052|type ?054|ticonderoga|arleigh burke|zumwalt|type ?45|type ?26|type ?23|slava|kirov|udaloy|sovremenny|gorshkov|grigorovich|kolkata|visakhapatnam|delhi|shivalik|talwar|horizon|fremm|la fayette|maya|atago|kongo|mogami|akizuki|sejong|kdx|barbaros|gabya|istanbul|alvaro de bazan|f ?110|hobart|hunter|anzac|niteroi|tamandare)\b/i,
];
const LIVE_NAVAL_SMALL_SURFACE_PATTERNS = [
    /\b(corvette|patrol|offshore patrol vessel|opv|missile boat|fast attack|minehunter|minesweeper|coastal|littoral|gunboat|small combatant|coast guard|cutter)\b/i,
    /\b(type ?056|steregushchiy|buyan|karakurt|kamorta|ada class|fac)\b/i,
];
const NAVAL_COUNTRY_ALIASES = new Map([
    ["us", "United States"],
    ["u s", "United States"],
    ["usa", "United States"],
    ["u s a", "United States"],
    ["united states of america", "United States"],
    ["uk", "United Kingdom"],
    ["u k", "United Kingdom"],
    ["great britain", "United Kingdom"],
    ["prc", "China"],
    ["people s republic of china", "China"],
    ["rok", "South Korea"],
    ["republic of korea", "South Korea"],
    ["uae", "United Arab Emirates"],
    ["u a e", "United Arab Emirates"],
]);
const LIVE_NAVAL_EXACT_ICON_RULES = [
    { assetKey: "Carrier-US", pattern: /\b(nimitz|gerald r ford|ford class|cvn[-\s]?\d+|cv[-\s]?(?:4[1-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9])|supercarrier|kitty hawk|uss gerald r ford|uss nimitz)\b/i },
    { assetKey: "Carrier-France", pattern: /\b(charles de gaulle|\bcdg\b|french carrier|porte[-\s]?avions)\b/i },
    { assetKey: "Carrier-Fujian", pattern: /\b(fujian|type[-\s]?003|type[-\s]?002|type[-\s]?001|cv[-\s]?1[678]|shandong|liaoning|chinese carrier|pla navy carrier)\b/i },
    { assetKey: "Carrier-HMS", pattern: /\b(queen elizabeth|hms queen elizabeth|prince of wales|royal navy carrier)\b/i },
    { assetKey: "Carrier-Russian", pattern: /\b(admiral kuznetsov|kuznetsov|russian carrier|vikramaditya|vikrant)\b/i },
    { assetKey: "Carrier-LHD", pattern: /\b(lhd|lha|amphibious|assault ship|wasp|america class|mistral|izumo|kaga|canberra|dokdo|juan carlos|trieste|type[-\s]?075|type[-\s]?076)\b/i },
    { assetKey: "Vessel-Zumwalt", pattern: /\b(zumwalt|ddg[-\s]?1000|stealth destroyer)\b/i },
    { assetKey: "Vessel-Frigate", pattern: /\b(frigate|destroyer|cruiser|corvette|ddg|ffg|cgn|type[-\s]?45|type[-\s]?055|arleigh burke|ticonderoga|horizon|fremm|talwar|shivalik|gorshkov)\b/i },
    { assetKey: "Vessel-ISR", pattern: /\b(spy ship|intelligence ship|surveillance ship|research vessel|survey vessel|tracking ship|isr vessel|electronic intelligence|elint ship|\bagi\b)\b/i },
    { assetKey: "Submarine-SSN", pattern: /\b(ssn|nuclear attack submarine|virginia class|astute class|yasen|seawolf|los angeles|akula|barracuda|suffren|ssbn|ballistic missile submarine|boomer|ohio class|borei|jin class|type[-\s]?094|vanguard|arihant|le triomphant)\b/i },
    { assetKey: "Submarine-API", pattern: /\b(ssk|\baip\b|diesel submarine|kilo|scorpene|type[-\s]?212|type[-\s]?214|gotland|dolphin|yuan class|type[-\s]?039)\b/i },
    { assetKey: "Boat", pattern: /\b(patrol boat|missile boat|fast attack craft|\bfac\b|cutter|coast guard|small boat|patrol)\b/i },
];

function normalizeText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function normalizeNavalAssetKey(value = "") {
    const direct = String(value || "").trim();
    if (!direct) return "";
    if (NAVAL_ASSET_FILES[direct]) return direct;
    const fromIconCode = NAVAL_ASSET_KEY_BY_ICON_CODE[direct.toLowerCase()];
    if (fromIconCode && NAVAL_ASSET_FILES[fromIconCode]) return fromIconCode;
    const normalized = normalizeNavalIconText(direct);
    return Object.keys(NAVAL_ASSET_FILES).find((assetKey) => (
        normalizeNavalIconText(assetKey) === normalized
    )) || "";
}
function getNavalAssetFile(assetKey = "") {
    const canonical = normalizeNavalAssetKey(assetKey) || NAVAL_MODEL_DEFAULT_ASSET_KEY;
    return NAVAL_ASSET_FILES[canonical] || NAVAL_ASSET_FILES[NAVAL_MODEL_DEFAULT_ASSET_KEY];
}
function isProbablyAircraftContact(data = {}) {
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const trackType = String(data.track_type || metadata.track_type || "").toLowerCase();
    if (trackType === "aircraft") return true;
    const sourceName = String(data.source_name || metadata.source_name || "").toLowerCase();
    if (
        sourceName.includes("ads-b") ||
        sourceName.includes("airplanes.live") ||
        sourceName.includes("aircraft")
    ) {
        return true;
    }
    const haystack = [
        data.vessel_name,
        data.title,
        data.subcategory,
        metadata.model_name,
        metadata.type_code,
        metadata.callsign,
        metadata.registration,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return /\bcessna\b|\bcitation\b|\blearjet\b|\bgulfstream\b|\bembraer\b|\bbombardier\b|\bboeing\b|\bairbus\b|\bhelicopter\b|\bfighter\b|\bawacs\b|\brecon\b|\btanker\b|\btransport\b|\buav\b|\bdrone\b/.test(haystack);
}
function hasNavalTelemetrySignature(data = {}) {
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const sourceName = String(data.source_name || metadata.source_name || "").toLowerCase();
    const trackKey = String(data.track_key || data.source_key || data.dedupe_key || "").toLowerCase();
    return Boolean(
        sourceName.includes("ais") ||
        trackKey.startsWith("ais-") ||
        data.mmsi ||
        metadata.mmsi ||
        metadata.ship_type != null ||
        metadata.shipType != null ||
        metadata.vessel_name ||
        metadata.vessel_class ||
        metadata.ship_class ||
        metadata.call_sign ||
        metadata.callSign
    );
}
function isKnownNonOperationalNavalContact(data = {}) {
    const metadata = parseEventMetadata(data?.metadata);
    const identityAndStatus = [
        data.vessel_name,
        data.platform_name,
        data.title,
        data.designation,
        data.hull_number,
        data.operational_status,
        data.operationalStatus,
        data.service_status,
        data.serviceStatus,
        data.status,
        metadata.vessel_name,
        metadata.designation,
        metadata.hull_number,
        metadata.operational_status,
        metadata.operationalStatus,
        metadata.service_status,
        metadata.serviceStatus,
        metadata.status,
    ]
        .filter(Boolean)
        .join(" ");
    return NAVAL_NON_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(identityAndStatus));
}
function purgeInvalidNavalContacts() {
    const staleCutoff = Date.now() - NAVAL_CONTACT_STALE_MS;
    const purgeKeys = [];
    for (const [trackKey, entry] of __navalState.vessels.entries()) {
        const data = entry?.data || {};
        const seenAt = Number(data.last_seen_at || entry?.entity?.__navalLastSeenAt || 0);
        const stale = Number.isFinite(seenAt) && seenAt > 0 && seenAt < staleCutoff;
        if (
            isProbablyAircraftContact(data) ||
            isKnownNonOperationalNavalContact(data) ||
            !hasNavalTelemetrySignature(data) ||
            stale
        ) {
            purgeKeys.push(trackKey);
        }
    }
    purgeKeys.forEach((trackKey) => clearNavalVessel(trackKey));
    const overflow = __navalState.vessels.size - NAVAL_CONTACT_MAX_ITEMS;
    if (overflow > 0) {
        const sorted = Array.from(__navalState.vessels.entries())
            .sort((a, b) => Number(b?.[1]?.data?.last_seen_at || 0) - Number(a?.[1]?.data?.last_seen_at || 0));
        for (let i = NAVAL_CONTACT_MAX_ITEMS; i < sorted.length; i += 1) {
            clearNavalVessel(sorted[i][0]);
        }
    }
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
function parseCoordinate(value) {
    if (value === null || value === undefined || value === "") return Number.NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function isValidCoordinatePair(lat, lon) {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    );
}
function isResolvedFallbackCoordinate(event = {}) {
    const source = String(event.display_source || "").toLowerCase();
    const precision = String(event.display_precision || "").toLowerCase();
    if (/country|capital|city|subdivision|fallback/.test(source)) return true;
    return precision === "country" || precision === "capital" || precision === "city";
}
function pickFirstFiniteCoordinate(values = []) {
    for (const value of values) {
        const parsed = parseCoordinate(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Number.NaN;
}
function resolveNavalTelemetryCoordinates(event = {}, metadata = {}) {
    const lat = pickFirstFiniteCoordinate([
        event.source_lat,
        event.raw_lat,
        event.latitude,
        metadata.lat,
        metadata.latitude,
        metadata.position_lat,
        metadata.position?.lat,
    ]);
    const lon = pickFirstFiniteCoordinate([
        event.source_lon,
        event.raw_lon,
        event.longitude,
        metadata.lon,
        metadata.longitude,
        metadata.position_lon,
        metadata.position?.lon,
        metadata.position?.lng,
    ]);
    if (isValidCoordinatePair(lat, lon)) {
        return { lat, lon, hasRawTelemetry: true };
    }
    const fallbackLat = parseCoordinate(event.lat);
    const fallbackLon = parseCoordinate(event.lon);
    if (!isResolvedFallbackCoordinate(event) && isValidCoordinatePair(fallbackLat, fallbackLon)) {
        return { lat: fallbackLat, lon: fallbackLon, hasRawTelemetry: false };
    }
    return { lat: Number.NaN, lon: Number.NaN, hasRawTelemetry: false };
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
    const cleanCountry = normalizeCountryName(normalizeAffiliationText(country));
    if (cleanOperator && cleanCountry) {
        return { operator: cleanOperator, country: cleanCountry };
    }
    const inferred = inferNavalOperatorFromText(hintText);
    const inferredCountry = normalizeCountryName(inferred.country || "");
    return {
        operator: cleanOperator || inferred.operator || "",
        country: cleanCountry || inferredCountry || "",
    };
}
function getNestedFieldValue(source = {}, keyPath = "") {
    if (!source || typeof source !== "object") return undefined;
    const path = String(keyPath || "").trim();
    if (!path) return undefined;
    const parts = path.split(".");
    let cursor = source;
    for (const part of parts) {
        if (!cursor || typeof cursor !== "object") return undefined;
        cursor = cursor[part];
    }
    return cursor;
}
function pickFirstNavalValue(sources = [], keys = []) {
    for (const key of keys) {
        for (const source of sources) {
            const value = getNestedFieldValue(source, key);
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return value;
            }
        }
    }
    return "";
}
function pickFirstNavalText(sources = [], keys = []) {
    return normalizeText(pickFirstNavalValue(sources, keys));
}
function pickFirstNavalNumber(sources = [], keys = [], fallback = Number.NaN) {
    const raw = pickFirstNavalValue(sources, keys);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeCountryName(value = "") {
    const clean = normalizeAffiliationText(value);
    if (!clean) return "";
    const alias = NAVAL_COUNTRY_ALIASES.get(normalizeNavalIconText(clean));
    return alias || clean;
}
function resolveNavalLastSeenAt(event = {}, metadata = {}) {
    const candidates = [
        event.last_seen_at,
        event.updated_at,
        event.occurred_at,
        metadata.last_seen_at,
        metadata.updated_at,
        metadata.occurred_at,
        metadata.timestamp,
        metadata.time,
    ];
    for (const candidate of candidates) {
        const ms = Date.parse(candidate);
        if (Number.isFinite(ms) && ms > 0) {
            return ms;
        }
    }
    return Date.now();
}
function resolveNavalDisplayDetails(event = {}, metadata = {}, resolvedSubtype = "naval", hintText = "") {
    const objectSources = [
        event,
        metadata,
        metadata.vessel,
        metadata.ship,
        metadata.platform,
        metadata.details,
    ].filter((item) => item && typeof item === "object");
    const vesselName = pickFirstNavalText(objectSources, [
        "vessel_name",
        "vesselName",
        "platform_name",
        "platformName",
        "ship_name",
        "shipName",
        "name",
        "display_name",
        "displayName",
        "title",
    ]);
    const className = pickFirstNavalText(objectSources, [
        "class_name",
        "className",
        "vessel_class",
        "vesselClass",
        "ship_class",
        "shipClass",
        "class",
    ]);
    const subclassName = pickFirstNavalText(objectSources, [
        "subclass",
        "sub_class",
        "subClass",
    ]);
    const variantName = pickFirstNavalText(objectSources, [
        "variant",
        "variant_name",
        "variantName",
        "block",
        "mod",
    ]);
    const versionName = pickFirstNavalText(objectSources, [
        "version",
        "version_name",
        "versionName",
        "mark",
        "mk",
    ]);
    const designation = pickFirstNavalText(objectSources, [
        "designation",
        "hull_number",
        "hullNumber",
        "pennant_number",
        "pennantNumber",
        "hull",
        "pennant",
    ]);
    const typeHintRaw = pickFirstNavalText(objectSources, [
        "type_label",
        "typeLabel",
        "vessel_type",
        "vesselType",
        "ship_type_name",
        "shipTypeName",
        "ship_type",
        "shipType",
        "vessel_category",
        "vesselCategory",
        "category",
        "type",
        "role",
    ]);
    const subtypeSeed = typeHintRaw || subclassName || className || resolvedSubtype;
    const nextSubtype = resolveNavalSubtype(
        subtypeSeed,
        `${hintText} ${typeHintRaw} ${className} ${subclassName} ${variantName} ${versionName}`
    );
    const typeLabel = typeHintRaw || getNavalSubtypeLabel(nextSubtype);
    return {
        subtype: nextSubtype,
        type_label: normalizeText(typeLabel) || getNavalSubtypeLabel(nextSubtype),
        class_name: normalizeText(className),
        subclass_name: normalizeText(subclassName),
        variant_name: normalizeText(variantName),
        version_name: normalizeText(versionName),
        designation: normalizeText(designation),
        platform_name: normalizeText(vesselName),
    };
}
function buildVesselHintText(event = {}, metadata = {}) {
    return [
        event.title,
        event.summary,
        event.subcategory,
        event.type,
        event.category,
        event.class,
        event.subclass,
        event.variant,
        event.version,
        event.designation,
        event.operator,
        event.country,
        event.weapon_type,
        metadata.vessel_name,
        metadata.platform_name,
        metadata.name,
        metadata.type,
        metadata.category,
        metadata.class_name,
        metadata.className,
        metadata.vessel_class,
        metadata.ship_class,
        metadata.subclass,
        metadata.variant,
        metadata.version,
        metadata.designation,
        metadata.ship_type_name,
        metadata.shipTypeName,
        metadata.vessel_type,
        metadata.vesselType,
        metadata.vessel_category,
        metadata.vesselCategory,
        metadata.operator,
        metadata.country,
        metadata.flag_country,
        metadata.flagCountry,
        metadata.hull_number,
        metadata.hullNumber,
        metadata.pennant_number,
        metadata.pennantNumber,
        metadata.call_sign,
        metadata.callSign,
    ]
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .join(" ");
}
function normalizeNavalIconText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function hasAnyNavalToken(paddedHaystack = " ", tokens = []) {
    return tokens.some((token) => token && paddedHaystack.includes(` ${token} `));
}
function hasAnyNavalPattern(haystack = "", patterns = []) {
    return patterns.some((pattern) => pattern.test(haystack));
}
function getNavalMetadata(vessel = {}) {
    return vessel?.metadata && typeof vessel.metadata === "object" ? vessel.metadata : {};
}
function buildLiveNavalIconSignature(vessel = {}) {
    const metadata = getNavalMetadata(vessel);
    return [
        vessel.subcategory,
        vessel.type_label,
        vessel.class_name,
        vessel.subclass_name,
        vessel.variant_name,
        vessel.version_name,
        vessel.designation,
        vessel.vessel_class,
        vessel.vessel_name,
        vessel.platform_name,
        vessel.title,
        vessel.operator,
        vessel.country,
        vessel.mmsi,
        metadata.subtype,
        metadata.subcategory,
        metadata.vessel_class,
        metadata.ship_class,
        metadata.ship_type_name,
        metadata.shipTypeName,
        metadata.vessel_type,
        metadata.vesselType,
        metadata.vessel_category,
        metadata.vesselCategory,
        metadata.ship_type,
        metadata.shipType,
        metadata.ais_ship_type,
        metadata.aisShipType,
        metadata.type,
        metadata.operator,
        metadata.navy,
        metadata.service_branch,
        metadata.serviceBranch,
        metadata.branch,
        metadata.country,
        metadata.flag_country,
        metadata.flagCountry,
        metadata.callsign,
        metadata.call_sign,
        metadata.callSign,
        metadata.hull_number,
        metadata.hullNumber,
        metadata.pennant_number,
        metadata.pennantNumber,
        metadata.deck_type,
        metadata.deckType,
        metadata.class_name,
        metadata.className,
        metadata.subclass,
        metadata.variant,
        metadata.version,
        metadata.designation,
        metadata.name,
        metadata.vessel_name,
    ]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|");
}
function buildLiveNavalIconContext(vessel = {}) {
    const metadata = getNavalMetadata(vessel);
    const subtype = normalizeNavalSubtypeKey(
        vessel.subcategory ||
        vessel.type_label ||
        vessel.class_name ||
        vessel.subclass_name ||
        metadata.subcategory ||
        metadata.subtype ||
        metadata.vessel_class ||
        metadata.ship_class ||
        metadata.ship_type_name ||
        metadata.shipTypeName ||
        metadata.vessel_type ||
        metadata.vesselType ||
        metadata.vessel_category ||
        metadata.vesselCategory ||
        metadata.type ||
        ""
    ) || "naval";
    const values = [
        subtype,
        vessel.type_label,
        vessel.class_name,
        vessel.subclass_name,
        vessel.variant_name,
        vessel.version_name,
        vessel.designation,
        vessel.vessel_class,
        vessel.vessel_name,
        vessel.platform_name,
        vessel.title,
        vessel.operator,
        vessel.country,
        vessel.mmsi,
        metadata.vessel_class,
        metadata.ship_class,
        metadata.ship_type_name,
        metadata.shipTypeName,
        metadata.vessel_type,
        metadata.vesselType,
        metadata.vessel_category,
        metadata.vesselCategory,
        metadata.ship_type,
        metadata.shipType,
        metadata.ais_ship_type,
        metadata.aisShipType,
        metadata.type,
        metadata.operator,
        metadata.navy,
        metadata.service_branch,
        metadata.serviceBranch,
        metadata.branch,
        metadata.country,
        metadata.flag_country,
        metadata.flagCountry,
        metadata.callsign,
        metadata.call_sign,
        metadata.callSign,
        metadata.hull_number,
        metadata.hullNumber,
        metadata.pennant_number,
        metadata.pennantNumber,
        metadata.deck_type,
        metadata.deckType,
        metadata.class_name,
        metadata.className,
        metadata.subclass,
        metadata.variant,
        metadata.version,
        metadata.designation,
        metadata.name,
        metadata.vessel_name,
    ]
        .map(normalizeNavalIconText)
        .filter(Boolean);
    const haystack = values.join(" ").trim();
    const paddedHaystack = haystack ? ` ${haystack} ` : " ";
    const affiliation = [
        vessel.country,
        vessel.operator,
        metadata.country,
        metadata.operator,
        metadata.navy,
        metadata.service_branch,
        metadata.serviceBranch,
        metadata.branch,
        metadata.flag_country,
        metadata.flagCountry,
    ]
        .map(normalizeNavalIconText)
        .filter(Boolean)
        .join(" ")
        .trim();
    const paddedAffiliation = affiliation ? ` ${affiliation} ` : " ";
    return {
        subtype,
        haystack,
        paddedHaystack,
        paddedAffiliation,
    };
}
function hasNavalTokens(context = {}, tokens = []) {
    return (
        hasAnyNavalToken(context.paddedAffiliation || " ", tokens) ||
        hasAnyNavalToken(context.paddedHaystack || " ", tokens)
    );
}
function isUsCarrierAffiliation(context = {}) {
    return hasNavalTokens(context, LIVE_NAVAL_US_CARRIER_TOKENS);
}
function isChinaCarrierAffiliation(context = {}) {
    return hasNavalTokens(context, LIVE_NAVAL_CN_CARRIER_TOKENS);
}
function isUkCarrierAffiliation(context = {}) {
    return hasNavalTokens(context, LIVE_NAVAL_UK_CARRIER_TOKENS);
}
function isFranceCarrierAffiliation(context = {}) {
    return hasNavalTokens(context, LIVE_NAVAL_FR_CARRIER_TOKENS);
}
function isRussianIndianCarrierAffiliation(context = {}) {
    return hasNavalTokens(context, LIVE_NAVAL_RU_IN_CARRIER_TOKENS);
}
function resolveFixedWingCarrierIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    // Carrier bucket split: exact class/name, operator/country, then a conservative US fallback for generic CV/CVN contacts.
    if (/\b(nimitz|gerald r ford|ford class|cvn ?7[0-9]|cvn ?8[0-9]|cv ?(?:4[1-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]))\b/i.test(haystack) || isUsCarrierAffiliation(context)) {
        return "Carrier-US";
    }
    if (/\b(liaoning|shandong|fujian|type ?001|type ?002|type ?003|cv ?1[678])\b/i.test(haystack) || isChinaCarrierAffiliation(context)) {
        return "Carrier-Fujian";
    }
    if (/\b(queen elizabeth|prince of wales)\b/i.test(haystack) || isUkCarrierAffiliation(context)) {
        return "Carrier-HMS";
    }
    if (/\bcharles de gaulle|\bcdg\b|french carrier|porte[-\s]?avions\b/i.test(haystack) || isFranceCarrierAffiliation(context)) return "Carrier-France";
    if (/\b(admiral kuznetsov|kuznetsov|vikramaditya|vikrant)\b/i.test(haystack) || isRussianIndianCarrierAffiliation(context)) return "Carrier-Russian";
    return "Carrier-US";
}
function resolveExactNavalIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (!haystack) return "";
    const matched = LIVE_NAVAL_EXACT_ICON_RULES.find((rule) => rule.pattern.test(haystack));
    return matched ? matched.assetKey : "";
}
function resolveNavalCountryDefaultAssetKey(context = {}) {
    const match = LIVE_NAVAL_COUNTRY_DEFAULTS.find((entry) => hasNavalTokens(context, entry.tokens));
    return match?.assetKey || "";
}
function resolveNavalAssetKey(vessel = {}) {
    const metadata = getNavalMetadata(vessel);
    const explicitCode = normalizeText(
        vessel.asset_key ||
        metadata.asset_key ||
        vessel.model_code ||
        metadata.model_code ||
        metadata.modelCode ||
        ""
    );
    const explicitAssetKey = normalizeNavalAssetKey(explicitCode);
    if (explicitAssetKey) return explicitAssetKey;

    const context = buildLiveNavalIconContext(vessel);
    const exactAssetKey = normalizeNavalAssetKey(resolveExactNavalIconCode(context));
    if (exactAssetKey) return exactAssetKey;

    const subtype = String(context.subtype || "").trim().toLowerCase();
    const haystack = String(context.haystack || "");
    if (
        subtype === "carrier" ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_FIXED_WING_CARRIER_PATTERNS)
    ) {
        return normalizeNavalAssetKey(resolveFixedWingCarrierIconCode(context)) || "Carrier-Russian";
    }
    if (
        subtype === "amphibious" ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_AMPHIBIOUS_CARRIER_PATTERNS)
    ) {
        return "Carrier-LHD";
    }
    if (
        ["submarine", "ssbn", "ssn"].includes(subtype) ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_SUBMARINE_PATTERNS)
    ) {
        return "Submarine-SSN";
    }
    if (["ssk", "aip_submarine"].includes(subtype)) return "Submarine-API";
    if (
        subtype === "intelligence" ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_INTELLIGENCE_PATTERNS)
    ) {
        return "Vessel-ISR";
    }
    if (
        ["cruiser", "destroyer", "frigate", "corvette", "logistics"].includes(subtype) ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_LARGE_SURFACE_PATTERNS) ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_REPLENISHMENT_PATTERNS)
    ) {
        return "Vessel-Frigate";
    }
    if (
        ["missile_boat", "patrol", "minesweeper"].includes(subtype) ||
        hasAnyNavalPattern(haystack, LIVE_NAVAL_SMALL_SURFACE_PATTERNS)
    ) {
        return "Boat";
    }

    return (
        normalizeNavalAssetKey(resolveNavalCountryDefaultAssetKey(context)) ||
        NAVAL_ASSET_KEY_BY_SUBTYPE[subtype] ||
        NAVAL_MODEL_DEFAULT_ASSET_KEY
    );
}
function resolveLiveNavalIconCode(vessel = {}) {
    const trackCacheKey = String(vessel.track_key || "").trim();
    const iconSignature = trackCacheKey
        ? buildLiveNavalIconSignature(vessel)
        : "";
    if (trackCacheKey && iconSignature) {
        const cached = __navalIconCodeCache.get(trackCacheKey);
        if (cached && cached.signature === iconSignature && LIVE_NAVAL_ICON_CODES.has(cached.iconCode)) {
            return cached.iconCode;
        }
    }
    const iconCode = resolveNavalAssetKey(vessel);
    const resolvedIconCode = normalizeNavalAssetKey(iconCode)
        ? normalizeNavalAssetKey(iconCode)
        : LIVE_NAVAL_ICON_DEFAULT_CODE;
    if (trackCacheKey && iconSignature) {
        __navalIconCodeCache.set(trackCacheKey, {
            signature: iconSignature,
            iconCode: resolvedIconCode,
        });
    }
    return resolvedIconCode;
}
function getLiveNavalIconPath(iconCode = LIVE_NAVAL_ICON_DEFAULT_CODE) {
    const asset = getNavalAssetFile(iconCode);
    return `${LIVE_NAVAL_ICON_BASE_PATH}/${asset.icon}`;
}
function getVesselColor(subcat = "naval") {
    const key = normalizeNavalSubtypeKey(subcat);
    const meta = NAVAL_SUBTYPE_META[key] || NAVAL_SUBTYPE_META.naval;
    return meta.color;
}

function createNavalPngIcon(color = "#33d9ff", subcat = "naval") {
    const subtype = normalizeNavalSubtypeKey(subcat) || "naval";
    const iconColor = getCssColor("--warzone-live-naval-icon-color", color || getVesselColor(subtype));
    const cacheKey = `png|${subtype}|${iconColor}`;
    if (__navalIconCache.has(cacheKey)) return __navalIconCache.get(cacheKey);

    const size = NAVAL_BILLBOARD_CANVAS_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);

    const bodyColor = Cesium.Color.fromCssColorString(iconColor).withAlpha(0.96);
    const bodyCss = `rgba(${Math.round(bodyColor.red * 255)}, ${Math.round(bodyColor.green * 255)}, ${Math.round(bodyColor.blue * 255)}, ${bodyColor.alpha})`;
    const outlineCss = "rgba(10, 18, 26, 0.92)";

    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.14);
    ctx.lineTo(size * 0.76, size * 0.42);
    ctx.lineTo(size * 0.66, size * 0.88);
    ctx.lineTo(size * 0.34, size * 0.88);
    ctx.lineTo(size * 0.24, size * 0.42);
    ctx.closePath();
    ctx.fillStyle = bodyCss;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = outlineCss;
    ctx.stroke();

    const mastColor = Cesium.Color.fromCssColorString(iconColor).withAlpha(0.86);
    ctx.strokeStyle = `rgba(${Math.round(mastColor.red * 255)}, ${Math.round(mastColor.green * 255)}, ${Math.round(mastColor.blue * 255)}, ${mastColor.alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.18);
    ctx.lineTo(size * 0.5, size * 0.02);
    ctx.stroke();

    const dataUrl = canvas.toDataURL("image/png");
    setLimitedMapCache(__navalIconCache, cacheKey, dataUrl);
    return dataUrl;
}
function createNavalCharIcon(color = "#33d9ff", subcat = "naval") {
    const subtype = normalizeNavalSubtypeKey(subcat) || "naval";
    const glyphChar = getCssText("--warzone-live-naval-icon-char", "◊")
        .replace(/^['"]|['"]$/g, "")
        .trim() || "◊";
    const iconColor = getCssColor("--warzone-live-naval-icon-color", color || getVesselColor(subtype));
    const glyphFontPx = clamp(getCssNumber("--warzone-live-naval-icon-font-size", 58), 24, 120);
    const cacheKey = `char|${subtype}|${glyphChar}|${iconColor}|${glyphFontPx}`;
    if (__navalIconCache.has(cacheKey)) return __navalIconCache.get(cacheKey);

    const size = NAVAL_BILLBOARD_CANVAS_SIZE;
    const half = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    ctx.font = `900 ${glyphFontPx}px 'Barlow Condensed', 'Rajdhani', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillStyle = iconColor;
    ctx.fillText(glyphChar, half, half + 1);

    const dataUrl = canvas.toDataURL("image/png");
    setLimitedMapCache(__navalIconCache, cacheKey, dataUrl);
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
function getCssText(varName, fallback = "") {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}
function isAircraftFocusLockActive() {
    const selection = getLiveTrackSelection?.();
    return Boolean(selection?.track_key && selection?.mode === "focus");
}
function getLiveGlbModelQualityConfig() {
    const environment = clamp(
        getCssNumber("--warzone-live-glb-environment-intensity", 0.7),
        0,
        1
    );
    const ambient = clamp(
        getCssNumber("--warzone-live-glb-ambient-light-intensity", 0.85),
        0,
        1
    );
    const directional = clamp(getCssNumber("--warzone-live-glb-directional-light-intensity", 2.2), 0, 4);
    const shadowEnabled = getCssNumber("--warzone-live-glb-shadow-enabled", 0) >= 0.5;
    return {
        imageBasedLightingFactor: new Cesium.Cartesian2(environment, ambient),
        lightColor: new Cesium.Color(directional, directional, directional, 1),
        maximumScreenSpaceError: clamp(getCssNumber("--warzone-live-glb-lod-distance", 1), 0, 64),
        shadows: shadowEnabled ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED,
    };
}
function getLiveGlbMaterialShader() {
    if (typeof Cesium.CustomShader !== "function" || !Cesium.UniformType?.FLOAT) return undefined;
    const roughness = clamp(getCssNumber("--warzone-live-glb-material-roughness", 0.5), 0, 1);
    const metalness = clamp(getCssNumber("--warzone-live-glb-material-metalness", 0.2), 0, 1);
    const anisotropy = clamp(getCssNumber("--warzone-live-glb-texture-anisotropy", 8), 1, 16);
    try {
        if (!__navalGlbMaterialShader) {
            __navalGlbMaterialShader = new Cesium.CustomShader({
                lightingModel: Cesium.LightingModel?.PBR,
                uniforms: {
                    u_wzRoughness: { type: Cesium.UniformType.FLOAT, value: roughness },
                    u_wzMetalness: { type: Cesium.UniformType.FLOAT, value: metalness },
                    u_wzAnisotropy: { type: Cesium.UniformType.FLOAT, value: anisotropy },
                },
                fragmentShaderText: `
                    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
                        material.roughness = clamp(u_wzRoughness, 0.0, 1.0);
                        material.specular = mix(material.specular, material.baseColor.rgb, clamp(u_wzMetalness, 0.0, 1.0));
                        #ifdef USE_ANISOTROPY
                        material.anisotropyStrength = clamp(u_wzAnisotropy / 16.0, 0.0, 1.0);
                        #endif
                    }
                `,
            });
        } else {
            __navalGlbMaterialShader.setUniform("u_wzRoughness", roughness);
            __navalGlbMaterialShader.setUniform("u_wzMetalness", metalness);
            __navalGlbMaterialShader.setUniform("u_wzAnisotropy", anisotropy);
        }
        return __navalGlbMaterialShader;
    } catch {
        return undefined;
    }
}
function applyLiveGlbModelQuality(model) {
    if (!model) return;
    const quality = getLiveGlbModelQualityConfig();
    model.imageBasedLightingFactor = quality.imageBasedLightingFactor;
    model.lightColor = quality.lightColor;
    model.maximumScreenSpaceError = quality.maximumScreenSpaceError;
    model.shadows = quality.shadows;
    model.customShader = getLiveGlbMaterialShader();
}
function getViewerCameraHeightMeters() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height ?? Number.NaN);
    return Number.isFinite(height) ? height : Number.NaN;
}
function getNavalPngScaleByZoomBand() {
    const baseScale = getCssNumber("--warzone-live-naval-png-scale", 0.05);
    const zoomInScale = getCssNumber("--warzone-live-naval-png-scale-zoom-in", baseScale);
    const zoomOutScale = getCssNumber("--warzone-live-naval-png-scale-zoom-out", baseScale);
    // Single split height for PNG zoom bands: <= split uses zoom-in scale, > split uses zoom-out scale.
    const zoomSplitHeight = Math.max(
        0,
        getCssNumber("--warzone-live-naval-png-zoom-split-height", 20000)
    );
    const cameraHeight = getViewerCameraHeightMeters();
    if (Number.isFinite(cameraHeight) && cameraHeight <= zoomSplitHeight) {
        return zoomInScale;
    }
    return zoomOutScale;
}
function getNavalBillboardScale(mode = NAVAL_RENDER_MODE.PNG) {
    if (mode === NAVAL_RENDER_MODE.CHAR) {
        return clamp(getCssNumber("--warzone-live-naval-char-scale", 0.95), 0.14, 2.8);
    }
    // Allow smaller PNG naval icons so CSS can dial them down to compact HUD size.
    return clamp(getNavalPngScaleByZoomBand(), 0.01, 2.8);
}
function resolveNavalModelUri(vessel = {}) {
    const asset = getNavalAssetFile(resolveNavalAssetKey(vessel));
    return asset?.model ? `${NAVAL_MODEL_BASE_PATH}/${asset.model}` : "";
}
function getNavalModelScale(vessel = {}) {
    return clamp(getCssNumber("--warzone-live-naval-model-scale", 35), 1, 4000);
}
function getNavalModelMinPixelSize(vessel = {}) {
    return clamp(getCssNumber("--warzone-live-naval-model-min-pixel-size", 64), 0, 600);
}
function getNavalModelMaxScale(vessel = {}) {
    return Math.max(
        getCssNumber("--warzone-live-naval-model-max-scale", 160),
        getNavalModelScale(vessel)
    );
}
function getNavalModelHeadingOffsetDeg(vessel = {}) {
    const subtype = normalizeNavalSubtypeKey(vessel.subcategory || "naval") || "naval";
    const direct = Number(NAVAL_MODEL_HEADING_OFFSETS[subtype]);
    if (Number.isFinite(direct)) return direct;
    const cssDefault = getCssNumber("--warzone-live-naval-model-heading-offset-default", Number.NaN);
    if (Number.isFinite(cssDefault)) return cssDefault;
    const generic = Number(NAVAL_MODEL_HEADING_OFFSETS.naval);
    return Number.isFinite(generic) ? generic : 0;
}
export function setNavalModelHeadingOffset(subtype = "", headingOffsetDeg = 0) {
    const key = normalizeNavalSubtypeKey(subtype || "naval") || "naval";
    const next = Number(headingOffsetDeg);
    if (!Number.isFinite(next)) return;
    NAVAL_MODEL_HEADING_OFFSETS[key] = next;
    __navalState.vessels.forEach((entry) => {
        const entity = entry?.entity;
        const vessel = entry?.data;
        if (!entity || !vessel || !entity.model) return;
        entity.orientation = buildNavalOrientation(vessel.lon, vessel.lat, vessel.heading_deg, vessel);
    });
    requestNavalRenderBatched();
}
export function setNavalModelHeadingOffsets(offsetMap = {}) {
    if (!offsetMap || typeof offsetMap !== "object") return;
    Object.entries(offsetMap).forEach(([subtype, value]) => {
        setNavalModelHeadingOffset(subtype, value);
    });
}
function shouldUseNavalBillboards() {
    return true;
}
function getNavalVisualPolicy() {
    const config = window.__stratopsConfig?.navalVisualPolicy;
    return config && typeof config === "object" ? config : {};
}
function normalizeNavalRenderMode(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "glb" || normalized === "gltf" || normalized === "model") return NAVAL_RENDER_MODE.MODEL;
    if (normalized === "char" || normalized === "glyph") return NAVAL_RENDER_MODE.CHAR;
    if (normalized === "png" || normalized === "img" || normalized === "image") return NAVAL_RENDER_MODE.PNG;
    return "";
}
function getNavalTrackWorldPosition(vessel = {}) {
    const lon = Number(vessel.lon);
    const lat = Number(vessel.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return Cesium.Cartesian3.fromDegrees(lon, lat, 0);
}
function getNavalTrackCameraDistanceMeters(vessel = {}) {
    const cameraPosition = window.__warzoneViewer?.camera?.positionWC;
    const vesselPosition = getNavalTrackWorldPosition(vessel);
    if (!cameraPosition || !vesselPosition) return Number.POSITIVE_INFINITY;
    return Cesium.Cartesian3.distance(cameraPosition, vesselPosition);
}
function getNavalAutoModelRadiusMeters() {
    return Math.max(0, getCssNumber("--warzone-live-naval-model-auto-radius", 280000));
}
function getNavalModelPriorityRank(vessel = {}, radiusMeters = 0) {
    const thisTrackKey = String(vessel.track_key || "");
    const thisDistance = getNavalTrackCameraDistanceMeters(vessel);
    if (!Number.isFinite(thisDistance)) return Number.POSITIVE_INFINITY;
    let closerCount = 0;
    __navalState.vessels.forEach((entry) => {
        const otherVessel = entry?.data;
        if (!otherVessel) return;
        if (String(otherVessel.track_key || "") === thisTrackKey) return;
        const otherDistance = getNavalTrackCameraDistanceMeters(otherVessel);
        if (!Number.isFinite(otherDistance)) return;
        if (radiusMeters > 0 && otherDistance > radiusMeters) return;
        if (otherDistance < thisDistance) {
            closerCount += 1;
        }
    });
    return closerCount;
}
function isNavalAutoModelEnabled() {
    const cssValue = getCssNumber("--warzone-live-naval-model-auto-enabled", Number.NaN);
    if (Number.isFinite(cssValue)) return cssValue >= 0.5;
    const policy = getNavalVisualPolicy();
    if (policy.zoomModel === false || policy.autoModel === false || policy.enableAutoModel === false) return false;
    return policy.zoomModel === true || policy.autoModel === true || policy.enableAutoModel === true;
}
function shouldAutoUseNavalModel(vessel = {}) {
    if (!isNavalAutoModelEnabled()) return false;
    const cameraHeight = getViewerCameraHeightMeters();
    const policy = getNavalVisualPolicy();
    const maxZoomHeight = Math.max(
        0,
        getCssNumber(
            "--warzone-live-naval-model-max-zoom-height",
            Number(policy.modelMaxZoomHeight ?? policy.modelZoomHeight ?? NAVAL_MODEL_DEFAULT_ZOOM_HEIGHT)
        )
    );
    if (!Number.isFinite(cameraHeight) || cameraHeight > maxZoomHeight) return false;
    const radiusMeters = getNavalAutoModelRadiusMeters();
    const distanceMeters = getNavalTrackCameraDistanceMeters(vessel);
    if (!Number.isFinite(distanceMeters) || (radiusMeters > 0 && distanceMeters > radiusMeters)) return false;
    const maxActive = Math.max(1, Math.floor(getCssNumber("--warzone-live-naval-model-max-active", NAVAL_MODEL_DEFAULT_MAX_ACTIVE)));
    return getNavalModelPriorityRank(vessel, radiusMeters) < maxActive;
}
function resolveNavalRenderMode(vessel = {}) {
    const focusedMode = normalizeNavalRenderMode(getCssText("--warzone-live-naval-render-mode-focused", "glb"));
    const defaultMode = normalizeNavalRenderMode(getCssText("--warzone-live-naval-render-mode-default", "png")) || NAVAL_RENDER_MODE.PNG;
    if (__navalState.selectedKey && String(__navalState.selectedKey) === String(vessel.track_key || "")) {
        return focusedMode || defaultMode;
    }
    if (shouldAutoUseNavalModel(vessel)) {
        return NAVAL_RENDER_MODE.MODEL;
    }
    return defaultMode;
}
function resolveNavalBillboardImage(vessel = {}, mode = NAVAL_RENDER_MODE.PNG) {
    const color = getVesselColor(vessel.subcategory || "naval");
    if (mode === NAVAL_RENDER_MODE.CHAR) {
        return createNavalCharIcon(color, vessel.subcategory || "naval");
    }
    const iconCode = resolveLiveNavalIconCode(vessel);
    const cacheKey = `png|asset|${iconCode}`;
    if (__navalIconCache.has(cacheKey)) {
        return __navalIconCache.get(cacheKey);
    }
    const iconPath = getLiveNavalIconPath(iconCode);
    setLimitedMapCache(__navalIconCache, cacheKey, iconPath);
    return iconPath;
}
function buildNavalOrientation(lon, lat, headingDeg = 0, vessel = {}) {
    const headingOffsetDeg = getNavalModelHeadingOffsetDeg(vessel);
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), 0),
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(Number(headingDeg || 0) + headingOffsetDeg),
            0,
            0
        )
    );
}
function buildNavalBillboardVisual(vessel = {}, mode = NAVAL_RENDER_MODE.PNG) {
    const image = resolveNavalBillboardImage(vessel, mode);
    if (!image) return null;
    return {
        image,
        scale: getNavalBillboardScale(mode),
        rotation: Cesium.Math.toRadians(-(Number(vessel.heading_deg || 0))),
        alignedAxis: Cesium.Cartesian3.ZERO,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: getCssNumber("--warzone-live-naval-depth-test-disable-distance", 0),
    };
}
function applyNavalModelVisual(entity, vessel = {}) {
    const modelUri = resolveNavalModelUri(vessel);
    const modelQuality = getLiveGlbModelQualityConfig();
    if (!entity.model) {
        entity.model = {
            uri: modelUri,
            scale: getNavalModelScale(vessel),
            minimumPixelSize: getNavalModelMinPixelSize(vessel),
            maximumScale: getNavalModelMaxScale(vessel),
            color: undefined,
            colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
            colorBlendAmount: 0,
            imageBasedLightingFactor: modelQuality.imageBasedLightingFactor,
            lightColor: modelQuality.lightColor,
            maximumScreenSpaceError: modelQuality.maximumScreenSpaceError,
            shadows: modelQuality.shadows,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            runAnimations: false,
            clampAnimations: false,
        };
    } else {
        entity.model.uri = modelUri;
        entity.model.scale = getNavalModelScale(vessel);
        entity.model.minimumPixelSize = getNavalModelMinPixelSize(vessel);
        entity.model.maximumScale = getNavalModelMaxScale(vessel);
        entity.model.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    }
    applyLiveGlbModelQuality(entity.model);
    entity.model.runAnimations = false;
    entity.model.clampAnimations = false;
    entity.billboard = undefined;
    entity.orientation = buildNavalOrientation(vessel.lon, vessel.lat, vessel.heading_deg, vessel);
}
function applyNavalBillboardVisual(entity, vessel = {}, mode = NAVAL_RENDER_MODE.PNG) {
    const visual = buildNavalBillboardVisual(vessel, mode);
    if (!visual) return false;
    if (!entity.billboard) {
        entity.billboard = { ...visual };
    } else {
        entity.billboard.image = visual.image;
        entity.billboard.scale = visual.scale;
        entity.billboard.rotation = visual.rotation;
        entity.billboard.alignedAxis = visual.alignedAxis;
        entity.billboard.verticalOrigin = visual.verticalOrigin;
        entity.billboard.horizontalOrigin = visual.horizontalOrigin;
        entity.billboard.disableDepthTestDistance = visual.disableDepthTestDistance;
    }
    entity.model = undefined;
    entity.orientation = undefined;
    return true;
}
function applyNavalVisual(entity, vessel = {}) {
    const renderMode = resolveNavalRenderMode(vessel);
    if (renderMode !== NAVAL_RENDER_MODE.MODEL && shouldUseNavalBillboards()) {
        const didApplyBillboard = applyNavalBillboardVisual(entity, vessel, renderMode);
        if (didApplyBillboard) return;
    }
    applyNavalModelVisual(entity, vessel);
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
        scale: getCssNumber("--warzone-live-naval-label-scale", getCssNumber("--warzone-live-label-scale", 0.42)),
        offsetY: getCssNumber("--warzone-live-naval-label-offset-y", getCssNumber("--warzone-live-label-offset-y", -18) - 8),
        fill: getCssColor("--warzone-live-label-fill", "#d7dee7"),
        background: getCssColor("--warzone-live-label-background", "rgba(8, 12, 20, 0.84)"),
        paddingX: getCssNumber("--warzone-live-label-padding-x", 6),
        paddingY: getCssNumber("--warzone-live-label-padding-y", 3),
        maxDistance: getCssNumber("--warzone-live-label-distance", 180000),
        maxChars: Math.max(0, Math.floor(getCssNumber("--warzone-live-naval-label-max-chars", 0))),
        align: getCssText("--warzone-live-naval-label-align", "center"),
        uppercase: getCssNumber("--warzone-live-naval-label-uppercase", 0) >= 0.5,
        animHeightMax: getCssNumber("--warzone-live-naval-anim-height-max", 2200000),
        depthTestDisableDistance: getCssNumber("--warzone-live-naval-label-depth-test-disable-distance", 0),
    };
}
function getNavalLabelHorizontalOrigin(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "left" || normalized === "start") return Cesium.HorizontalOrigin.LEFT;
    if (normalized === "right" || normalized === "end") return Cesium.HorizontalOrigin.RIGHT;
    return Cesium.HorizontalOrigin.CENTER;
}
function transformNavalLabelText(text = "", labelStyle = {}) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    const transformed = labelStyle.uppercase ? raw.toUpperCase() : raw;
    const maxChars = Math.max(0, Math.floor(Number(labelStyle.maxChars || 0)));
    if (!maxChars || transformed.length <= maxChars) return transformed;
    const lines = [];
    let line = "";
    transformed.split(" ").forEach((word) => {
        if (!word) return;
        if (!line) {
            line = word;
            return;
        }
        if ((line.length + 1 + word.length) <= maxChars) {
            line += ` ${word}`;
            return;
        }
        lines.push(line);
        line = word;
    });
    if (line) lines.push(line);
    return lines.join("\n");
}
function buildNavalLabel(vessel = {}, trackKey = "") {
    const labelStyle = getNavalLabelStyleConfig();
    return {
        text: transformNavalLabelText(getNavalDisplayName(vessel) || getNavalSubtypeLabel(vessel.subcategory) || "Naval", labelStyle),
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
        horizontalOrigin: getNavalLabelHorizontalOrigin(labelStyle.align),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: labelStyle.depthTestDisableDistance,
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
function normalizeHeadingDegrees(value = 0) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return ((num % 360) + 360) % 360;
}
function shortestHeadingDeltaDegrees(fromDeg = 0, toDeg = 0) {
    let delta = normalizeHeadingDegrees(toDeg) - normalizeHeadingDegrees(fromDeg);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
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
            entity.billboard.alignedAxis = Cesium.Cartesian3.ZERO;
        }
        if (entity.model) {
            entity.orientation = buildNavalOrientation(vessel.lon, vessel.lat, vessel.heading_deg, vessel);
        }
        entity.__navalLastSeenAt = Number(vessel.last_seen_at || entity.__navalLastSeenAt || 0);
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
    const prevSeenAt = Number(entity.__navalLastSeenAt || 0);
    const nextSeenAt = Number(vessel.last_seen_at || 0);
    const sourceGapMs =
        Number.isFinite(prevSeenAt) &&
            prevSeenAt > 0 &&
            Number.isFinite(nextSeenAt) &&
            nextSeenAt > prevSeenAt
            ? nextSeenAt - prevSeenAt
            : NAVAL_DEFAULT_ANIM_MS;
    const cadenceDuration = clamp(sourceGapMs * 0.9, NAVAL_MIN_ANIM_MS, NAVAL_MAX_ANIM_MS);
    const distanceDuration = clamp(distanceMeters * 0.12, NAVAL_MIN_ANIM_MS, NAVAL_MAX_ANIM_MS);
    const duration = clamp(Math.max(cadenceDuration, distanceDuration), NAVAL_MIN_ANIM_MS, NAVAL_MAX_ANIM_MS);
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startHeading = normalizeHeadingDegrees(entity.__navalHeadingDeg || 0);
    const endHeading = normalizeHeadingDegrees(vessel.heading_deg || 0);
    const headingDelta = shortestHeadingDeltaDegrees(startHeading, endHeading);
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const lon = startLon + ((vessel.lon - startLon) * eased);
        const lat = startLat + ((vessel.lat - startLat) * eased);
        const heading = normalizeHeadingDegrees(startHeading + (headingDelta * eased));
        entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        if (entity.billboard) {
            entity.billboard.rotation = Cesium.Math.toRadians(-heading);
            entity.billboard.alignedAxis = Cesium.Cartesian3.ZERO;
        }
        if (entity.model) {
            entity.orientation = buildNavalOrientation(lon, lat, heading, vessel);
        }
        requestNavalRenderBatched();
        if (t < 1) {
            entity.__navalAnimFrame = requestAnimationFrame(step);
        } else {
            entity.__navalAnimFrame = null;
            entity.__navalHeadingDeg = endHeading;
            entity.__navalLastSeenAt = Number(vessel.last_seen_at || entity.__navalLastSeenAt || 0);
        }
    };
    entity.__navalAnimFrame = requestAnimationFrame(step);
}

// ─── Create vessel entity ─────────────────────────────────────────────────────
function createVesselEntity(viewer, vessel) {
    const { track_key, lat, lon, heading_deg = 0, subcategory = "naval" } = vessel;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    const entity = viewer.entities.add({
        id: `naval-${track_key}`,
        position: pos,
        label: buildNavalLabel(vessel, track_key),
    });
    applyNavalVisual(entity, vessel);

    entity.__navalKey = track_key;
    entity.__navalData = vessel;
    entity.__navalHeadingDeg = heading_deg || 0;
    entity.__navalLastSeenAt = Number(vessel.last_seen_at || 0);
    return entity;
}

// ─── Update vessel position ───────────────────────────────────────────────────
function updateVesselEntity(entity, vessel) {
    const { heading_deg = 0 } = vessel;
    animateVesselTo(entity, vessel);
    applyNavalVisual(entity, vessel);
    if (entity.label) {
        applyNavalLabel(entity.label, vessel, vessel.track_key);
    }
    entity.__navalHeadingDeg = normalizeHeadingDegrees(heading_deg || 0);
    entity.__navalLastSeenAt = Number(vessel.last_seen_at || entity.__navalLastSeenAt || 0);
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

    const focusPanel = document.createElement("aside");
    focusPanel.className = "wz-aircraft-focus-panel is-visible";
    focusPanel.style.left = "112px";
    focusPanel.style.top = "-2px";
    focusPanel.style.width = "8.6rem";
    focusPanel.style.padding = ".45rem";
    focusPanel.style.pointerEvents = "auto";
    focusPanel.setAttribute("aria-label", "Focused naval map controls");

    const modes = document.createElement("div");
    modes.className = "wz-aircraft-focus-panel__modes";

    const btnMap3d = document.createElement("button");
    btnMap3d.type = "button";
    btnMap3d.className = "wz-aircraft-focus-panel__mode";
    btnMap3d.dataset.navalFocusMapMode = "plain";
    btnMap3d.textContent = "3D";
    btnMap3d.setAttribute("aria-label", "Use plain 3D map");
    btnMap3d.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mapApi = window.__warzoneViewer?.__warzone;
        void Promise.resolve(mapApi?.setContourLayerVisible?.(false))
            .then(() => mapApi?.enableFocusedTerrain?.())
            .finally(() => syncNavalOverlayModeButtons());
    });

    const btnContour = document.createElement("button");
    btnContour.type = "button";
    btnContour.className = "wz-aircraft-focus-panel__mode";
    btnContour.dataset.navalFocusMapMode = "contour";
    btnContour.textContent = "CTR";
    btnContour.setAttribute("aria-label", "Use contour terrain map");
    btnContour.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        syncNavalContourCenter(__navalState.selectedKey);
        void Promise.resolve(window.__warzoneViewer?.__warzone?.setContourLayerVisible?.(true))
            .finally(() => syncNavalOverlayModeButtons());
    });

    modes.appendChild(btnMap3d);
    modes.appendChild(btnContour);
    focusPanel.appendChild(modes);
    root.appendChild(focusPanel);

    const unfocusButton = document.createElement("button");
    unfocusButton.type = "button";
    unfocusButton.className = "wz-asset-focus-unfocus is-visible";
    unfocusButton.textContent = "Unfocus";
    unfocusButton.setAttribute("aria-label", "Unfocus naval asset");
    unfocusButton.style.left = "0";
    unfocusButton.style.top = "108px";
    unfocusButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearNavalSelection();
    });
    root.appendChild(unfocusButton);

    host.appendChild(root);
    __navalState.overlayRoot = root;
    return root;
}

function syncNavalOverlayModeButtons() {
    const root = __navalState.overlayRoot;
    if (!root) return;
    const contourVisible = window.__warzoneViewer?.__warzone?.isContourLayerVisible?.() === true;
    root.querySelectorAll("[data-naval-focus-map-mode]").forEach((button) => {
        const active = button.dataset.navalFocusMapMode === (contourVisible ? "contour" : "plain");
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function syncNavalContourCenter(trackKey = "") {
    const viewer = window.__warzoneViewer;
    const mapApi = viewer?.__warzone;
    if (!viewer || !mapApi?.setContourFocusPosition || !trackKey) return false;
    const entry = __navalState.vessels.get(trackKey);
    const position = getNavalEntryPosition(entry);
    if (!position) {
        mapApi.clearContourFocusPosition?.();
        return false;
    }
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) {
        mapApi.clearContourFocusPosition?.();
        return false;
    }
    mapApi.setContourFocusPosition({
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        height: Number(cartographic.height || 0),
    }, {
        force: false,
        reason: "focused-naval-sync",
    });
    return true;
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
    if (!key) {
        if (__navalState.overlayLastVisible) {
            root.style.display = "none";
            __navalState.overlayLastVisible = false;
            __navalState.overlayLastX = Number.NaN;
            __navalState.overlayLastY = Number.NaN;
        }
        return;
    }
    const screen = getScreenPosForVessel(key);
    if (!screen) {
        if (__navalState.overlayLastVisible) {
            root.style.display = "none";
            __navalState.overlayLastVisible = false;
            __navalState.overlayLastX = Number.NaN;
            __navalState.overlayLastY = Number.NaN;
        }
        return;
    }
    if (!__navalState.overlayLastVisible) {
        root.style.display = "block";
        __navalState.overlayLastVisible = true;
    }
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    __navalState.overlayLastX = screen.x;
    __navalState.overlayLastY = screen.y;
    if (window.__warzoneViewer?.__warzone?.isContourLayerVisible?.() === true) {
        syncNavalContourCenter(key);
    }
    syncNavalOverlayModeButtons();
}
function emitNavalFocusChanged() {
    document.dispatchEvent(new CustomEvent("wz:naval-track-selected", {
        detail: {
            trackKey: String(__navalState.selectedKey || ""),
            focused: Boolean(__navalState.selectedKey),
        },
    }));
}

function clearNavalSelection() {
    const previousKey = __navalState.selectedKey;
    __navalState.selectedKey = null;
    closeFocusDriftWarningModal();
    __navalState.focusWarningActive = false;
    if (__navalState.overlayRoot && __navalState.overlayLastVisible) {
        __navalState.overlayRoot.style.display = "none";
    }
    __navalState.overlayLastVisible = false;
    __navalState.overlayLastX = Number.NaN;
    __navalState.overlayLastY = Number.NaN;
    window.__warzoneViewer?.__warzone?.clearContourFocusPosition?.();
    window.__warzoneViewer?.__warzone?.setContourLayerVisible?.(false);
    window.__warzoneViewer?.__warzone?.disableFocusedTerrain?.();
    syncNavalWidgetHighlight(null);
    const previousEntry = previousKey ? __navalState.vessels.get(previousKey) : null;
    if (previousEntry?.entity && previousEntry?.data) {
        applyNavalVisual(previousEntry.entity, previousEntry.data);
    }
    emitNavalFocusChanged();
}
function getNavalFocusWarningRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-naval-focus-warning-range", NAVAL_FOCUS_WARNING_RANGE_METERS),
        NAVAL_FOCUS_CAMERA_RANGE_METERS,
        3200000
    );
}
function getNavalFocusFinalRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-naval-focus-final-range", NAVAL_FOCUS_FINAL_RANGE_METERS),
        getNavalFocusWarningRangeMeters(),
        3200000
    );
}
function getNavalFocusSafeRangeMeters() {
    return clamp(
        Math.min(
            getCssNumber("--warzone-live-naval-focus-camera-range", NAVAL_FOCUS_CAMERA_RANGE_METERS),
            getNavalFocusWarningRangeMeters() * 0.85
        ),
        6000,
        getNavalFocusFinalRangeMeters()
    );
}
function getNavalEntryPosition(entry) {
    try {
        return entry?.entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
    } catch {
        return null;
    }
}
function showNavalFocusWarning() {
    if (__navalState.focusWarningActive || !__navalState.selectedKey) return;
    __navalState.focusWarningActive = true;
    const selectedKey = __navalState.selectedKey;
    const shown = showFocusDriftWarningModal({
        assetType: "naval",
        onStay: () => {
            __navalState.focusWarningActive = false;
            focusNavalVessel(selectedKey, {
                cameraHeight: getNavalFocusSafeRangeMeters(),
                duration: 0.85,
            });
        },
        onUnfocus: () => {
            __navalState.focusWarningActive = false;
            clearNavalSelection();
        },
    });
    if (!shown) {
        __navalState.focusWarningActive = false;
    }
}
function checkNavalFocusRangeWarning() {
    const viewer = window.__warzoneViewer;
    if (!viewer || !__navalState.selectedKey || __navalState.isCameraFlying) return;
    const entry = __navalState.vessels.get(__navalState.selectedKey);
    const position = getNavalEntryPosition(entry);
    if (!position || !viewer.camera?.positionWC) return;
    const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, position);
    if (!Number.isFinite(range)) return;
    if (range >= getNavalFocusWarningRangeMeters()) {
        showNavalFocusWarning();
    }
}
function focusNavalVessel(trackKey, options = {}) {
    if (isAircraftFocusLockActive()) return false;
    const viewer = window.__warzoneViewer;
    const entry = __navalState.vessels.get(trackKey);
    if (!viewer || !entry?.entity || !trackKey) return false;
    const targetPosition = entry.entity.position?.getValue?.(Cesium.JulianDate.now());
    if (!targetPosition) return false;

    __navalState.selectedKey = trackKey;
    syncNavalContourCenter(trackKey);
    applyNavalVisual(entry.entity, entry.data);
    __navalState.isCameraFlying = true;
    viewer.camera.cancelFlight?.();
    const offset = new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(NAVAL_FOCUS_CAMERA_PITCH_DEG),
        Math.max(
            getCssNumber("--warzone-live-naval-focus-camera-range", NAVAL_FOCUS_CAMERA_RANGE_METERS),
            Number(options.cameraHeight || 0)
        )
    );
    const finishFocusFlight = () => {
        __navalState.isCameraFlying = false;
        __navalState.overlayLastVisible = false;
        syncNavalOverlay();
    };
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(targetPosition, 1), {
        duration: Number(options.duration || 1.0),
        offset,
        complete: finishFocusFlight,
        cancel: finishFocusFlight,
    });

    __navalState.overlayLastVisible = false;
    syncNavalOverlay();
    syncNavalWidgetHighlight(trackKey);
    emitNavalFocusChanged();
    return true;
}

function escapeNavalHtml(value) {
    if (value === null || value === undefined) return "—";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function formatNavalCoord(value) {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(4)}°` : "—";
}
function formatNavalHeading(value) {
    const heading = Number(value);
    if (!Number.isFinite(heading)) return "HDG —";
    const normalized = ((heading % 360) + 360) % 360;
    return `HDG ${Math.round(normalized)}°`;
}
function formatNavalSpeed(value) {
    const speed = Number(value);
    return Number.isFinite(speed) ? `${speed.toFixed(0)} kt` : "— kt";
}
function formatNavalTimeAgo(value) {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return "just now";
    const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (deltaSec < 5) return "just now";
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const mins = Math.floor(deltaSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}
function getNavalDisplayName(vessel = {}) {
    return normalizeText(
        vessel.platform_name ||
        vessel.vessel_name ||
        vessel.title ||
        vessel.designation ||
        ""
    ) || "Unknown Vessel";
}
function getNavalAffiliationLabel(vessel = {}) {
    return normalizeText(vessel.operator || vessel.country || "Unknown");
}
function getNavalTypeLabel(vessel = {}) {
    const typeLabel = normalizeText(vessel.type_label || "");
    if (typeLabel) return typeLabel;
    return getNavalSubtypeLabel(vessel.subcategory || "naval");
}
function getNavalClassVariantLabel(vessel = {}) {
    const pieces = [
        vessel.class_name,
        vessel.subclass_name,
        vessel.variant_name,
        vessel.version_name,
    ]
        .map((value) => normalizeText(value))
        .filter(Boolean);
    return pieces.join(" • ");
}
function getNavalCoordinatesLabel(vessel = {}) {
    return `${formatNavalCoord(vessel.lat)}, ${formatNavalCoord(vessel.lon)}`;
}
function getNavalWidgetDetailLabel(vessel = {}) {
    const typeLabel = getNavalTypeLabel(vessel);
    const classVariant = getNavalClassVariantLabel(vessel);
    if (classVariant) {
        return `${typeLabel} • ${classVariant}`;
    }
    return typeLabel || "Naval";
}
function getNavalWidgetCountryOperatorLabel(vessel = {}) {
    const country = normalizeText(vessel.country || vessel.flag_country || "");
    const operator = normalizeText(vessel.operator || "");
    if (country && operator && operator.toLowerCase().includes(country.toLowerCase())) {
        return operator;
    }
    if (country && operator) {
        return `${country} • ${operator}`;
    }
    return operator || country || "Unknown";
}
function mergeNavalVesselData(existing = {}, incoming = {}) {
    const merged = {
        ...existing,
        ...incoming,
        metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            ...(incoming.metadata && typeof incoming.metadata === "object" ? incoming.metadata : {}),
        },
    };
    const keepFirstText = (nextValue, prevValue) => {
        const next = normalizeText(nextValue);
        if (next) return next;
        return normalizeText(prevValue);
    };
    merged.platform_name = keepFirstText(incoming.platform_name, existing.platform_name);
    merged.vessel_name = keepFirstText(incoming.vessel_name, existing.vessel_name);
    merged.type_label = keepFirstText(incoming.type_label, existing.type_label);
    merged.class_name = keepFirstText(incoming.class_name, existing.class_name);
    merged.subclass_name = keepFirstText(incoming.subclass_name, existing.subclass_name);
    merged.variant_name = keepFirstText(incoming.variant_name, existing.variant_name);
    merged.version_name = keepFirstText(incoming.version_name, existing.version_name);
    merged.designation = keepFirstText(incoming.designation, existing.designation);
    merged.callsign = keepFirstText(incoming.callsign, existing.callsign);
    merged.hull_number = keepFirstText(incoming.hull_number, existing.hull_number);
    merged.flag_country = normalizeCountryName(keepFirstText(incoming.flag_country, existing.flag_country));
    merged.country = normalizeCountryName(keepFirstText(incoming.country, existing.country));
    merged.operator = keepFirstText(incoming.operator, existing.operator);
    merged.last_seen_at = Math.max(
        Number(existing.last_seen_at || 0),
        Number(incoming.last_seen_at || 0),
        Date.now()
    );
    return merged;
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
        if (__navalState.vessels.size === 0) {
            if (!window.__wzBaseHover) {
                viewer.container.style.cursor = "";
            }
            return;
        }
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
        if (__navalState.vessels.size === 0) return;
        const picked = viewer.scene.pick(movement.position);
        const trackKey = picked?.id?.__navalKey;

        if (!trackKey) return;

        const entry = __navalState.vessels.get(trackKey);
        if (!entry) return;
        focusNavalVessel(trackKey, {
            screenX: movement.position.x,
            screenY: movement.position.y,
        });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Naval focus is a persistent selection. Camera drag should not clear it,
    // otherwise the focused vessel immediately falls back from GLB to PNG.
}

// ─── Overlay sync post-render ─────────────────────────────────────────────────
function bindNavalOverlay(viewer) {
    if (__navalState.overlayBound) return;
    __navalState.overlayBound = true;
    ensureNavalOverlayRoot(viewer);
    viewer.scene.postRender.addEventListener(syncNavalOverlay);
    viewer.camera.moveEnd.addEventListener(() => {
        refreshNavalViewDependentVisuals();
        checkNavalFocusRangeWarning();
    });
}

// ─── Public: upsert vessel (called from essential.js event handler) ───────────
export function upsertNavalVessel(event) {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    if (
        isProbablyAircraftContact(event) ||
        isKnownNonOperationalNavalContact(event) ||
        !hasNavalTelemetrySignature(event)
    ) {
        const metadata = parseEventMetadata(event.metadata);
        const trackKey = event.dedupe_key || event.source_key || metadata.track_key || `naval-${event.id}`;
        if (trackKey) {
            clearNavalVessel(trackKey);
        }
        return;
    }

    bindNavalOverlay(viewer);
    bindNavalPicking(viewer);

    // Build a unified vessel data object from event fields
    const metadata = parseEventMetadata(event.metadata);
    const sourceObjects = [
        event,
        metadata,
        metadata.vessel,
        metadata.ship,
        metadata.platform,
        metadata.details,
    ].filter((item) => item && typeof item === "object");
    const hintText = buildVesselHintText(event, metadata);
    const rawSubtype = pickFirstNavalText(sourceObjects, [
        "subcategory",
        "subtype",
        "vessel_class",
        "ship_class",
        "ship_type_name",
        "shipTypeName",
        "vessel_type",
        "vesselType",
        "vessel_category",
        "vesselCategory",
        "type",
        "category",
    ]);
    const resolvedSubtype = resolveNavalSubtype(rawSubtype, hintText);
    const displayDetails = resolveNavalDisplayDetails(event, metadata, resolvedSubtype, hintText);
    const affiliation = resolveVesselAffiliation({
        operator: pickFirstNavalText(sourceObjects, [
            "operator",
            "owner",
            "navy",
            "service_branch",
            "serviceBranch",
            "branch",
        ]),
        country: pickFirstNavalText(sourceObjects, [
            "country",
            "flag_country",
            "flagCountry",
            "operator_country",
        ]),
        hintText,
    });
    const trackKey = String(
        event.dedupe_key ||
        event.source_key ||
        metadata.track_key ||
        `naval-${event.id}`
    ).trim();
    if (!trackKey) return;
    const telemetryCoords = resolveNavalTelemetryCoordinates(event, metadata);
    const vesselName = normalizeText(
        displayDetails.platform_name ||
        metadata.vessel_name ||
        metadata.name ||
        event.title?.replace(/\s*[-—]\s.*$/, "") ||
        event.title ||
        ""
    );
    const headingDeg = pickFirstNavalNumber(sourceObjects, [
        "heading_deg",
        "heading",
        "course",
        "course_deg",
        "courseDeg",
        "cog",
        "track",
    ], 0);
    const speedKts = pickFirstNavalNumber(sourceObjects, [
        "speed_kts",
        "speed_knots",
        "speedKnots",
        "ground_speed_kts",
        "sog",
        "speed",
    ], Number.NaN);
    const mmsi = normalizeText(pickFirstNavalText(sourceObjects, [
        "mmsi",
        "MMSI",
    ]));
    const callsign = normalizeText(pickFirstNavalText(sourceObjects, [
        "callsign",
        "call_sign",
        "callSign",
    ]));
    const hullNumber = normalizeText(pickFirstNavalText(sourceObjects, [
        "hull_number",
        "hullNumber",
        "pennant_number",
        "pennantNumber",
        "designation",
    ]));
    const designation = normalizeText(displayDetails.designation || hullNumber);
    const flagCountry = normalizeCountryName(pickFirstNavalText(sourceObjects, [
        "flag_country",
        "flagCountry",
    ]));
    const lastSeenAt = resolveNavalLastSeenAt(event, metadata);
    const vessel = {
        track_key: trackKey,
        platform_name: vesselName,
        vessel_name: vesselName,
        subcategory: displayDetails.subtype || resolvedSubtype,
        type_label: displayDetails.type_label || getNavalSubtypeLabel(displayDetails.subtype || resolvedSubtype),
        class_name: displayDetails.class_name,
        subclass_name: displayDetails.subclass_name,
        variant_name: displayDetails.variant_name,
        version_name: displayDetails.version_name,
        designation,
        vessel_class: normalizeText(displayDetails.class_name || metadata.vessel_class || metadata.ship_class || getNavalSubtypeLabel(displayDetails.subtype || resolvedSubtype)),
        lat: telemetryCoords.lat,
        lon: telemetryCoords.lon,
        heading_deg: toFiniteNumber(headingDeg, 0),
        speed_kts: Number.isFinite(speedKts) ? speedKts : null,
        mmsi,
        callsign,
        hull_number: hullNumber,
        flag_country: flagCountry,
        country: affiliation.country,
        operator: affiliation.operator,
        title: event.title || "",
        region: normalizeText(event.region || metadata.region || ""),
        occurred_at: normalizeText(event.occurred_at || metadata.occurred_at || ""),
        updated_at: normalizeText(event.updated_at || metadata.updated_at || ""),
        last_seen_at: lastSeenAt,
        metadata,
    };

    if (!isValidCoordinatePair(vessel.lat, vessel.lon)) {
        clearNavalVessel(trackKey);
        return;
    }

    const existing = __navalState.vessels.get(trackKey);
    const nextVessel = existing?.data
        ? mergeNavalVesselData(existing.data, vessel)
        : vessel;
    const entityId = `naval-${trackKey}`;
    const sceneEntity = viewer.entities.getById(entityId);
    if (existing?.entity && sceneEntity === existing.entity) {
        updateVesselEntity(existing.entity, nextVessel);
        existing.data = nextVessel;
    } else if (sceneEntity) {
        updateVesselEntity(sceneEntity, nextVessel);
        __navalState.vessels.set(trackKey, { entity: sceneEntity, data: nextVessel });
    } else {
        const entity = createVesselEntity(viewer, nextVessel);
        __navalState.vessels.set(trackKey, { entity, data: nextVessel });
    }

    requestNavalRenderBatched();
    dispatchNavalRegistryUpdate();
}

// ─── Public: clear vessel ─────────────────────────────────────────────────────
export function clearNavalVessel(trackKey) {
    const viewer = window.__warzoneViewer;
    const cacheKey = String(trackKey || "").trim();
    const entry = __navalState.vessels.get(trackKey);
    if (entry?.entity?.__navalAnimFrame) {
        cancelAnimationFrame(entry.entity.__navalAnimFrame);
        entry.entity.__navalAnimFrame = null;
    }
    if (entry?.entity && viewer) viewer.entities.remove(entry.entity);
    __navalState.vessels.delete(trackKey);
    if (cacheKey) {
        __navalIconCodeCache.delete(cacheKey);
    }
    if (__navalState.selectedKey === trackKey) clearNavalSelection();
    requestNavalRenderBatched();
}

// ─── Public: get all vessel snapshots (for widget) ────────────────────────────
export function getAllNavalSnapshots() {
    purgeInvalidNavalContacts();
    return [...__navalState.vessels.values()]
        .map(v => v.data)
        .sort((a, b) => {
            const seenDiff = Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0);
            if (seenDiff !== 0) return seenDiff;
            const priorityDiff = getNavalPriority(a.subcategory) - getNavalPriority(b.subcategory);
            if (priorityDiff !== 0) return priorityDiff;
            const nameA = normalizeText(a.vessel_name || a.title || "");
            const nameB = normalizeText(b.vessel_name || b.title || "");
            return nameA.localeCompare(nameB);
        });
}
export function refreshNavalVisualStyles() {
    __navalState.vessels.forEach((entry) => {
        if (entry?.entity && entry?.data) {
            applyNavalVisual(entry.entity, entry.data);
        }
        if (entry?.entity?.label && entry?.data) {
            applyNavalLabel(entry.entity.label, entry.data, entry.data.track_key);
        }
        if (entry?.entity?.model) {
            if (entry?.data) {
                entry.entity.model.scale = getNavalModelScale(entry.data);
                entry.entity.model.minimumPixelSize = getNavalModelMinPixelSize(entry.data);
                entry.entity.model.maximumScale = getNavalModelMaxScale(entry.data);
            }
            applyLiveGlbModelQuality(entry.entity.model);
        }
    });
    requestNavalRenderBatched();
}
function refreshNavalViewDependentVisuals() {
    __navalState.vessels.forEach((entry) => {
        const entity = entry?.entity;
        const vessel = entry?.data;
        if (!entity || !vessel) return;
        applyNavalVisual(entity, vessel);
        if (entity.model) {
            entity.model.scale = getNavalModelScale(vessel);
            entity.model.minimumPixelSize = getNavalModelMinPixelSize(vessel);
            entity.model.maximumScale = getNavalModelMaxScale(vessel);
            applyLiveGlbModelQuality(entity.model);
        }
        if (entity.label) {
            applyNavalLabel(entity.label, vessel, vessel.track_key);
        }
    });
    requestNavalRenderBatched();
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
    purgeInvalidNavalContacts();

    const vessels = Array.isArray(options?.vessels)
        ? options.vessels
        : getAllNavalSnapshots();
    const safeVessels = vessels.filter((vessel) => !isProbablyAircraftContact(vessel));
    const emptyMessage = String(options?.emptyMessage || "No naval contacts in current filter");

    if (!safeVessels.length) {
        container.innerHTML = `<div class="wz-aircraft-empty">${emptyMessage}</div>`;
        return;
    }

    const selectedKey = String(__navalState.selectedKey || "");
    const aircraftFocusLocked = isAircraftFocusLockActive();
    const cards = safeVessels.slice(0, 24).map((vessel) => {
        const color = getVesselColor(vessel.subcategory);
        const name = getNavalDisplayName(vessel);
        const typeBadge = getNavalSubtypeLabel(vessel.subcategory).toUpperCase();
        const detailLabel = getNavalWidgetDetailLabel(vessel);
        const affiliationLabel = getNavalWidgetCountryOperatorLabel(vessel);
        const speedLabel = formatNavalSpeed(vessel.speed_kts);
        const headingLabel = formatNavalHeading(vessel.heading_deg);
        const coordLabel = getNavalCoordinatesLabel(vessel);
        const timeLabel = formatNavalTimeAgo(vessel.last_seen_at);
        const isSelected = selectedKey && selectedKey === String(vessel.track_key || "");
        const disabledAttr = aircraftFocusLocked ? ` disabled aria-disabled="true"` : "";
        const disabledClass = aircraftFocusLocked ? " is-focus-disabled" : "";
        const rowClick = aircraftFocusLocked ? "" : ` onclick="window.__navalFocusVessel?.('${escapeNavalHtml(vessel.track_key)}')"`;
        const rowCursor = aircraftFocusLocked ? "default" : "pointer";
        return `<article class="wz-aircraft-item wz-naval-item ${isSelected ? "is-selected" : ""}${disabledClass}" data-track-key="${escapeNavalHtml(vessel.track_key)}" style="cursor:${rowCursor}"${rowClick}>
            <div class="wz-aircraft-item__top">
                <strong class="wz-aircraft-item__title">
                    <span class="wz-aircraft-title__status is-active" aria-hidden="true">
                        <span class="stratops-ico-status-1" aria-hidden="true"></span>
                    </span>
                    <span class="wz-aircraft-title__text">${escapeNavalHtml(name)}</span>
                </strong>
                <span class="wz-aircraft-item__time">${escapeNavalHtml(timeLabel)}</span>
            </div>
            <div class="wz-aircraft-item__meta">
                <span>${escapeNavalHtml(detailLabel)}</span>
                <span>${escapeNavalHtml(affiliationLabel)}</span>
            </div>
            <div class="wz-aircraft-item__stats">
                <span>${escapeNavalHtml(speedLabel)}</span>
                <span>${escapeNavalHtml(headingLabel)}</span>
                <span>${escapeNavalHtml(coordLabel)}</span>
            </div>
            <div class="wz-aircraft-item__foot">
                <span class="wz-aircraft-badge" style="background:${escapeNavalHtml(color)}22;color:${escapeNavalHtml(color)};border-color:${escapeNavalHtml(color)}44">${escapeNavalHtml(typeBadge)}</span>
                <button type="button" class="wz-aircraft-action btn-primary${disabledClass}"${disabledAttr} onclick="event.stopPropagation(); window.__navalFocusVessel?.('${escapeNavalHtml(vessel.track_key)}')">
                    <span aria-hidden="true"></span>
                    Focus
                </button>
            </div>
        </article>`;
    });
    container.innerHTML = cards.join("");
}

// ─── Global focus helper (called from widget onclick) ─────────────────────────
window.__navalFocusVessel = (trackKey) => {
    focusNavalVessel(trackKey, {
        screenX: window.innerWidth / 2,
        screenY: window.innerHeight / 2,
    });
};
