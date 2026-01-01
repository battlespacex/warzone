// assets/scripts/images-data.js
/* =========================================================
   Single source of truth for BOTH:
   1) XFolio gallery (grid + lightbox)
   2) XSwiper hero slider

   Update (your request):
   - XSwiper folder has TWO files per slide:
       1-desk.jpg   (desktop)
       1-mob.jpg    (mobile)
   - Auto builds both paths from ONE numeric key: "1", "2", ...
   - XFolio remains unchanged
   ========================================================= */

const PATHS = {
    galleryHdDir: "assets/images/gallery/hd/",
    galleryThumbDir: "assets/images/gallery/thumbnail/",
    galleryHdSuffix: "-hd",
    galleryThumbSuffix: "-thumb",
    galleryExt: ".jpg",

    // XSwiper folder
    swiperDir: "assets/images/gallery/swiper/",
    swiperExt: ".jpg",
};

export const LOCATIONS = {
    LDN_ON_CA: "London, Ontario, Canada",
    TOR_ON_CA: "Toronto, Ontario, Canada",
    ISB_PK: "Islamabad, Pakistan",
};

function buildGalleryPaths(imageKey) {
    return {
        imageLarge: `${PATHS.galleryHdDir}${imageKey}${PATHS.galleryHdSuffix}${PATHS.galleryExt}`,
        thumbnail: `${PATHS.galleryThumbDir}${imageKey}${PATHS.galleryThumbSuffix}${PATHS.galleryExt}`,
    };
}

/**
 * XSwiper: numeric key "1" -> "1-desk.jpg" + "1-mob.jpg"
 */
function buildSwiperPaths(swiperKey) {
    const key = String(swiperKey || "").trim(); // "1"
    return {
        deskImage: `${PATHS.swiperDir}${key}-desk${PATHS.swiperExt}`,
        mobImage: `${PATHS.swiperDir}${key}-mob${PATHS.swiperExt}`,
    };
}

/** tags can be:
 *  - array: ["a", "b"]
 *  - string: "a, b, c"
 */
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags
            .map((t) => String(t || "").trim())
            .filter(Boolean)
            .map((t) => t.toLowerCase());
    }

    if (typeof tags === "string") {
        return tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => t.toLowerCase());
    }

    return [];
}

function makeSortMap(list) {
    const map = new Map();
    (list || []).forEach((x) => {
        if (!x || !x.image) return;
        const key = String(x.image).trim();
        const val = Number(x.sortOrder);
        if (!Number.isFinite(val)) return;
        map.set(key, val);
    });
    return map;
}

/* =========================================================
   XFolio (gallery)
   ========================================================= */

