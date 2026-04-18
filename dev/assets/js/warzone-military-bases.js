// File Path: /assets/js/warzone-military-bases.js
import * as Cesium from "cesium";

/* ─── State ─────────────────────────────────────────────────────────────── */
const __state = {
    viewer: null,
    entities: [],
    dataSource: null,
    visible: true,
    // authGated: true until wz:auth-success fires or user is already logged in
    authGated: true,
};

/* ─── Type config ────────────────────────────────────────────────────────── */
const TYPE_COLOR = {
    airbase: "#3a8eff", naval: "#ff3a3a", army: "#3aff6e",
    missile: "#ff9d00", cyber: "#c03aff", joint: "#ffffff",
    hq: "#ffec3a", unknown: "#aaaaaa",
};
const TYPE_LABEL = {
    airbase: "Air Base", naval: "Naval Base / Port", army: "Army Base / Installation",
    missile: "Missile / ICBM Site", cyber: "Cyber / Space Operations",
    joint: "Joint / Multi-Service Base", hq: "Military HQ / Command",
    unknown: "Military Installation",
};

/* ─── SVG Icons (inline data URI — no font file needed) ─────────────────── */
function b64svg(svg) {
    // base64 — most reliable encoding for Cesium billboard images
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

const ICON = {
    airbase: "/assets/images/bases/airbase-1.svg",
    naval: "/assets/images/bases/naval-1.png",
    army: "/assets/images/bases/army-1.svg",
    missile: "/assets/images/bases/missile-1.svg",
    // Fallback to existing shipped assets (missing custom cyber/joint icons caused billboard load errors)
    cyber: "/assets/images/bases/hq-1.svg",
    joint: "/assets/images/bases/hq-1.svg",
    hq: "/assets/images/bases/hq-1.svg",
    unknown: "/assets/images/bases/hq-1.svg",

};
function getIcon(t) { return ICON[t] || ICON.unknown; }
function getScale(size) { return size === "major" ? 0.1 : size === "significant" ? 0.1 : 0.1; }

const MILITARY_BASES = [
    { id: "us-a01", name: "Ramstein Air Base", country: "Germany", operator: "USAF / USAFE HQ", type: "airbase", lat: 49.4369, lon: 7.6003, size: "major" },
    { id: "us-a02", name: "Al Udeid Air Base", country: "Qatar", operator: "USAF / AFCENT HQ", type: "airbase", lat: 25.1173, lon: 51.315, size: "major" },
    { id: "us-a03", name: "Yokota Air Base", country: "Japan", operator: "USAF / PACAF HQ", type: "airbase", lat: 35.7485, lon: 139.3486, size: "major" },
    { id: "us-a04", name: "Kadena Air Base", country: "Japan", operator: "USAF", type: "airbase", lat: 26.3557, lon: 127.7688, size: "major" },
    { id: "us-a05", name: "Misawa Air Base", country: "Japan", operator: "USAF", type: "airbase", lat: 40.7032, lon: 141.3677, size: "significant" },
    { id: "us-a06", name: "Andersen AFB Guam", country: "Guam (US)", operator: "USAF", type: "airbase", lat: 13.5834, lon: 144.9295, size: "major" },
    { id: "us-a07", name: "Osan Air Base", country: "South Korea", operator: "USAF / 7th AF HQ", type: "airbase", lat: 37.0906, lon: 127.0296, size: "major" },
    { id: "us-a08", name: "Kunsan Air Base", country: "South Korea", operator: "USAF", type: "airbase", lat: 35.9038, lon: 126.6158, size: "significant" },
    { id: "us-a09", name: "Incirlik Air Base", country: "Turkey", operator: "USAF / NATO", type: "airbase", lat: 37.002, lon: 35.4259, size: "major" },
    { id: "us-a10", name: "Aviano Air Base", country: "Italy", operator: "USAF / NATO", type: "airbase", lat: 46.0312, lon: 12.5959, size: "significant" },
    { id: "us-a11", name: "Spangdahlem Air Base", country: "Germany", operator: "USAF", type: "airbase", lat: 49.9727, lon: 6.6925, size: "significant" },
    { id: "us-a12", name: "RAF Lakenheath", country: "United Kingdom", operator: "USAF / RAF", type: "airbase", lat: 52.4093, lon: 0.5602, size: "major" },
    { id: "us-a13", name: "RAF Mildenhall", country: "United Kingdom", operator: "USAF", type: "airbase", lat: 52.3619, lon: 0.4862, size: "significant" },
    { id: "us-a14", name: "Moron Air Base", country: "Spain", operator: "USAF / Spanish AF", type: "airbase", lat: 37.1749, lon: -5.6159, size: "significant" },
    { id: "us-a15", name: "Al Asad Air Base", country: "Iraq", operator: "US-led Coalition", type: "airbase", lat: 33.7856, lon: 42.4414, size: "significant" },
    { id: "us-a16", name: "Erbil Air Base", country: "Iraq", operator: "US-led Coalition", type: "airbase", lat: 36.2376, lon: 43.9632, size: "significant" },
    { id: "us-a17", name: "Al Dhafra Air Base", country: "UAE", operator: "USAF / UAE Air Force", type: "airbase", lat: 24.2482, lon: 54.5476, size: "major" },
    { id: "us-a18", name: "Ali Al Salem Air Base", country: "Kuwait", operator: "US / Kuwaiti AF", type: "airbase", lat: 29.3467, lon: 47.5204, size: "significant" },
    { id: "us-a19", name: "Prince Sultan Air Base", country: "Saudi Arabia", operator: "USAF / Royal Saudi AF", type: "airbase", lat: 24.0627, lon: 47.5805, size: "major" },
    { id: "us-a20", name: "Chabelley Airfield", country: "Djibouti", operator: "USAF drone ops", type: "airbase", lat: 11.5044, lon: 42.975, size: "significant" },
    { id: "us-a21", name: "NAS Sigonella", country: "Italy", operator: "US Navy", type: "naval", lat: 37.4015, lon: 14.9224, size: "significant" },
    { id: "us-a22", name: "Al-Tanf Garrison", country: "Syria", operator: "US Army", type: "army", lat: 33.482, lon: 38.731, size: "regional" },
    { id: "us-a23", name: "Manda Bay Airfield", country: "Kenya", operator: "US Military", type: "airbase", lat: -2.258, lon: 40.909, size: "regional" },
    { id: "us-a24", name: "Agadez Air Base", country: "Niger", operator: "USAF", type: "airbase", lat: 16.965, lon: 7.987, size: "significant" },
    { id: "us-n01", name: "Naval Station Norfolk", country: "United States", operator: "US Navy Fleet Forces HQ", type: "naval", lat: 36.9376, lon: -76.2988, size: "major" },
    { id: "us-n02", name: "Naval Station San Diego", country: "United States", operator: "US Navy", type: "naval", lat: 32.6785, lon: -117.134, size: "major" },
    { id: "us-n03", name: "Joint Base Pearl Harbor-Hickam", country: "United States", operator: "US Navy / USAF", type: "joint", lat: 21.345, lon: -157.979, size: "major" },
    { id: "us-n04", name: "Naval Base Kitsap (Trident SSBN)", country: "United States", operator: "US Navy", type: "naval", lat: 47.563, lon: -122.623, size: "major" },
    { id: "us-n05", name: "Naval Station Mayport", country: "United States", operator: "US Navy", type: "naval", lat: 30.3891, lon: -81.426, size: "significant" },
    { id: "us-n06", name: "NSA Bahrain 5th Fleet HQ", country: "Bahrain", operator: "US Navy", type: "hq", lat: 26.209, lon: 50.59, size: "major" },
    { id: "us-n07", name: "Diego Garcia", country: "BIOT", operator: "US Navy / RAF", type: "naval", lat: -7.3195, lon: 72.413, size: "major" },
    { id: "us-n08", name: "Naval Station Guam", country: "Guam (US)", operator: "US Navy", type: "naval", lat: 13.4443, lon: 144.6576, size: "major" },
    { id: "us-n09", name: "Naval Station Rota", country: "Spain", operator: "US Navy / Spanish Navy", type: "naval", lat: 36.6416, lon: -6.351, size: "major" },
    { id: "us-n10", name: "Souda Bay Naval Base", country: "Greece", operator: "US Navy / NATO", type: "naval", lat: 35.5301, lon: 24.0736, size: "significant" },
    { id: "us-n11", name: "Sub Base New London", country: "United States", operator: "US Navy", type: "naval", lat: 41.405, lon: -72.087, size: "major" },
    { id: "us-n12", name: "Camp Lemonnier CJTF-HOA HQ", country: "Djibouti", operator: "US Navy", type: "hq", lat: 11.553, lon: 43.1588, size: "significant" },
    { id: "us-h01", name: "The Pentagon OSD / JCS HQ", country: "United States", operator: "DoD", type: "hq", lat: 38.8719, lon: -77.0563, size: "major" },
    { id: "us-h02", name: "MacDill AFB USCENTCOM / SOCOM", country: "United States", operator: "USAF", type: "hq", lat: 27.8493, lon: -82.5213, size: "major" },
    { id: "us-h03", name: "Peterson SFB USSPACECOM / NORAD", country: "United States", operator: "USSF", type: "hq", lat: 38.8204, lon: -104.7002, size: "major" },
    { id: "us-h04", name: "Fort Liberty JSOC HQ", country: "United States", operator: "US Army", type: "army", lat: 35.139, lon: -79.0058, size: "major" },
    { id: "us-h05", name: "Fort Cavazos III Corps", country: "United States", operator: "US Army", type: "army", lat: 31.1347, lon: -97.7803, size: "major" },
    { id: "us-h06", name: "Fort Campbell 101st Airborne", country: "United States", operator: "US Army", type: "army", lat: 36.656, lon: -87.469, size: "major" },
    { id: "us-h07", name: "Camp Humphreys USFK HQ", country: "South Korea", operator: "US Army", type: "hq", lat: 36.9608, lon: 127.0285, size: "major" },
    { id: "us-m01", name: "Minot AFB 91st MW ICBM", country: "United States", operator: "USAF", type: "missile", lat: 48.4157, lon: -101.3579, size: "major" },
    { id: "us-m02", name: "FE Warren AFB 90th MW ICBM", country: "United States", operator: "USAF", type: "missile", lat: 41.145, lon: -104.86, size: "major" },
    { id: "us-m03", name: "Malmstrom AFB 341st MW ICBM", country: "United States", operator: "USAF", type: "missile", lat: 47.509, lon: -111.187, size: "major" },
    { id: "us-m04", name: "Deveselu Aegis Ashore", country: "Romania", operator: "US / NATO BMD", type: "missile", lat: 44.321, lon: 24.088, size: "significant" },
    { id: "us-m05", name: "Redzikowo Aegis Ashore", country: "Poland", operator: "US / NATO BMD", type: "missile", lat: 54.458, lon: 17.53, size: "significant" },
    { id: "ru-a01", name: "Hmeimim Latakia Air Base", country: "Syria", operator: "Russian Aerospace Forces", type: "airbase", lat: 35.4012, lon: 35.9487, size: "major" },
    { id: "ru-a02", name: "Engels-2 Air Base Tu-160 Tu-95", country: "Russia", operator: "Russian AF Long Range Aviation", type: "airbase", lat: 51.4592, lon: 46.182, size: "major" },
    { id: "ru-a03", name: "Olenya Air Base Tu-22M3", country: "Russia", operator: "Russian AF", type: "airbase", lat: 68.152, lon: 33.464, size: "major" },
    { id: "ru-a04", name: "Soltsy-2 Air Base", country: "Russia", operator: "Russian AF", type: "airbase", lat: 58.139, lon: 30.335, size: "significant" },
    { id: "ru-a05", name: "Mozdok Air Base", country: "Russia", operator: "Russian AF", type: "airbase", lat: 43.7688, lon: 44.6087, size: "significant" },
    { id: "ru-a06", name: "Kant Air Base Kyrgyzstan", country: "Kyrgyzstan", operator: "Russian AF", type: "airbase", lat: 42.8512, lon: 74.846, size: "significant" },
    { id: "ru-a07", name: "Pskov Air Base", country: "Russia", operator: "Russian AF", type: "airbase", lat: 57.7843, lon: 28.3956, size: "significant" },
    { id: "ru-a08", name: "Ostrov Air Base", country: "Russia", operator: "Russian AF", type: "airbase", lat: 57.325, lon: 28.065, size: "significant" },
    { id: "ru-a09", name: "Millerovo Air Base", country: "Russia", operator: "Russian AF", type: "airbase", lat: 48.92, lon: 40.38, size: "significant" },
    { id: "ru-a10", name: "Belbek Air Base Crimea", country: "Ukraine (occ)", operator: "Russian AF", type: "airbase", lat: 44.689, lon: 33.573, size: "significant" },
    { id: "ru-n01", name: "Severomorsk Northern Fleet HQ", country: "Russia", operator: "Russian Navy", type: "hq", lat: 69.0753, lon: 33.4162, size: "major" },
    { id: "ru-n02", name: "Tartus Naval Base", country: "Syria", operator: "Russian Navy", type: "naval", lat: 34.8897, lon: 35.8817, size: "major" },
    { id: "ru-n03", name: "Novorossiysk Naval Base", country: "Russia", operator: "Russian Navy Black Sea Fleet", type: "naval", lat: 44.7233, lon: 37.78, size: "major" },
    { id: "ru-n04", name: "Sevastopol Naval Base", country: "Ukraine (occ)", operator: "Russian Navy Black Sea Fleet", type: "naval", lat: 44.6167, lon: 33.55, size: "major" },
    { id: "ru-n05", name: "Baltiysk Naval Base", country: "Russia", operator: "Russian Navy Baltic Fleet", type: "naval", lat: 54.6522, lon: 19.8897, size: "significant" },
    { id: "ru-n06", name: "Kaliningrad Naval Base", country: "Russia", operator: "Russian Navy Baltic Fleet", type: "naval", lat: 54.7065, lon: 20.51, size: "significant" },
    { id: "ru-n07", name: "Vladivostok Pacific Fleet HQ", country: "Russia", operator: "Russian Navy", type: "hq", lat: 43.105, lon: 131.873, size: "major" },
    { id: "ru-n08", name: "Petropavlovsk-Kamchatsky Naval", country: "Russia", operator: "Russian Navy Pacific Fleet", type: "naval", lat: 53.05, lon: 158.65, size: "major" },
    { id: "ru-n09", name: "Gadzhiyevo SSBN Base", country: "Russia", operator: "Russian Navy", type: "naval", lat: 69.25, lon: 33.32, size: "major" },
    { id: "ru-n10", name: "Fokino Naval Base", country: "Russia", operator: "Russian Navy Pacific Fleet", type: "naval", lat: 42.9667, lon: 132.4, size: "significant" },
    { id: "ru-m01", name: "Plesetsk Cosmodrome ICBM", country: "Russia", operator: "Russian Strategic Missile Forces", type: "missile", lat: 62.9255, lon: 40.577, size: "major" },
    { id: "ru-m02", name: "Dombarovsky ICBM Base", country: "Russia", operator: "Russian SMF", type: "missile", lat: 50.78, lon: 59.55, size: "major" },
    { id: "ru-m03", name: "Uzhur ICBM Base", country: "Russia", operator: "Russian SMF", type: "missile", lat: 55.31, lon: 89.82, size: "significant" },
    { id: "ru-h01", name: "Russian MoD General Staff HQ", country: "Russia", operator: "Russian Armed Forces", type: "hq", lat: 55.7558, lon: 37.6176, size: "major" },
    { id: "cn-a01", name: "Fiery Cross Reef Air Base", country: "South China Sea", operator: "PLA Air Force", type: "airbase", lat: 9.55, lon: 112.89, size: "major" },
    { id: "cn-a02", name: "Subi Reef Air Base", country: "South China Sea", operator: "PLA Air Force", type: "airbase", lat: 10.928, lon: 114.083, size: "major" },
    { id: "cn-a03", name: "Hainan Lingshui Air Base", country: "China", operator: "PLA Navy Aviation", type: "airbase", lat: 18.488, lon: 110.038, size: "major" },
    { id: "cn-a04", name: "Jieyang Shashan Air Base", country: "China", operator: "PLA Air Force", type: "airbase", lat: 23.55, lon: 116.5, size: "significant" },
    { id: "cn-a05", name: "Lhasa Gonggar Air Base", country: "China", operator: "PLA Air Force", type: "airbase", lat: 29.2977, lon: 90.9119, size: "significant" },
    { id: "cn-a06", name: "Hotan Air Base", country: "China", operator: "PLA Air Force", type: "airbase", lat: 37.0385, lon: 79.8648, size: "significant" },
    { id: "cn-a07", name: "Kashgar Air Base", country: "China", operator: "PLA Air Force", type: "airbase", lat: 39.5425, lon: 76.0199, size: "significant" },
    { id: "cn-n01", name: "Sanya Naval Base South Sea Fleet HQ", country: "China", operator: "PLAN", type: "hq", lat: 18.2314, lon: 109.5714, size: "major" },
    { id: "cn-n02", name: "Mischief Reef Naval Facility", country: "South China Sea", operator: "PLAN", type: "naval", lat: 9.9083, lon: 115.535, size: "significant" },
    { id: "cn-n03", name: "Zhanjiang Naval Base", country: "China", operator: "PLAN South Sea Fleet", type: "naval", lat: 21.23, lon: 110.42, size: "major" },
    { id: "cn-n04", name: "Qingdao North Sea Fleet HQ", country: "China", operator: "PLAN", type: "hq", lat: 36.142, lon: 120.552, size: "major" },
    { id: "cn-n05", name: "Lushunkou Naval Base", country: "China", operator: "PLAN", type: "naval", lat: 38.85, lon: 121.26, size: "significant" },
    { id: "cn-n06", name: "Shanghai East Sea Fleet HQ", country: "China", operator: "PLAN", type: "hq", lat: 31.404, lon: 121.496, size: "major" },
    { id: "cn-n07", name: "Zhoushan Naval Base", country: "China", operator: "PLAN East Sea Fleet", type: "naval", lat: 29.985, lon: 122.206, size: "major" },
    { id: "cn-n08", name: "Djibouti Support Base", country: "Djibouti", operator: "PLA Navy", type: "naval", lat: 11.557, lon: 43.142, size: "significant" },
    { id: "cn-m01", name: "Daqing ICBM Fields DF-41", country: "China", operator: "PLA Rocket Force", type: "missile", lat: 46.59, lon: 125.03, size: "major" },
    { id: "cn-m02", name: "Datong Missile Base", country: "China", operator: "PLA Rocket Force", type: "missile", lat: 40.12, lon: 113.34, size: "significant" },
    { id: "cn-m03", name: "Korla Missile Test Base", country: "China", operator: "PLA Rocket Force", type: "missile", lat: 41.76, lon: 86.15, size: "significant" },
    { id: "cn-m04", name: "Yumen DF-5 ICBM Silo Field", country: "China", operator: "PLA Rocket Force", type: "missile", lat: 40.8, lon: 97.0, size: "major" },
    { id: "cn-h01", name: "PLA CMC HQ Western Hills Beijing", country: "China", operator: "CMC / PLA", type: "hq", lat: 39.9867, lon: 116.19, size: "major" },
    { id: "na-a01", name: "RAF Brize Norton", country: "United Kingdom", operator: "RAF", type: "airbase", lat: 51.75, lon: -1.5833, size: "major" },
    { id: "na-a02", name: "RAF Lossiemouth", country: "United Kingdom", operator: "RAF", type: "airbase", lat: 57.7052, lon: -3.3391, size: "significant" },
    { id: "na-a03", name: "Buchel Air Base B61 nuclear", country: "Germany", operator: "German AF / NATO", type: "airbase", lat: 50.1734, lon: 7.0633, size: "significant" },
    { id: "na-a04", name: "Kleine Brogel B61 nuclear", country: "Belgium", operator: "Belgian AF / NATO", type: "airbase", lat: 51.1683, lon: 5.47, size: "significant" },
    { id: "na-a05", name: "Volkel Air Base B61 nuclear", country: "Netherlands", operator: "RNLAF / NATO", type: "airbase", lat: 51.6563, lon: 5.7078, size: "significant" },
    { id: "na-a06", name: "Ghedi Air Base B61 nuclear", country: "Italy", operator: "Italian AF / NATO", type: "airbase", lat: 45.4322, lon: 10.2677, size: "significant" },
    { id: "na-a07", name: "Amari Air Base", country: "Estonia", operator: "NATO / Estonian AF", type: "airbase", lat: 59.2622, lon: 24.2085, size: "significant" },
    { id: "na-a08", name: "Lielvarde Air Base", country: "Latvia", operator: "NATO / Latvian AF", type: "airbase", lat: 56.727, lon: 25.126, size: "regional" },
    { id: "na-a09", name: "Siauliai Air Base", country: "Lithuania", operator: "NATO Air Policing", type: "airbase", lat: 55.894, lon: 23.395, size: "significant" },
    { id: "na-a10", name: "Rzeszow-Jasionka", country: "Poland", operator: "NATO / Polish AF", type: "airbase", lat: 50.11, lon: 22.019, size: "significant" },
    { id: "na-a11", name: "Malbork Air Base", country: "Poland", operator: "Polish Air Force", type: "airbase", lat: 54.0267, lon: 19.1348, size: "significant" },
    { id: "na-a12", name: "Larissa Air Base", country: "Greece", operator: "Hellenic Air Force", type: "airbase", lat: 39.6502, lon: 22.4655, size: "significant" },
    { id: "na-a13", name: "Keflavik Air Base", country: "Iceland", operator: "NATO / Icelandic CG", type: "airbase", lat: 63.985, lon: -22.6056, size: "significant" },
    { id: "na-a14", name: "Orland Air Base", country: "Norway", operator: "Royal Norwegian AF", type: "airbase", lat: 63.6989, lon: 9.604, size: "significant" },
    { id: "na-h01", name: "NATO HQ Brussels", country: "Belgium", operator: "NATO Supreme HQ", type: "hq", lat: 50.8796, lon: 4.4286, size: "major" },
    { id: "na-h02", name: "SHAPE SACEUR HQ Mons", country: "Belgium", operator: "NATO", type: "hq", lat: 50.4519, lon: 3.8167, size: "major" },
    { id: "na-h03", name: "Allied Maritime Command Northwood", country: "United Kingdom", operator: "NATO MARCOM HQ", type: "hq", lat: 51.62, lon: -0.472, size: "significant" },
    { id: "na-n01", name: "HMNB Clyde Trident SSBN", country: "United Kingdom", operator: "Royal Navy", type: "naval", lat: 56.073, lon: -4.816, size: "major" },
    { id: "na-n02", name: "HMNB Devonport", country: "United Kingdom", operator: "Royal Navy", type: "naval", lat: 50.37, lon: -4.19, size: "major" },
    { id: "na-n03", name: "HMNB Portsmouth", country: "United Kingdom", operator: "Royal Navy HQ", type: "naval", lat: 50.8054, lon: -1.103, size: "major" },
    { id: "na-n04", name: "Toulon Naval Base", country: "France", operator: "French Navy Med Fleet", type: "naval", lat: 43.1155, lon: 5.9278, size: "major" },
    { id: "na-n05", name: "Brest Naval Base SSBN", country: "France", operator: "French Navy", type: "naval", lat: 48.39, lon: -4.49, size: "major" },
    { id: "na-n06", name: "Kiel Naval Base", country: "Germany", operator: "German Navy", type: "naval", lat: 54.324, lon: 10.152, size: "significant" },
    { id: "na-n07", name: "La Spezia Naval Base", country: "Italy", operator: "Italian Navy HQ", type: "naval", lat: 44.099, lon: 9.822, size: "significant" },
    { id: "na-n08", name: "Haakonsvern Naval Base", country: "Norway", operator: "Royal Norwegian Navy", type: "naval", lat: 60.355, lon: 5.204, size: "major" },
    { id: "me-a01", name: "King Abdulaziz Air Base", country: "Saudi Arabia", operator: "Royal Saudi AF", type: "airbase", lat: 26.2655, lon: 50.1522, size: "major" },
    { id: "me-a02", name: "Tabuk Air Base", country: "Saudi Arabia", operator: "Royal Saudi AF", type: "airbase", lat: 28.3654, lon: 36.6189, size: "significant" },
    { id: "me-a03", name: "Al Minhad Air Base", country: "UAE", operator: "UAE Air Force", type: "airbase", lat: 25.0268, lon: 55.3663, size: "significant" },
    { id: "me-a04", name: "Muharraq Air Base", country: "Bahrain", operator: "Royal Bahraini AF", type: "airbase", lat: 26.2688, lon: 50.6366, size: "significant" },
    { id: "me-a05", name: "Ahmad Al Jaber Air Base", country: "Kuwait", operator: "Kuwait AF", type: "airbase", lat: 28.9348, lon: 47.7917, size: "significant" },
    { id: "me-a06", name: "Shahid Nojeh Air Base", country: "Iran", operator: "IRGC Aerospace Force", type: "airbase", lat: 35.2114, lon: 48.654, size: "significant" },
    { id: "me-a07", name: "Mehrabad Air Base", country: "Iran", operator: "IRIAF", type: "airbase", lat: 35.6893, lon: 51.3136, size: "significant" },
    { id: "me-a08", name: "Nevatim Air Base F-35", country: "Israel", operator: "Israeli Air Force", type: "airbase", lat: 31.208, lon: 34.995, size: "major" },
    { id: "me-a09", name: "Hatzerim Air Base", country: "Israel", operator: "Israeli Air Force", type: "airbase", lat: 31.2333, lon: 34.6667, size: "major" },
    { id: "me-a10", name: "Tel Nof Air Base", country: "Israel", operator: "Israeli Air Force", type: "airbase", lat: 31.839, lon: 34.818, size: "significant" },
    { id: "me-a11", name: "Mezzeh Military Airport", country: "Syria", operator: "Syrian Arab Air Force", type: "airbase", lat: 33.479, lon: 36.223, size: "significant" },
    { id: "me-a12", name: "Shayrat Air Base", country: "Syria", operator: "Syrian Arab Air Force", type: "airbase", lat: 34.49, lon: 36.91, size: "significant" },
    { id: "me-n01", name: "Bandar Abbas Naval Base", country: "Iran", operator: "IRIN / IRGCN HQ", type: "hq", lat: 27.1833, lon: 56.2667, size: "major" },
    { id: "me-n02", name: "Bushehr Naval Base", country: "Iran", operator: "IRIN", type: "naval", lat: 28.95, lon: 50.83, size: "significant" },
    { id: "me-n03", name: "Kharg Island Naval Base", country: "Iran", operator: "IRIN", type: "naval", lat: 29.25, lon: 50.33, size: "significant" },
    { id: "me-n04", name: "Jask Naval Base", country: "Iran", operator: "IRIN", type: "naval", lat: 25.64, lon: 57.77, size: "significant" },
    { id: "me-n05", name: "Haifa Naval Base", country: "Israel", operator: "Israeli Navy", type: "naval", lat: 32.834, lon: 34.988, size: "major" },
    { id: "me-n06", name: "Jubail Naval Base", country: "Saudi Arabia", operator: "Royal Saudi Naval Forces", type: "naval", lat: 27.0174, lon: 49.654, size: "significant" },
    { id: "me-n07", name: "Jeddah Naval Base", country: "Saudi Arabia", operator: "Royal Saudi Naval Forces", type: "naval", lat: 21.4858, lon: 39.1925, size: "significant" },
    { id: "me-m01", name: "Imam Ali Base IRGC ballistic", country: "Iran", operator: "IRGC Aerospace Force", type: "missile", lat: 30.45, lon: 47.78, size: "significant" },
    { id: "me-m02", name: "Palmachim Space Launch Jericho", country: "Israel", operator: "IAF / ISCO", type: "missile", lat: 31.896, lon: 34.695, size: "significant" },
    { id: "ua-a01", name: "Starokostiantyniv Air Base", country: "Ukraine", operator: "Ukrainian Air Force", type: "airbase", lat: 49.704, lon: 27.06, size: "significant" },
    { id: "ua-a02", name: "Mirhorod Air Base", country: "Ukraine", operator: "Ukrainian Air Force", type: "airbase", lat: 49.981, lon: 33.881, size: "significant" },
    { id: "ua-a03", name: "Kulbakyne Air Base", country: "Ukraine", operator: "Ukrainian Air Force", type: "airbase", lat: 46.845, lon: 31.985, size: "significant" },
    { id: "ua-a04", name: "Zaporizhzhia Air Base", country: "Ukraine", operator: "Ukrainian Air Force", type: "airbase", lat: 47.867, lon: 35.316, size: "significant" },
    { id: "ua-n01", name: "Odessa Naval Base", country: "Ukraine", operator: "Ukrainian Navy", type: "naval", lat: 46.472, lon: 30.735, size: "significant" },
    { id: "in-a01", name: "Hindon Air Base", country: "India", operator: "Indian Air Force", type: "airbase", lat: 28.7095, lon: 77.3604, size: "significant" },
    { id: "in-a02", name: "Leh Air Base", country: "India", operator: "Indian Air Force", type: "airbase", lat: 34.1359, lon: 77.546, size: "significant" },
    { id: "in-a03", name: "Srinagar Air Base", country: "India", operator: "Indian Air Force", type: "airbase", lat: 34.0056, lon: 74.7742, size: "significant" },
    { id: "in-a04", name: "Adampur Air Base", country: "India", operator: "Indian Air Force", type: "airbase", lat: 31.434, lon: 75.758, size: "significant" },
    { id: "in-a05", name: "Thanjavur Air Base", country: "India", operator: "Indian AF Maritime Patrol", type: "airbase", lat: 10.722, lon: 79.1014, size: "significant" },
    { id: "in-n01", name: "INS Kadamba Karwar", country: "India", operator: "Indian Navy", type: "naval", lat: 14.7917, lon: 74.1183, size: "major" },
    { id: "in-n02", name: "Visakhapatnam Naval Base", country: "India", operator: "Indian Navy Eastern Fleet", type: "naval", lat: 17.7231, lon: 83.2185, size: "major" },
    { id: "in-n03", name: "Mumbai Naval Dockyard", country: "India", operator: "Indian Navy Western Fleet HQ", type: "hq", lat: 18.9336, lon: 72.834, size: "major" },
    { id: "in-h01", name: "South Block Indian MoD HQ", country: "India", operator: "Indian Armed Forces", type: "hq", lat: 28.6143, lon: 77.2007, size: "major" },
    { id: "pk-a01", name: "Nur Khan Air Base", country: "Pakistan", operator: "Pakistan Air Force", type: "airbase", lat: 33.6167, lon: 73.1, size: "major" },
    { id: "pk-a02", name: "Minhas Kamra Air Base", country: "Pakistan", operator: "Pakistan AF", type: "airbase", lat: 33.869, lon: 72.401, size: "significant" },
    { id: "pk-n01", name: "PNS Iqbal Ormara Naval Base", country: "Pakistan", operator: "Pakistan Navy", type: "naval", lat: 25.209, lon: 64.638, size: "significant" },
    { id: "pk-n02", name: "PNS Mehran Karachi Naval Air", country: "Pakistan", operator: "Pakistan Navy", type: "naval", lat: 24.893, lon: 67.131, size: "significant" },
    { id: "ea-a01", name: "JASDF Naha Air Base", country: "Japan", operator: "JASDF", type: "airbase", lat: 26.1958, lon: 127.646, size: "significant" },
    { id: "ea-a02", name: "JASDF Hyakuri Air Base", country: "Japan", operator: "JASDF", type: "airbase", lat: 36.181, lon: 140.415, size: "significant" },
    { id: "ea-a03", name: "Darwin RAAF Base", country: "Australia", operator: "RAAF / USMC rotation", type: "airbase", lat: -12.425, lon: 130.873, size: "significant" },
    { id: "ea-a04", name: "RAAF Tindal", country: "Australia", operator: "RAAF", type: "airbase", lat: -14.5214, lon: 132.3777, size: "significant" },
    { id: "ea-a05", name: "RAAF Williamtown", country: "Australia", operator: "RAAF", type: "airbase", lat: -32.7951, lon: 151.833, size: "significant" },
    { id: "ea-n01", name: "JMSDF Sasebo 7th Fleet", country: "Japan", operator: "JMSDF / US Navy", type: "naval", lat: 33.18, lon: 129.72, size: "major" },
    { id: "ea-n02", name: "JMSDF Yokosuka 7th Fleet HQ", country: "Japan", operator: "JMSDF / US Navy", type: "hq", lat: 35.285, lon: 139.671, size: "major" },
    { id: "ea-n03", name: "JMSDF Kure Naval Base", country: "Japan", operator: "JMSDF", type: "naval", lat: 34.235, lon: 132.57, size: "significant" },
    { id: "ea-n04", name: "ROK Navy Jinhae Fleet HQ", country: "South Korea", operator: "Republic of Korea Navy", type: "hq", lat: 35.129, lon: 128.644, size: "major" },
    { id: "ea-n05", name: "HMAS Garden Island Sydney", country: "Australia", operator: "Royal Australian Navy", type: "naval", lat: -33.856, lon: 151.206, size: "major" },
    { id: "ea-n06", name: "HMAS Stirling Fleet Base West", country: "Australia", operator: "Royal Australian Navy", type: "naval", lat: -32.191, lon: 115.697, size: "major" },
    { id: "ea-n07", name: "Changi Naval Base", country: "Singapore", operator: "Republic of Singapore Navy", type: "naval", lat: 1.378, lon: 104.012, size: "major" },
    { id: "kp-m01", name: "Sohae Satellite Launch Station", country: "North Korea", operator: "DPRK", type: "missile", lat: 39.66, lon: 124.705, size: "major" },
    { id: "kp-m02", name: "Punggye-ri Nuclear Test Site", country: "North Korea", operator: "DPRK", type: "missile", lat: 41.2743, lon: 129.0843, size: "major" },
    { id: "kp-m03", name: "Hwasong ICBM Base", country: "North Korea", operator: "DPRK Strategic Rocket Forces", type: "missile", lat: 39.99, lon: 124.68, size: "significant" },
    { id: "kp-m04", name: "Yongbyon Nuclear Complex", country: "North Korea", operator: "DPRK", type: "missile", lat: 39.7944, lon: 125.7547, size: "major" },
    { id: "kp-n01", name: "Sinpo Submarine Base", country: "North Korea", operator: "DPRK Navy", type: "naval", lat: 40.0167, lon: 128.1833, size: "significant" },
    { id: "kp-n02", name: "Nampo Naval Base", country: "North Korea", operator: "DPRK Navy", type: "naval", lat: 38.73, lon: 125.39, size: "significant" },
    { id: "kp-n03", name: "Mayang-do Submarine Base", country: "North Korea", operator: "DPRK Navy", type: "naval", lat: 40.58, lon: 129.38, size: "significant" },
    { id: "af-a01", name: "French Air Base 160 NDjamena", country: "Chad", operator: "French AF", type: "airbase", lat: 12.137, lon: 15.034, size: "significant" },
    { id: "af-a02", name: "Djibouti Air Base 101", country: "Djibouti", operator: "Djibouti AF / French AF", type: "airbase", lat: 11.5534, lon: 43.1594, size: "significant" },
    { id: "af-a03", name: "Air Base 101 Niamey", country: "Niger", operator: "Niger AF / French AF", type: "airbase", lat: 13.4815, lon: 2.1837, size: "regional" },
    { id: "af-a04", name: "Waterkloof Air Base", country: "South Africa", operator: "South African AF", type: "airbase", lat: -25.83, lon: 28.222, size: "significant" },
    { id: "af-a05", name: "Hurso Camp", country: "Ethiopia", operator: "US Army", type: "army", lat: 9.58, lon: 41.88, size: "regional" },
    { id: "tr-n01", name: "Golcuk Naval Base", country: "Turkey", operator: "Turkish Naval Forces HQ", type: "hq", lat: 40.7, lon: 29.85, size: "major" },
    { id: "tr-a01", name: "Akinci Air Base", country: "Turkey", operator: "Turkish Air Force", type: "airbase", lat: 40.076, lon: 32.566, size: "significant" },
    { id: "eg-n01", name: "Alexandria Naval Base", country: "Egypt", operator: "Egyptian Navy", type: "naval", lat: 31.2001, lon: 29.9187, size: "significant" },
    { id: "eg-a01", name: "Cairo West Air Base", country: "Egypt", operator: "Egyptian Air Force", type: "airbase", lat: 30.116, lon: 30.916, size: "significant" },
    { id: "br-n01", name: "Arsenal de Marinha Rio de Janeiro", country: "Brazil", operator: "Brazilian Navy", type: "naval", lat: -22.894, lon: -43.15, size: "significant" },
    { id: "br-a01", name: "Galeao Air Force Base", country: "Brazil", operator: "Brazilian Air Force", type: "airbase", lat: -22.809, lon: -43.243, size: "significant" },
];

/* ─── Entity creation ───────────────────────────────────────────────────── */
function createBaseEntity(dataSource, base) {
    const pos = Cesium.Cartesian3.fromDegrees(base.lon, base.lat, 0);
    return dataSource.entities.add({
        id: `milbase:${base.id}`,
        position: pos,
        billboard: {
            image: getIcon(base.type),
            scale: getScale(base.size),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, 8),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new Cesium.NearFarScalar(1.5e5, 0.55, 8e6, 0.45),
            translucencyByDistance: new Cesium.NearFarScalar(7e6, 1.0, 1.4e7, 0.0),
            disableDepthTestDistance: 0,
        },
        properties: {
            milbase: true,
            name: base.name,
            country: base.country,
            operator: base.operator,
            type: base.type,
            typeLabel: TYPE_LABEL[base.type] || "Military Installation",
            size: base.size,
            lat: base.lat,
            lon: base.lon,
        },
    });
}

