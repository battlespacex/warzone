// assets/scripts/images-data.js
/* =========================================================
   Single source of truth for BOTH:
   1) XFolio gallery (grid + lightbox)
   2) XSwiper hero slider

   Final rules:
   - Gallery FULL images: assets/images/gallery/fullhd/  (JPG)
   - Gallery THUMB images: assets/images/gallery/thumbnail/ (WEBP)
   - XSwiper images: assets/images/gallery/swiper/ (WEBP)
     Each slide has TWO files:
       1-desk.webp   (desktop)
       1-mob.webp    (mobile)
   ========================================================= */

const PATHS = {
    galleryHdDir: "assets/images/gallery/fullhd/",
    galleryHdSuffix: "-full-hd",
    galleryHdExt: ".jpg",

    galleryThumbDir: "assets/images/gallery/thumbnail/",
    galleryThumbSuffix: "-thumb",
    galleryThumbExt: ".webp",

    swiperDir: "assets/images/gallery/swiper/",
    swiperExt: ".webp",
};

export const LOCATIONS = {
    LDN_ON_CA: "London, Ontario, Canada",
    TOR_ON_CA: "Toronto, Ontario, Canada",
    ISB_PK: "Islamabad, Pakistan",
};

/* =========================================================
   Path builders
   ========================================================= */

function buildGalleryPaths(imageKey) {
    const key = String(imageKey || "").trim();
    return {
        imageLarge: `${PATHS.galleryHdDir}${key}${PATHS.galleryHdSuffix}${PATHS.galleryHdExt}`,
        thumbnail: `${PATHS.galleryThumbDir}${key}${PATHS.galleryThumbSuffix}${PATHS.galleryThumbExt}`,
    };
}

function buildSwiperPaths(swiperKey) {
    const key = String(swiperKey || "").trim();
    return {
        deskImage: `${PATHS.swiperDir}${key}-desk${PATHS.swiperExt}`,
        mobImage: `${PATHS.swiperDir}${key}-mob${PATHS.swiperExt}`,
    };
}

/* =========================================================
   Utilities
   ========================================================= */

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

/**
 * Sequence-based order map (XFolio)
 * Array position === sort order
 */
function makeOrderMap(orderList) {
    const map = new Map();
    (orderList || []).forEach((key, index) => {
        map.set(String(key).trim(), index + 1);
    });
    return map;
}

/**
 * Numeric sort map (XSwiper)
 */