const XFOLIO_META = [
    {
        image: "aerocism-1",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor low pass at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, lockheed martin, 5th gen fighter, stealth fighter, airshow photography, military aviation, fast jet, raptor demo, aviation enthusiast"
    },
    {
        image: "aerocism-2",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor banking through cloud at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, lockheed martin, 5th gen fighter, raptor, airshow pass, afterburner, military aviation, jet photography"
    },
    {
        image: "aerocism-3",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker on the runway at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, aerial refueling, tanker aircraft, runway shot, military transport, airshow static, aviation photography"
    },
    {
        image: "aerocism-4",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "Close-up of USAF KC-135 Stratotanker nose at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, nose detail, aircraft closeup, aerial refueling, tanker, military aviation, aviation photo"
    },
    {
        image: "aerocism-5",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor emerging through clouds at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, vapor, cloud break, airshow demo, high performance jet, usaf, military aviation, cinematic aviation"
    },
    {
        image: "aerocism-6",
        locationKey: "LDN_ON_CA",
        aircraft: "V-22 Osprey",
        alt: "V-22 Osprey tiltrotor in flight at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, v-22 osprey, bell boeing, tiltrotor, military rotorcraft, airshow display, aviation photography, us military, vertical lift, tactical aviation"
    },
    {
        image: "aerocism-7",
        locationKey: "LDN_ON_CA",
        aircraft: "P-51 Mustang",
        alt: "P-51 Mustang warbird flying at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, p-51 mustang, north american aviation, warbird, ww2 aircraft, propeller fighter, heritage flight, airshow pass, classic aviation, aviation photography"
    },
    {
        image: "aerocism-8",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II in flight at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, canadian national exhibition, cne airshow, canadian international air show, toronto airshow, f-35 lightning ii, lockheed martin, stealth fighter, jet photography, airshow photography, waterfront airshow"
    },
    {
        image: "aerocism-9",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "CF-18 Hornet close pass at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, mcdonnell douglas, boeing, rcaf, fighter jet, low pass, airshow photography, military aviation, tactical jet"
    },
    {
        image: "aerocism-10",
        locationKey: "LDN_ON_CA",
        aircraft: "CH-149 Cormorant",
        alt: "CH-149 Cormorant search-and-rescue helicopter in flight at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, ch-149 cormorant, agustawestland, leonardo, rcaf, search and rescue, sar helicopter, rotorcraft, airshow display, helicopter photography"
    },

    {
        image: "aerocism-12",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "US Navy Blue Angels in formation at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, canadian national exhibition, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, formation flying, aerobatics, airshow team, jet formation, airshow photography"
    },
    {
        image: "aerocism-13",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II banking at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, toronto airshow, f-35 lightning ii, lockheed martin, stealth jet, fighter aircraft, banking turn, fast jet, aviation photography, airshow pass"
    },
    {
        image: "aerocism-14",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "Two fighters crossing in the sky during London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, airshow crossover, formation pass, fighter jets, high speed, military aviation, jet photography, aerial display, cinematic sky, aerocism"
    },
    {
        image: "aerocism-15",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II close-up pass at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-35 lightning ii, stealth fighter, close pass, nose profile, modern fighter jet, airshow photography, jet closeup, aviation enthusiast"
    },
    {
        image: "aerocism-16",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Two CF-18 Hornets in formation at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, formation flying, fighter jets, airshow demo, military aviation, jet formation, cloud backdrop, aviation photo"
    },
    {
        image: "aerocism-17",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker in flight at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, aerial refueling, tanker aircraft, airshow flyby, military aviation, large aircraft, aviation photography"
    },
    {
        image: "aerocism-18",
        locationKey: "LDN_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II low pass over trees at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-35 lightning ii, low pass, stealth fighter, airshow display, cinematic clouds, military aviation, jet photography, modern fighter, aerocism"
    },
    {
        image: "aerocism-19",
        locationKey: "LDN_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II banking low at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-35 lightning ii, lockheed martin, banking turn, stealth jet, airshow photography, military aviation, fast jet, dramatic sky, aerocism"
    },
    {
        image: "aerocism-20",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "CF-18 Hornet cockpit close-up on the ground at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, cockpit, pilot, ground shot, static display, fighter jet, aviation detail, aerocism"
    },
    {
        image: "aerocism-21",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "CF-18 Hornet taxiing with canopy open at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, taxi, canopy open, ground operations, fighter jet, airshow ramp, aviation photography, aerocism"
    },
    {
        image: "aerocism-22",
        locationKey: "LDN_ON_CA",
        aircraft: "C-17 Globemaster III",
        alt: "C-17 Globemaster III parked on the ramp at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, c-17 globemaster iii, boeing, usaf, strategic airlift, cargo aircraft, transport plane, airshow static, ramp shot, aviation photography"
    },
    {
        image: "aerocism-23",
        locationKey: "LDN_ON_CA",
        aircraft: "F-16 Fighting Falcon",
        alt: "F-16 Fighting Falcon parked on the tarmac at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-16 fighting falcon, static display, fighter jet, tarmac, airshow ramp, military aviation, aircraft detail, aviation photo, aerocism"
    },
    {
        image: "aerocism-24",
        locationKey: "LDN_ON_CA",
        aircraft: "F-16 Fighting Falcon",
        alt: "F-16 Fighting Falcon on the ramp with tail markings at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-16 fighting falcon, fighter jet, static aircraft, tail art, airshow display, military aviation, ramp photography, aviation enthusiast, aerocism"
    },
    {
        image: "aerocism-25",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "Blue Angels solo jet banking at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, solo pass, banking turn, aerobatics, airshow team, jet photography, aviation photography"
    },
    {
        image: "aerocism-26",
        locationKey: "TOR_ON_CA",
        aircraft: "Aerobatic aircraft",
        alt: "Aerobatic aircraft drawing a smoke pattern at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, aerobatics, smoke trail, smoke pattern, airshow performance, stunt flying, sky art, aviation photography, airshow action"
    },
    {
        image: "aerocism-27",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "CF-18 Hornet deploying flares during demo at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, flares, defensive countermeasures, airshow demo, fighter jet, dramatic action, military aviation, jet photography"
    },
    {
        image: "aerocism-28",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor high-alpha pass with vapor at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, f-22 raptor, lockheed martin, stealth fighter, high alpha, vapor, airshow demo, fast jet, military aviation, jet photography"
    },
    {
        image: "aerocism-29",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor fast pass at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-22 raptor, stealth jet, high speed, airshow flyby, fighter aircraft, military aviation, aviation photography, toronto waterfront"
    },
    {
        image: "aerocism-31",
        locationKey: "LDN_ON_CA",
        aircraft: "C-17 Globemaster III",
        alt: "C-17 Globemaster III flying past trees at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, c-17 globemaster iii, boeing, usaf, transport aircraft, strategic airlift, four engine jet, airshow flyby, military aviation, aviation photo"
    },
    {
        image: "aerocism-32",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "Blue Angels diamond formation at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, diamond formation, precision flying, formation aerobatics, airshow team, jet formation, airshow photography"
    },
    {
        image: "aerocism-33",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II high-speed pass over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, f-35 lightning ii, stealth fighter, fast jet, high speed pass, aviation photography, jet photography"
    },
    {
        image: "aerocism-36",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "F/A-18 Hornet climbing after takeoff at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, hornet, fighter jet, takeoff, climb out, airshow demo, military aviation, jet photography, aerocism"
    },
    {
        image: "aerocism-37",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor pulling vertical climb at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, vertical climb, afterburner, stealth fighter, usaf, airshow performance, high power, military aviation, jet photography"
    },
    {
        image: "aerocism-38",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor banking through clouds at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, banking turn, clouds, stealth jet, fighter aircraft, airshow demo, usaf, military aviation, cinematic aviation"
    },
    {
        image: "aerocism-39",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "KC-135 Stratotanker climbing in cloudy sky at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, usaf, boeing, tanker aircraft, large aircraft, climb out, airshow flyby, military aviation, aviation photo"
    },
    {
        image: "aerocism-40",
        locationKey: "TOR_ON_CA",
        aircraft: "CC-130 Hercules",
        alt: "CC-130 Hercules approaching to land near Toronto",
        tags: "toronto, ontario, canada, aviation, cc-130 hercules, rcaf, transport aircraft, cargo plane, tactical transport, aircraft landing, aviation photography"
    },
    {
        image: "aerocism-41",
        locationKey: "LDN_ON_CA",
        aircraft: "Military helicopters",
        alt: "Two military helicopters flying in formation at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, helicopter formation, military helicopter, rotorcraft, tactical aviation, airshow display, low level flight, aviation photography, aerocism"
    },
    {
        image: "aerocism-42",
        locationKey: "LDN_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II with vapor and dramatic clouds at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-35 lightning ii, stealth fighter, vapor, cinematic clouds, airshow demo, modern fighter, military aviation, jet photography, aerocism"
    },
    {
        image: "aerocism-43",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "Blue Angels solo jet banking through clouds at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, solo pass, aerobatics, cloudy sky, jet photography, aviation photography"
    },
    {
        image: "aerocism-44",
        locationKey: "TOR_ON_CA",
        aircraft: "Heritage flight (jet + warbird)",
        alt: "Heritage flight crossover moment at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, heritage flight, warbird, formation pass, crossover, airshow moment, classic aviation, modern jet, aviation photography, toronto waterfront"
    },
    {
        image: "aerocism-45",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "Blue Angels close formation at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, close formation, precision flying, aerobatics, airshow team, jet formation, aviation photography"
    },
    {
        image: "aerocism-46",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels smoke trails",
        alt: "Curving smoke trails over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, smoke trails, aerobatics, airshow spectacle, sky patterns, blue angels, toronto waterfront, aviation photography, airshow action, show center"
    },
    {
        image: "aerocism-47",
        locationKey: "TOR_ON_CA",
        aircraft: "Heritage flight (jet + warbird)",
        alt: "Jet and warbird flying together during a heritage flight at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, heritage flight, warbird, formation flying, jet and prop, airshow performance, classic aviation, modern fighter, aviation photography"
    },
    {
        image: "aerocism-48",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor banking with metallic sheen at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, banking turn, usaf, airshow demo, fighter jet, dramatic lighting, military aviation, jet photography"
    },

    // NEW (missing in your meta) — no locationKey as requested
    {
        image: "aerocism-49",
        aircraft: "CH-146 Griffon (utility helicopter)",
        alt: "Canadian utility helicopter flying low over water during an airshow display",
        tags: "helicopter, rotorcraft, low level flight, over water, utility helicopter, canadian forces, airshow display, aviation photography, tactical aviation, search and rescue, griffon, bell 412"
    },
    // NEW (missing in your meta) — no locationKey as requested
    {
        image: "aerocism-50",
        aircraft: "F-22 Raptor",
        alt: "F-22 Raptor in a vapor burst during a high-energy maneuver",
        tags: "f-22 raptor, stealth fighter, vapor cone, high alpha, shockwave, airshow demo, fast jet, military aviation, jet photography, cinematic aviation, supersonic effect"
    },

    {
        image: "aerocism-51",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "F/A-18 Hornet blasting through clouds at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, fighter jet, afterburner, cloud break, airshow demo, high speed pass, military aviation, jet photography, aerocism"
    },
    {
        image: "aerocism-52",
        locationKey: "TOR_ON_CA",
        aircraft: "P-51 Mustang",
        alt: "P-51 Mustang warbird flying at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, p-51 mustang, north american aviation, warbird, ww2 aircraft, propeller fighter, heritage flight, classic aviation, aviation photography, airshow photography"
    },
    {
        image: "aerocism-53",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II flying over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-35 lightning ii, lockheed martin, stealth fighter, modern jet, airshow demo, toronto waterfront, aviation photography, jet photography"
    },
    {
        image: "aerocism-54",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "CF-18 Hornet banking in bright haze at London Airshow 2025",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, fighter jet, banking turn, airshow pass, military aviation, jet photography, fast jet, aerocism"
    },
    {
        image: "aerocism-81",
        locationKey: "ISB_PK",
        aircraft: "AH1 Cobra Gunship",
        alt: "Pakistan Army Aviation Cobra Gunships",
        tags: "cobra gunship, cobra, ah1, pakistan, army aviation, aerocism"
    }
];