/* ─── Visibility ─────────────────────────────────────────────────────────── */
function applyVisibility() {
    // Hidden if layer toggled off OR user not yet authenticated
    const shouldShow = __state.visible && !__state.authGated;
    if (__state.dataSource) {
        __state.dataSource.show = shouldShow;
    } else {
        __state.entities.forEach(e => { e.show = shouldShow; });
    }
    __state.viewer?.scene.requestRender();
}

/* ─── Popup near click position ─────────────────────────────────────────── */
function showBasePanel(base, sx, sy) {
    document.getElementById("warzone-milbase-panel")?.remove();

    const escapeHTML = (value) => {
        if (value === null || value === undefined || value === "") return "—";
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };

    const formatCoord = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? `${num.toFixed(4)}°` : "—";
    };

    const titleCase = (value) => {
        if (!value) return "—";
        const str = String(value).trim();
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : "—";
    };

    const tc = TYPE_COLOR?.[base?.type] || "#aaa";
    const tl = TYPE_LABEL?.[base?.type] || "Military Installation";

    const name = base?.name || "Unknown Installation";
    const country = base?.country || "—";
    const operator = base?.operator || "—";
    const classification = titleCase(base?.size);
    const lat = formatCoord(base?.lat);
    const lon = formatCoord(base?.lon);

    const panel = document.createElement("div");
    panel.id = "warzone-milbase-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "milbase-name");
    panel.setAttribute("aria-describedby", "milbase-desc milbase-info");
    panel.setAttribute("tabindex", "-1");
    panel.style.cssText = "position:fixed; width:28rem; max-width:calc(100vw - 1rem); z-index:900;";

    panel.innerHTML = `
    <div class="wz-widget-milbase" itemscope itemtype="https://schema.org/Place">
        <header class="wz-widget-header">
            <span class="static-dot" style="background:${escapeHTML(tc)}" aria-hidden="true"></span>
            <span class="wz-widget-kicker" aria-hidden="true">${escapeHTML(tl)}</span>
            <div class="wz-widget-header-actions">
                <button
                    type="button"
                    id="milbase-close"
                    class="static-icon"
                    data-widget-close
                    aria-label="Close military base information panel">
                    <span class="bx-web-ico-close-1-1" aria-hidden="true"></span>
                </button>
            </div>
        </header>

        <section class="wz-widget-body">
            <p id="milbase-desc" class="sr-only">
                Military base information dialog showing installation name, country, operator, classification, and coordinates.
            </p>

            <h3 id="milbase-name" itemprop="name">${escapeHTML(name)}</h3>

            <ul id="milbase-info" class="wz-widget-data-list">
                <li>
                    <strong>Type</strong>
                    <span>${escapeHTML(tl)}</span>
                </li>
                <li>
                    <strong>Country</strong>
                    <span>${escapeHTML(country)}</span>
                </li>
                <li>
                    <strong>Operator</strong>
                    <span>${escapeHTML(operator)}</span>
                </li>
                <li>
                    <strong>Classification</strong>
                    <span>${escapeHTML(classification)}</span>
                </li>
                <li>
                    <strong>Coordinates</strong>
                    <span>${lat}, ${lon}</span>
                </li>
            </ul>
        </section>
    </div>`;

    document.body.appendChild(panel);

    // Position near click, auto-adjust to stay on screen
    const W = 448;
    const H = 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = sx + 16;
    let top = sy - 16;

    if (left + W > vw - 8) left = sx - W - 16;
    if (top + H > vh - 8) top = vh - H - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    const closePanel = () => {
        panel.remove();
        document.removeEventListener("keydown", escHandler);
    };

    const escHandler = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closePanel();
        }
    };

    document.addEventListener("keydown", escHandler);

    document.getElementById("milbase-close")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
    });

    panel.focus();
}