function makeSortMap(list) {
    const map = new Map();
    (list || []).forEach((x) => {
        if (!x) return;

        const rawKey = x.image ?? x.swiperKey;
        if (rawKey === undefined || rawKey === null) return;

        const key = String(rawKey).trim();
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
        title: "Undetected and Unchallenged, The Raptor approaches the Battlespace",
        image: "aerocism-1",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor stealth fighter low pass at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, lockheed martin, stealth fighter, fifth generation fighter, air dominance, afterburner, airshow photography, military aviation, fast jet, raptor demo, aviation enthusiast, united states air force, usaf, f-22 demo team",
    },
    {
        title: "Freezing the Pirate of the Battlespace",
        image: "aerocism-2",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor banking through cloud during London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, lockheed martin, stealth fighter, fifth generation fighter, raptor, airshow pass, afterburner, military aviation, jet photography, united states air force, usaf, f-22 demo team",
    },
    {
        title: "Steel wings carry shades, what an excellent day for an aerocism",
        image: "aerocism-3",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker aerial refueling tanker on the runway at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, united states air force, aerial refueling, tanker aircraft, runway shot, military transport, airshow static, aviation photography",
    },
    {
        title: "Steel wings carry shades, what an excellent day for an aerocism",
        image: "aerocism-4",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "Close-up of USAF KC-135 Stratotanker nose and cockpit on the ramp at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, united states air force, nose detail, cockpit closeup, aerial refueling, tanker aircraft, military aviation, aviation photography",
    },
    {
        title: "It's not the plane, It's the pilot! ",
        image: "aerocism-5",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Super Hornet",
        alt: "U.S. Navy F/A-18 Super Hornet breaking through clouds during London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f/a-18 super hornet, super hornet, us navy, fighter jet, vapor, cloud break, airshow demo, high performance jet, military aviation, jet photography, cinematic aviation",
    },
    {
        title: "Apex Tilt-Rotor — Born to Hover, Built to Dominate",
        image: "aerocism-6",
        locationKey: "LDN_ON_CA",
        aircraft: "V-22 Osprey",
        alt: "Bell Boeing V-22 Osprey tiltrotor aircraft in flight at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, v-22 osprey, bell boeing, tiltrotor, military rotorcraft, airshow display, aviation photography, us military, vertical lift, tactical aviation",
    },
    {
        title: "The most iconic American fighter of WWll",
        image: "aerocism-7",
        locationKey: "LDN_ON_CA",
        aircraft: "P-51 Mustang",
        alt: "North American P-51 Mustang World War II warbird flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, p-51 mustang, north american aviation, warbird, wwii aircraft, ww2 fighter, propeller fighter, heritage flight, airshow pass, classic aviation, aviation photography",
    },
    {
        title: "Built to evade radars and enforce airpower supremacy over adversaries",
        image: "aerocism-8",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "Lockheed Martin F-35A Lightning II stealth fighter in flight at the CNE Airshow in Toronto, Ontario",
        tags: "toronto, ontario, canada, cne, canadian national exhibition, cne airshow, canadian international air show, toronto airshow, f-35 lightning ii, f-35a, lockheed martin, stealth fighter, fifth generation fighter, jet photography, airshow photography, toronto waterfront, f-35 demo team",
    },
    {
        title: "The Gladiator strike squad striking through enemy air defenses",
        image: "aerocism-9",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "U.S. Navy F/A-18 Hornet from VFA-203 flying a close pass at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, hornet, us navy, vfa-203, strike fighter squadron 203, fighter jet, low pass, airshow photography, military aviation, tactical jet, jet photography",
    },
    {
        title: "Swift guardian above the waves, The Jayhawk never rests",
        image: "aerocism-10",
        locationKey: "LDN_ON_CA",
        aircraft: "MH-60 Jayhawk",
        alt: "U.S. Coast Guard MH-60 Jayhawk search-and-rescue helicopter in flight at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, mh-60 jayhawk, sikorsky, us coast guard, search and rescue, sar helicopter, rescue hoist, airshow display, helicopter photography, military aviation",
    },
    {
        title: "Wings of precision - the art of speed and symmetry",
        image: "aerocism-12",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "U.S. Navy Blue Angels F/A-18 Super Hornets flying in tight formation at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, formation flying, aerobatics, airshow team, precision flying, jet formation, airshow photography",
    },
    {
        title: "Built for Every Sky, Every Fight!",
        image: "aerocism-13",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "USAF F-35 Lightning II banking during a demo pass at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, toronto airshow, f-35 lightning ii, lockheed martin, stealth fighter, banking turn, fast jet, aviation photography, airshow pass, usaf, f-35 demo team",
    },
    {
        title: "Raptors Breakoff - Splitting the sky above all!",
        image: "aerocism-14",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "Two USAF F-22 Raptor stealth fighters crossing in the sky during London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, formation pass, crossover, fighter jets, high speed, military aviation, jet photography, aerial display, cinematic sky, usaf, f-22 demo team",
    },
    {
        title: "Seamlessly fusing intelligence and operations to command every domain of the battlespace",
        image: "aerocism-15",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II close-up pass over Toronto during the CNE Airshow with stealth fighter profile view",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-35 lightning ii, lockheed martin, stealth fighter, fifth generation fighter, close pass, nose profile, modern fighter jet, airshow photography, jet closeup, f-35 demo team",
    },
    {
        title: "Predators of the North — RCAF, Close, Fast and Lethal ",
        image: "aerocism-16",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Two Royal Canadian Air Force CF-18 Hornets flying formation at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, formation flying, fighter jets, airshow demo, military aviation, jet formation, aviation photography",
    },
    {
        title: "Boom down - extending the reach of fighters and bombers to dominate every sky",
        image: "aerocism-17",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker aerial refueling tanker aircraft flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, united states air force, aerial refueling, tanker aircraft, airshow flyby, military aviation, large aircraft, aviation photography",
    },
    {
        title: "Raptor one airborne off runway three-three, climbing north",
        image: "aerocism-18",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor low pass during takeoff sequence at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, low pass, stealth fighter, afterburner, airshow display, cinematic clouds, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Raptor one airborne off runway three-three, climbing north",
        image: "aerocism-19",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor banking low during a high-speed turn at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, banking turn, stealth fighter, airshow photography, military aviation, fast jet, dramatic sky, aerocism, usaf, f-22 demo team",
    },
    {
        title: "Every Ace needs a Wingman - Bear Force One",
        image: "aerocism-20",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "U.S. Navy F/A-18 Hornet cockpit close-up from VFA-203 at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, hornet, us navy, vfa-203, cockpit closeup, fighter jet, airshow photography, military aviation, tactical jet, jet photography",
    },
    {
        title: "Two warriors, one machine of steel and fire!",
        image: "aerocism-21",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "U.S. Navy F/A-18 Hornet taxiing with canopy open at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, hornet, us navy, taxiing, canopy open, fighter jet, airshow ramp, military aviation, aviation photography, vfa-203",
    },
    {
        title: "The platform shaping the warriors who will master SIGINT and ELINT ops across the battlespace",
        image: "aerocism-22",
        locationKey: "LDN_ON_CA",
        aircraft: "TC-135",
        alt: "USAF TC-135 training and reconnaissance aircraft parked on the ramp at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, tc-135, rc-135, boeing, usaf, united states air force, reconnaissance aircraft, intelligence aircraft, training platform, airshow static, ramp shot, aviation photography",
    },
    {
        title: "The Fighting Falcons - line of sleek multi-role fighter, showcasing power and precision",
        image: "aerocism-23",
        locationKey: "LDN_ON_CA",
        aircraft: "F-16 Fighting Falcon",
        alt: "F-16 Fighting Falcon on static display parked on the tarmac at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-16 fighting falcon, static display, fighter jet, multirole fighter, tarmac, airshow ramp, military aviation, aircraft detail, aviation photography, usaf",
    },
    {
        title: "Air-to-Air Dominance on Display — Weapons of Air Superiority",
        image: "aerocism-24",
        locationKey: "LDN_ON_CA",
        aircraft: "F-16 Fighting Falcon",
        alt: "F-16 Fighting Falcon on the ramp at London Airshow 2025 in London, Ontario with air superiority loadout on display",
        tags: "london airshow 2025, london ontario, canada, f-16 fighting falcon, static display, fighter jet, air superiority, weapons display, tarmac, airshow ramp, military aviation, aircraft detail, aviation photography, usaf",
    },
    {
        title: "Painted in heritage, forged in power, a national symbol of strength and speed",
        image: "aerocism-25",
        locationKey: "TOR_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet in special livery banking during a pass at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, cf-18 hornet, rcaf, royal canadian air force, special livery, solo pass, banking turn, aerobatics, jet photography, aviation photography",
    },
    {
        title: "This is not a stunt. This is a duel with gravity!",
        image: "aerocism-26",
        locationKey: "TOR_ON_CA",
        aircraft: "Aerobatic aircraft",
        alt: "Aerobatic aircraft drawing a smoke pattern during an airshow performance at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, aerobatics, smoke trail, smoke pattern, airshow performance, stunt flying, sky art, aviation photography, airshow action",
    },
    {
        title: "The demon enforces chaos while roaring in the sky!",
        image: "aerocism-27",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor deploying flares during a defensive maneuver at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, flares, defensive countermeasures, airshow demo, fighter jet, dramatic action, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "The Ghost whispering through the sky",
        image: "aerocism-28",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor high-alpha pass with vapor over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-22 raptor, stealth fighter, high alpha, vapor, airshow demo, fast jet, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Sonic Fury blazing across the horizon in a roar of speed",
        image: "aerocism-29",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor high-speed pass over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-22 raptor, stealth fighter, high speed pass, airshow demo, fast jet, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Wings that don’t just fly — they sustain the fight",
        image: "aerocism-31",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker taking off at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, united states air force, aerial refueling, tanker aircraft, takeoff, runway shot, military aviation, aviation photography",
    },
    {
        title: "Synchronized speed. Flawless discipline — the Blue Angels",
        image: "aerocism-32",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "U.S. Navy Blue Angels diamond formation with F/A-18 Super Hornets at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, diamond formation, precision flying, formation aerobatics, airshow team, jet formation, airshow photography",
    },
    {
        title: "Ghosting the battlefield",
        image: "aerocism-33",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "USAF F-35 Lightning II high-speed pass over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, f-35 lightning ii, lockheed martin, stealth fighter, fifth generation fighter, fast jet, high speed pass, aviation photography, jet photography, usaf, f-35 demo team",
    },
    {
        title: "Canada’s frontline fighter guarding the northern skies",
        image: "aerocism-36",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet climbing after takeoff at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, fighter jet, takeoff, climb out, airshow demo, military aviation, jet photography, aerocism",
    },
    {
        title: "Turn and burn through the sky, pulling G’s through the merge",
        image: "aerocism-37",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor vertical climb in afterburner during London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, vertical climb, afterburner, airshow performance, high power, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Supremacy Forged in Flight, Stealth, Speed and Dominance!",
        image: "aerocism-38",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor banking through dramatic clouds at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, banking turn, clouds, air dominance, airshow demo, military aviation, cinematic aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Big boys. No noise. Just reach",
        image: "aerocism-39",
        locationKey: "LDN_ON_CA",
        aircraft: "KC-135 Stratotanker",
        alt: "USAF KC-135 Stratotanker climbing out in cloudy sky at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, kc-135 stratotanker, boeing, usaf, united states air force, tanker aircraft, climb out, airshow flyby, military aviation, aviation photography",
    },
    {
        title: "Hercules — The sky’s workhorse",
        image: "aerocism-40",
        locationKey: "TOR_ON_CA",
        aircraft: "CC-130 Hercules",
        alt: "Royal Canadian Air Force CC-130 Hercules tactical transport aircraft landing approach in Toronto, Ontario",
        tags: "toronto, ontario, canada, cc-130 hercules, hercules, rcaf, royal canadian air force, transport aircraft, tactical airlift, cargo plane, aircraft landing, aviation photography",
    },
    {
        title: "Twin Tank busters cutting through the dark",
        image: "aerocism-41",
        locationKey: "ISB_PK",
        aircraft: "AH-1 Cobra Gunship",
        alt: "Pakistan Army Aviation AH-1 Cobra gunship helicopters flying in formation over Islamabad, Pakistan",
        tags: "ah-1 cobra, cobra gunship, attack helicopter, pakistan army aviation, army aviation, rotary wing, gunship helicopter, formation flight, military helicopters, tactical aviation, islamabad, pakistan, aerocism",
    },
    {
        title: "You don’t hear it. You feel it",
        image: "aerocism-42",
        locationKey: "LDN_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "Lockheed Martin F-35 Lightning II stealth fighter carving through vapor and storm clouds at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f-35 lightning ii, lockheed martin, stealth fighter, fifth generation fighter, vapor, dramatic clouds, airshow demo, military aviation, jet photography, cinematic aviation, aerocism",
    },
    {
        title: "Solo snap roll vibes — Blue Angels cut the clouds",
        image: "aerocism-43",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "U.S. Navy Blue Angels F/A-18 Super Hornet solo jet banking through clouds at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, solo pass, aerobatics, banking turn, cloudy sky, jet photography, aviation photography",
    },
    {
        title: "Signatures without visibility",
        image: "aerocism-44",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "Two USAF F-22 Raptor stealth fighters flying in formation over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, f-22 raptor, stealth fighter, formation flying, flyby, air dominance, military aviation, jet photography, toronto waterfront, usaf, f-22 demo team",
    },
    {
        title: "Flying closer than fear allows",
        image: "aerocism-45",
        locationKey: "TOR_ON_CA",
        aircraft: "Blue Angels F/A-18 Super Hornet",
        alt: "U.S. Navy Blue Angels F/A-18 Super Hornets flying in close formation at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, blue angels, us navy, f/a-18 super hornet, close formation, precision flying, formation aerobatics, airshow team, jet formation, aviation photography",
    },
    {
        title: "Art at velocity",
        image: "aerocism-46",
        locationKey: "TOR_ON_CA",
        aircraft: "Aerobatic smoke trails",
        alt: "Aerobatic smoke trails painting curved patterns over Toronto during the CNE Airshow",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, aerobatics, smoke trails, sky patterns, airshow spectacle, aerial display, toronto waterfront, aviation photography, airshow action",
    },
    {
        title: "Heritage crossover — Time in formation",
        image: "aerocism-47",
        locationKey: "TOR_ON_CA",
        aircraft: "P-51 Mustang and F-22 Raptor",
        alt: "USAF F-22 Raptor stealth fighter low pass with afterburner at an airshow, cinematic aviation photography",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, heritage flight, p-51 mustang, f-22 raptor, warbird, jet and prop, formation flying, classic aviation, modern fighter, aviation photography",
    },
    {
        title: "F-22 Raptor - Apex in motion",
        image: "aerocism-48",
        locationKey: "TOR_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor banking with metallic sheen during the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, f-22 raptor, stealth fighter, banking turn, airshow demo, fighter jet, dramatic lighting, military aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Low over hostile water, eyes locked on survival",
        image: "aerocism-49",
        locationKey: "TOR_ON_CA",
        aircraft: "CH-146 Griffon",
        alt: "Royal Canadian Air Force CH-146 Griffon utility helicopter flying low over water during an airshow display",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, ch-146 griffon, griffon helicopter, bell 412, rcaf, royal canadian air force, utility helicopter, rotorcraft, low level flight, over water, tactical aviation, airshow display, aviation photography",
    },
    {
        title: "The sky goes quiet for a reason",
        image: "aerocism-50",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "F-35 Lightning II stealth fighter surrounded by vapor during a high-energy maneuver at London Airshow 2025 in London, Ontario",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show,  canada, f-35 lightning ii, f-35, lockheed martin, stealth fighter, fifth generation fighter, vapor cone, high alpha, airshow demo, fast jet, military aviation, jet photography, cinematic aviation",
    },
    {
        title: "The Skies, Frozen",
        image: "aerocism-51",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor low-fly past",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, banking turn, clouds, air dominance, airshow demo, military aviation, cinematic aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "Legacy Forged at Full Throttle",
        image: "aerocism-52",
        locationKey: "TOR_ON_CA",
        aircraft: "P-51 Mustang",
        alt: "North American P-51 Mustang World War II warbird flying during a heritage pass at the CNE Airshow in Toronto",
        tags: "toronto, ontario, canada, cne airshow, canadian international air show, p-51 mustang, north american aviation, warbird, ww2 fighter, propeller aircraft, heritage flight, classic aviation, historic aircraft, aviation photography, aerocism",
    },
    {
        title: "Ghosted at altitude",
        image: "aerocism-53",
        locationKey: "TOR_ON_CA",
        aircraft: "F-35 Lightning II",
        alt: "Lockheed Martin F-35 Lightning II stealth fighter flying over the Toronto waterfront during the CNE Airshow",
        tags: "toronto, ontario, canada, cne, cne airshow, canadian international air show, f-35 lightning ii, lockheed martin, stealth fighter, fifth generation fighter, modern air combat, airshow demo, toronto waterfront, military aviation, jet photography, aerocism",
    },
    {
        title: "The Sound of Sovereignty",
        image: "aerocism-54",
        locationKey: "TOR_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet banking through haze during a high-energy pass at the London Airshow 2025",
        tags: "ltoronto, ontario, canada, cne airshow, canadian international air show, canada, cf-18 hornet, rcaf, royal canadian air force, fighter jet, banking turn, airshow pass, fast jet, military aviation, jet photography, aerocism",
    },
    {
        title: "Rotors Built for the Fight",
        image: "aerocism-81",
        locationKey: "ISB_PK",
        aircraft: "AH-1 Cobra Gunship",
        alt: "Pakistan Army Aviation AH-1 Cobra attack helicopter gunships flying in formation during a tactical display",
        tags: "ah-1 cobra, cobra gunship, attack helicopter, pakistan army aviation, army aviation, rotary wing, close air support, gunship helicopter, military helicopters, tactical aviation, low level flight, aerocism",
    },
    {
        title: "Ghosts in the Throttle",
        image: "aerocism-83",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor deploying flares during an airshow maneuver over Toronto",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, flares, defensive countermeasures, airshow demo, fighter jet, dramatic lighting, military aviation, jet photography, united states air force, usaf, f-22 demo team",
    },
    {
        title: "Steel ripping the battlespace at Mach. Cleared hot",
        image: "aerocism-84",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, formation flying, fighter jets, airshow demo, military aviation, jet formation, aviation photography",
    },
    {
        title: "Burners blazing in vengeance",
        image: "aerocism-85",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, formation flying, fighter jets, airshow demo, military aviation, jet formation, aviation photography",
    },
    {
        title: "",
        image: "aerocism-86",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, formation flying, fighter jets, airshow demo, military aviation, jet formation, aviation photography",
    },
    {
        title: "",
        image: "aerocism-87",
        locationKey: "LDN_ON_CA",
        aircraft: "CF-18 Hornet",
        alt: "Royal Canadian Air Force CF-18 Hornet flying at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, cf-18 hornet, rcaf, royal canadian air force, formation flying, fighter jets, airshow demo, military aviation, jet formation, aviation photography",
    },
    {
        title: "A brutal power climb - Thrust vs Gravity",
        image: "aerocism-88",
        locationKey: "LDN_ON_CA",
        aircraft: "F-22 Raptor",
        alt: "USAF F-22 Raptor climb",
        tags: "london airshow 2025, london ontario, canada, f-22 raptor, stealth fighter, banking turn, clouds, air dominance, airshow demo, military aviation, cinematic aviation, jet photography, usaf, f-22 demo team",
    },
    {
        title: "USAF TC-135 Rivet Joint testbed - Eyes in the sky",
        image: "aerocism-89",
        locationKey: "LDN_ON_CA",
        aircraft: "TC-135",
        alt: "USAF TC-135 training and reconnaissance aircraft parked on the ramp at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, tc-135, rc-135, boeing, usaf, united states air force, reconnaissance aircraft, intelligence aircraft, training platform, airshow static, ramp shot, aviation photography",
    }, 
    {
        title: "Two worlds. Shared sky. From waves to shockwaves.",
        image: "aerocism-91",
        locationKey: "LDN_ON_CA",
        aircraft: "F/A-18 Hornet",
        alt: "U.S. Navy F/A-18 Hornet from VFA-203 flying a close pass at London Airshow 2025 in London, Ontario",
        tags: "london airshow 2025, london ontario, canada, f/a-18 hornet, hornet, us navy, vfa-203, strike fighter squadron 203, fighter jet, low pass, airshow photography, military aviation, tactical jet, jet photography",
    },
];

/**
 * XFolio order
 * Order is defined ONLY by sequence
 */
const XFOLIO_SORT = [
    "aerocism-2",
    "aerocism-29",
    "aerocism-16",
    "aerocism-25",
    "aerocism-51",
    "aerocism-8",
    "aerocism-52",
    "aerocism-81",
    "aerocism-10",
    "aerocism-12",
    "aerocism-15",
    "aerocism-20",
    "aerocism-45",
    "aerocism-85",
    "aerocism-88",
    "aerocism-9",
    "aerocism-53",
    "aerocism-5",
    "aerocism-39",
    "aerocism-21",
    "aerocism-40",
    "aerocism-23",
    "aerocism-24",
    "aerocism-48",
    "aerocism-54",
    "aerocism-84",
    "aerocism-14",
    "aerocism-28",
    "aerocism-26",
    "aerocism-87",
    "aerocism-86",
    "aerocism-38",
    "aerocism-44",
    "aerocism-7",
    "aerocism-6",
    "aerocism-18",
    "aerocism-17",
    "aerocism-47",
    "aerocism-43",
    "aerocism-37",
    "aerocism-36",
    "aerocism-32",
    "aerocism-33",
    "aerocism-31",
    "aerocism-22",
    "aerocism-1",
    "aerocism-3",
    "aerocism-4",
    "aerocism-46",
    "aerocism-49",
    "aerocism-50",
    "aerocism-41",
];

function buildXFolioSlides() {
    const orderMap = makeOrderMap(XFOLIO_SORT);

    return (XFOLIO_META || []).map((m, index) => {
        const imageKey = String(m.image || "").trim();
        const loc = LOCATIONS[m.locationKey] || "";
        const { imageLarge, thumbnail } = buildGalleryPaths(imageKey);

        return {
            image: imageKey,
            sortOrder: orderMap.has(imageKey)
                ? orderMap.get(imageKey)
                : 1000 + index,

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
   ========================================================= */

const XSWIPER_META = [
    {
        swiperKey: "1",
        title: "The Skies,",
        subtitle: "Frozen",
        description: "Before",
        alt: "Cinematic composite of USAF CV-22 Osprey, F-22 Raptor, F/A-18 Super Hornet, and TC-135 aircraft in flight",
    },
    {
        swiperKey: "2",
        title: "Before the",
        subtitle: "Shockwave",
        description: "Before the Shockwave",
        alt: "USAF F-22 Raptor stealth fighter low pass with afterburner",
    },
    {
        swiperKey: "3",
        title: "Every Ace needs",
        subtitle: "a Wingman",
        description: "Every Ace needs a Wingman",
        alt: "U.S. Navy F/A-18 Super Hornet flying a close pass",
    },
    {
        swiperKey: "4",
        title: "Predator of",
        subtitle: "the North",
        description: "Predator of the North",
        alt: "Royal Canadian Air Force CF-18 Hornets in formation",
    },
    {
        swiperKey: "5",
        title: "Ghosting the",
        subtitle: "Battlefield",
        description: "Ghosting the Battlefield",
        alt: "Stealth fighter slicing through the sky with vapor",
    },
    {
        swiperKey: "6",
        title: "The sound of",
        subtitle: "Dominance",
        description: "The sound of Dominance",
        alt: "P-51 Mustang WWII warbird in flight",
    },
    {
        swiperKey: "7",
        title: "Born to",
        subtitle: "Hover",
        description: "Born to Hover",
        alt: "V-22 Osprey tiltrotor aircraft in flight",
    },
    {
        swiperKey: "8",
        title: "Steel wings",
        subtitle: "Airborne",
        description: "Steel wings airborne",
        alt: "USAF F-22 Raptor taking off from the runway",
    },
];

const XSWIPER_SORT = [
    { swiperKey: "1", sortOrder: 1 },
    { swiperKey: "2", sortOrder: 2 },
    { swiperKey: "3", sortOrder: 3 },
    { swiperKey: "4", sortOrder: 4 },
    { swiperKey: "5", sortOrder: 5 },
    { swiperKey: "6", sortOrder: 6 },
    { swiperKey: "7", sortOrder: 7 },
    { swiperKey: "8", sortOrder: 8 },
];

function buildXSwiperSlides() {
    const sortMap = makeSortMap(XSWIPER_SORT);

    return (XSWIPER_META || []).map((s, index) => {
        const key = String(s.swiperKey || "").trim();
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