// List B: sorting only
const XFOLIO_SORT = [
    { image: "aerocism-1", sortOrder: 44 },
    { image: "aerocism-2", sortOrder: 1 },
    { image: "aerocism-3", sortOrder: 45 },
    { image: "aerocism-4", sortOrder: 46 },
    { image: "aerocism-5", sortOrder: 18 },
    { image: "aerocism-6", sortOrder: 33 },
    { image: "aerocism-7", sortOrder: 32 },
    { image: "aerocism-8", sortOrder: 6 },
    { image: "aerocism-9", sortOrder: 16 },
    { image: "aerocism-10", sortOrder: 10 },
    { image: "aerocism-12", sortOrder: 11 },
    { image: "aerocism-13", sortOrder: 27 },
    { image: "aerocism-14", sortOrder: 26 },
    { image: "aerocism-15", sortOrder: 12 },
    { image: "aerocism-16", sortOrder: 3 },
    { image: "aerocism-17", sortOrder: 35 },
    { image: "aerocism-18", sortOrder: 34 },
    { image: "aerocism-19", sortOrder: 43 },
    { image: "aerocism-20", sortOrder: 13 },
    { image: "aerocism-21", sortOrder: 20 },
    { image: "aerocism-22", sortOrder: 42 },
    { image: "aerocism-23", sortOrder: 22 },
    { image: "aerocism-24", sortOrder: 23 },
    { image: "aerocism-25", sortOrder: 4 },
    { image: "aerocism-26", sortOrder: 28 },
    { image: "aerocism-27", sortOrder: 29 },
    { image: "aerocism-28", sortOrder: 27 },
    { image: "aerocism-29", sortOrder: 2 },
    { image: "aerocism-31", sortOrder: 41 },
    { image: "aerocism-32", sortOrder: 40 },
    { image: "aerocism-33", sortOrder: 40 },
    { image: "aerocism-36", sortOrder: 39 },
    { image: "aerocism-37", sortOrder: 38 },
    { image: "aerocism-38", sortOrder: 30 },
    { image: "aerocism-39", sortOrder: 19 },
    { image: "aerocism-40", sortOrder: 20 },
    { image: "aerocism-41", sortOrder: 50 },
    { image: "aerocism-42", sortOrder: 21 },
    { image: "aerocism-43", sortOrder: 37 },
    { image: "aerocism-44", sortOrder: 31 },
    { image: "aerocism-45", sortOrder: 15 },
    { image: "aerocism-46", sortOrder: 47 },
    { image: "aerocism-47", sortOrder: 36 },
    { image: "aerocism-48", sortOrder: 24 },
    { image: "aerocism-49", sortOrder: 48 },
    { image: "aerocism-50", sortOrder: 49 },
    { image: "aerocism-51", sortOrder: 5 },
    { image: "aerocism-52", sortOrder: 7 },
    { image: "aerocism-53", sortOrder: 17 },
    { image: "aerocism-54", sortOrder: 25 },
    { image: "aerocism-81", sortOrder: 8 }
];