/* ─── Click + hover handler ───────────────────────────────────────────────── */
function bindClickHandler(viewer) {
    const canvas = viewer.scene.canvas;
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    // MOUSE_MOVE — show pointer cursor when hovering a base icon.
    // Sets window.__wzBaseHover so the aircraft tracker's MOUSE_MOVE handler
    // knows not to reset the cursor back to "" when it runs.
    handler.setInputAction(movement => {
        const picked = viewer.scene.pick(movement.endPosition);
        const isBase = Cesium.defined(picked?.id) &&
            picked.id?.properties?.milbase?.getValue?.() === true;
        window.__wzBaseHover = isBase;
        if (isBase) {
            canvas.style.cursor = "pointer";
        }
        // Do NOT reset to "" here — aircraft handler owns the reset path.
        // It checks window.__wzBaseHover before clearing (see warzone-live-airforce.js).
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // LEFT_CLICK — open info panel next to click position
    handler.setInputAction(click => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked?.id)) {
            const props = picked.id?.properties;
            if (props?.milbase?.getValue?.()) {
                showBasePanel({
                    name: props.name.getValue(),
                    country: props.country.getValue(),
                    operator: props.operator.getValue(),
                    type: props.type.getValue(),
                    typeLabel: props.typeLabel.getValue(),
                    size: props.size.getValue(),
                    lat: props.lat.getValue(),
                    lon: props.lon.getValue(),
                }, click.position.x, click.position.y);
                return; // keep panel open
            }
        }
        document.getElementById("warzone-milbase-panel")?.remove();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/* ─── Public API ─────────────────────────────────────────────────────────── */
export function initWarzoneMilitaryBases(viewer) {
    if (!viewer) return;
    __state.viewer = viewer;

    // Gate behind authentication — check if already logged in at init time
    __state.authGated = !document.body.classList.contains("is-authenticated");

    // Use a CustomDataSource so bases are isolated from viewer.entities.removeAll()
    // which gets called when events reload, wiping any entities added to the main collection
    const ds = new Cesium.CustomDataSource("military-bases");
    viewer.dataSources.add(ds);
    __state.dataSource = ds;

    __state.entities = MILITARY_BASES.map(b => createBaseEntity(ds, b));
    viewer.camera.changed.addEventListener(() => viewer.scene.requestRender());
    bindClickHandler(viewer);

    // When user logs in (either via form or silent check), unlock bases
    document.addEventListener("wz:auth-success", () => {
        __state.authGated = false;
        applyVisibility();
    }, { once: true });

    applyVisibility();
}

export function setWarzoneMilitaryBasesVisible(visible) {
    __state.visible = Boolean(visible);
    applyVisibility();
}

export function toggleWarzoneMilitaryBases() {
    setWarzoneMilitaryBasesVisible(!__state.visible);
    return __state.visible;
}

export function isWarzoneMilitaryBasesVisible() {
    return __state.visible;
}