function buildXFolioSlides() {
    const sortMap = makeSortMap(XFOLIO_SORT);

    return (XFOLIO_META || []).map((m, index) => {
        const imageKey = String(m.image || "").trim();
        const loc = LOCATIONS[m.locationKey] || "";
        const { imageLarge, thumbnail } = buildGalleryPaths(imageKey);

        return {
            image: imageKey,
            sortOrder: sortMap.has(imageKey) ? sortMap.get(imageKey) : index + 1,

            locationKey: m.locationKey || "",
            location: loc,
            aircraft: m.aircraft || "",
            alt: m.alt || "",
            tags: normalizeTags(m.tags),

            title: m.title || "",
            description: m.description || "",

            imageLarge,
            thumbnail,

            active: m.active !== false,
        };
    });
}

export const xfolioSlides = buildXFolioSlides();













/* =========================================================
   XSwiper (hero slider)
   - Same idea: minimal repeated work
   - No manual IDs needed
   - Uses swiperKey => auto builds image path
   ========================================================= */

/* =========================================================
   XSwiper (hero slider) ✅ updated for 1-desk / 1-mob
   ========================================================= */

const XSWIPER_META = [
    {
        swiperKey: "1",
        title: "You won't see them,",
        subtitle: "You'll feel them",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Fighter jet launching with afterburner at night.",
    },
    {
        swiperKey: "2",
        title: "Aerocism",
        subtitle: "Defense",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Military jet taking off at night with afterburner.",
    },
    {
        swiperKey: "3",
        title: "Aerocism",
        subtitle: "Defense",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Military jet in a dramatic night scene.",
    },
    {
        swiperKey: "4",
        title: "Aerocism",
        subtitle: "Defense",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Fighter aircraft at speed in low light.",
    },
    {
        swiperKey: "5",
        title: "Aerocism",
        subtitle: "Defense",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Jet aircraft in a cinematic night frame.",
    },
    {
        swiperKey: "6",
        title: "Aerocism",
        subtitle: "Defense",
        description: "Night launch imagery for high-tempo air operations.",
        alt: "Jet taking off with heat shimmer and flame.",
    }
];

const XSWIPER_SORT = [
    { image: "1", sortOrder: 1 },
    { image: "2", sortOrder: 2 },
    { image: "3", sortOrder: 3 },
    { image: "4", sortOrder: 4 },
    { image: "5", sortOrder: 5 },
    { image: "6", sortOrder: 6 },
];

function buildXSwiperSlides() {
    const sortMap = makeSortMap(XSWIPER_SORT);

    return (XSWIPER_META || []).map((s, index) => {
        const key = String(s.swiperKey || "").trim(); // "1"
        const { deskImage, mobImage } = buildSwiperPaths(key);

        return {
            swiperKey: key,
            sortOrder: sortMap.has(key) ? sortMap.get(key) : index + 1,

            active: s.active !== false,

            deskImage,
            mobImage,

            title: s.title || "",
            subtitle: s.subtitle || "",
            description: s.description || "",
            alt: s.alt || s.title || "",
        };
    });
}

export const xswiperSlides = buildXSwiperSlides();