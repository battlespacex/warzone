// apps/worker/src/conflict-filter.js
// StratOps conflict + military technology + weapons procurement filter.
// Goal: keep operational conflict, military movements, military tech, weapons programs,
// defense contracts, arms deals, procurement, and strategic posture.
// Reject local crime, police shootings, school shootings, hospital/pension/admin/HR,
// veteran lifestyle, ceremonies, sports, awards, and generic military community news.

const MILITARY_KEYWORDS = [
  // Core conflict
  "war",
  "conflict",
  "armed conflict",
  "clash",
  "clashes",
  "fighting",
  "battle",
  "frontline",
  "combat",
  "hostilities",
  "offensive",
  "counteroffensive",
  "invasion",
  "incursion",
  "ceasefire",
  "truce",
  "escalation",

  // Weapons / attacks
  "missile",
  "rocket",
  "drone",
  "uav",
  "airstrike",
  "air strike",
  "missile strike",
  "drone strike",
  "bombardment",
  "shelling",
  "artillery",
  "explosion",
  "blast",
  "munition",
  "ballistic",
  "cruise missile",
  "tomahawk",
  "hypersonic",

  // Military forces
  "military operation",
  "army",
  "navy",
  "air force",
  "troops",
  "soldiers",
  "brigade",
  "battalion",
  "division",
  "defense ministry",
  "defence ministry",
  "ministry of defense",
  "ministry of defence",

  // Air domain
  "fighter jet",
  "fighter aircraft",
  "combat aircraft",
  "bomber",
  "attack helicopter",
  "helicopter",
  "airbase",
  "air base",
  "air defense",
  "air defence",
  "sam system",
  "patriot system",

  // Naval domain
  "warship",
  "naval operation",
  "frigate",
  "destroyer",
  "submarine",
  "aircraft carrier",
  "carrier strike group",
  "red sea",
  "strait",
  "maritime security",

  // Land domain
  "tank",
  "armored vehicle",
  "armoured vehicle",
  "military convoy",
  "border clash",
  "checkpoint",
  "ground offensive",

  // Strategic
  "nuclear",
  "mobilization",
  "mobilisation",
  "sanctions",
  "proxy force",
  "militia",
  "insurgent",
  "rebel",
  "terrorist",
  "terror attack",
  "terrorism",
  "paramilitary",
  "armed group",
  "war crime",
  "war crimes",
  "civilian casualties",
  "humanitarian corridor",
  "aid convoy",
  "evacuation order",

  // Military technology / procurement / weapons industry
  "defense contract",
  "defence contract",
  "contract award",
  "arms deal",
  "arms sales",
  "weapons deal",
  "weapon deal",
  "weapon system",
  "weapons system",
  "weapons package",
  "military aid package",
  "security assistance package",
  "foreign military sale",
  "foreign military sales",
  "fms",
  "procurement",
  "acquisition",
  "defense acquisition",
  "defence acquisition",
  "defense industry",
  "defence industry",
  "defense technology",
  "defence technology",
  "military technology",
  "military tech",
  "defense startup",
  "defence startup",
  "prototype",
  "test flight",
  "flight test",
  "weapons test",
  "missile test",
  "drone test",
  "radar system",
  "sensor system",
  "counter-drone",
  "counter drone",
  "c-uas",
  "counter-uas",
  "anti-drone",
  "uas",
  "loitering munition",
  "unmanned system",
  "autonomous system",
  "combat vehicle",
  "armored combat vehicle",
  "armoured combat vehicle",
  "air defense system",
  "air defence system",
  "rocket artillery",
  "howitzer",
  "ammunition production",
  "munition production",
  "munitions production",
  "shipbuilding",
  "naval shipbuilding",
  "submarine program",
  "fighter program",

  // Cyber / infrastructure
  "cyberattack",
  "cyber attack",
  "cyber operation",
  "cyber operations",
  "hack",
  "malware",
  "internet outage",
  "power grid attack",
  "infrastructure attack"
];

const HIGH_VALUE_KEYWORDS = [
  // Operational conflict
  "airstrike",
  "air strike",
  "missile strike",
  "drone strike",
  "cyberattack",
  "cyber attack",
  "cyber operation",
  "cyber operations",
  "shelling",
  "artillery",
  "bombardment",
  "warship",
  "fighter jet",
  "fighter aircraft",
  "air defense",
  "air defence",
  "ballistic",
  "nuclear",
  "border clash",
  "invasion",
  "offensive",
  "ceasefire",
  "carrier strike group",
  "submarine",
  "destroyer",
  "frigate",
  "tomahawk",
  "iranian-flagged tanker",
  "iranian flagged tanker",

  // Military tech / weapons / deals
  "defense contract",
  "defence contract",
  "contract award",
  "arms deal",
  "arms sales",
  "weapons deal",
  "weapons package",
  "military aid package",
  "security assistance package",
  "foreign military sale",
  "foreign military sales",
  "procurement",
  "acquisition",
  "weapon system",
  "weapons system",
  "missile defense",
  "missile defence",
  "air defense system",
  "air defence system",
  "radar system",
  "counter-drone",
  "counter drone",
  "counter-uas",
  "c-uas",
  "anti-drone",
  "loitering munition",
  "unmanned system",
  "combat vehicle",
  "ammunition production",
  "munitions production",
  "shipbuilding",
  "fighter program",
  "submarine program"
];

// These are the signals StratOps should care about.
// Includes both active conflict and military tech/procurement signals.
const HARD_CONFLICT_KEYWORDS = [
  // Operational conflict
  "war",
  "conflict",
  "armed conflict",
  "clash",
  "clashes",
  "fighting",
  "frontline",
  "combat",
  "invasion",
  "incursion",
  "airstrike",
  "air strike",
  "missile strike",
  "drone strike",
  "missile",
  "rocket",
  "drone",
  "uav",
  "cyberattack",
  "cyber attack",
  "cyber operation",
  "cyber operations",
  "shelling",
  "artillery",
  "bombardment",
  "explosion",
  "military operation",
  "ground offensive",
  "tank",
  "warship",
  "submarine",
  "fighter jet",
  "fighter aircraft",
  "bomber",
  "air defense",
  "air defence",
  "ballistic",
  "nuclear",
  "border clash",
  "ceasefire",
  "mobilization",
  "mobilisation",
  "militia",
  "insurgent",
  "rebel",
  "terrorist",
  "terror attack",
  "terrorism",
  "tomahawk",
  "carrier strike group",
  "armed group",
  "war crime",
  "war crimes",
  "civilian casualties",
  "humanitarian corridor",
  "aid convoy",
  "evacuation order",

  // Military tech / weapons / deals
  "defense contract",
  "defence contract",
  "contract award",
  "arms deal",
  "arms sales",
  "weapons deal",
  "weapon deal",
  "weapons package",
  "military aid package",
  "security assistance package",
  "foreign military sale",
  "foreign military sales",
  "procurement",
  "defense acquisition",
  "defence acquisition",
  "weapon system",
  "weapons system",
  "military technology",
  "military tech",
  "defense technology",
  "defence technology",
  "missile defense",
  "missile defence",
  "air defense system",
  "air defence system",
  "radar system",
  "counter-drone",
  "counter drone",
  "counter-uas",
  "c-uas",
  "anti-drone",
  "loitering munition",
  "unmanned system",
  "combat vehicle",
  "ammunition production",
  "munition production",
  "munitions production",
  "shipbuilding",
  "naval shipbuilding",
  "fighter program",
  "submarine program",
  "hypersonic",
  "test flight",
  "flight test",
  "weapons test",
  "missile test",
  "drone test"
];

// These terms are allowed to score only when paired with hard conflict,
// military tech, procurement, or weapons signals.
const SOFT_MILITARY_ONLY_KEYWORDS = [
  "army",
  "navy",
  "air force",
  "military",
  "troops",
  "soldiers",
  "defense",
  "defence",
  "commander",
  "training",
  "exercise",
  "base",
  "veteran",
  "warrior"
];

const NEGATIVE_KEYWORDS = [
  // General non-conflict noise
  "sports",
  "football",
  "super bowl",
  "cricket",
  "basketball",
  "baseball",
  "hockey",
  "celebrity",
  "movie",
  "music",
  "fashion",
  "recipe",
  "weather",
  "earnings",
  "stock market",
  "crypto",
  "gaming",
  "festival",
  "concert",
  "tourism",
  "travel",
  "restaurant",
  "school board",
  "election campaign",
  "opinion column",

  // Local crime / police / civilian crime noise
  "police said",
  "police say",
  "police officer",
  "police officers",
  "police department",
  "sheriff",
  "deputies",
  "911 call",
  "crime scene",
  "crime stoppers",
  "suspect arrested",
  "arrested",
  "arrest",
  "charged with",
  "charges filed",
  "court appearance",
  "court hearing",
  "court case",
  "trial begins",
  "sentenced",
  "convicted",
  "lawsuit",
  "robbery",
  "burglary",
  "carjacking",
  "home invasion",
  "domestic violence",
  "domestic dispute",
  "road rage",
  "gang shooting",
  "gang violence",
  "mass shooting",
  "school shooting",
  "campus shooting",
  "city shooting",
  "downtown shooting",
  "bar shooting",
  "mall shooting",
  "nightclub shooting",
  "workplace shooting",
  "shot dead",
  "shot and killed",
  "fatally shot",
  "shooting victim",
  "homicide investigation",
  "murder investigation",
  "murder trial",
  "stabbing",
  "knife attack",
  "abduction",
  "kidnapping",
  "missing person",
  "amber alert",
  "human trafficking",
  "drug bust",
  "drug trafficking",
  "fentanyl",
  "cartel",
  "prison",
  "jail",
  "inmate",
  "parole",

  // Civilian emergency / accident noise
  "car crash",
  "vehicle crash",
  "traffic accident",
  "train accident",
  "plane crash",
  "small plane",
  "house fire",
  "apartment fire",
  "wildfire evacuation",
  "flood warning",
  "earthquake",
  "hurricane",
  "tornado",
  "storm damage",

  // Military-adjacent human-interest/admin noise
  "suicide prevention",
  "mental health",
  "resiliency",
  "resilience",
  "care and advocacy",
  "care, advocacy",
  "medical service",
  "medical advances",
  "top doc",
  "doctor",
  "hospital",
  "clinic",
  "warrior games",
  "wounded warrior",
  "warrior recalls",
  "dark days",
  "bright future",
  "adaptive sports",
  "recovery program",
  "disability award",
  "award nominee",
  "award",
  "awards",
  "earns wings",
  "website focused",
  "family support",
  "veterans event",
  "veteran support",
  "memorial",
  "museum",
  "ceremony",
  "ceremonial",
  "training event",
  "photo story",
  "photo essay",
  "community",
  "anniversary",
  "heritage",
  "scholarship",
  "graduation",
  "graduate",
  "volunteer",
  "fitness",
  "chaplain",
  "spouse",
  "airman of the year",
  "military family",
  "family readiness",
  "child care",
  "day care",
  "food service",
  "morale",
  "welfare",
  "recreation",
  "keep focus on troops",
  "focus on troops",
  "unity of effort",
  "moving wounded",
  "wounded personnel",
  "career submariner",
  "selected to perform",
  "super bowl fare",
  "dod's top doc",
  "provides care",
  "advocacy for",

  // Military process / non-operational noise
  "cultural advisor",
  "cultural advisors",
  "world war ii",
  "wwii",
  "world war 2",
  "missing soldier",
  "missing airman",
  "recovery mission",
  "remains identified",
  "training exercise",
  "soldiers train",
  "soldiers training",
  "silent drill",
  "drill team",
  "basic training",
  "boot camp",
  "recruiting",
  "recruitment",
  "retirement ceremony",
  "promotion ceremony",
  "change of command",
  "assumption of command",
  "public affairs",
  "press release only",
  "rare public appearance",
  "minister makes rare",
  "rare public",
  "safe passage",

  // Pension / hospital / benefits / personnel admin noise
  "soldier hospital",
  "military hospital",
  "field hospital constructed",
  "hospital constructed",
  "hospital opens",
  "hospital expansion",
  "new hospital",
  "pension",
  "veteran pension",
  "soldier pension",
  "military pension",
  "benefits",
  "veterans benefits",
  "veteran benefits",
  "health benefits",
  "retirement benefits",
  "housing allowance",
  "pay raise",
  "military pay",
  "tuition assistance",
  "education benefits",
  "military spouse",
  "family benefits",
  "army hospital",
  "navy hospital",
  "air force hospital",
  "clinic opens",
  "medical clinic",
  "health care",
  "healthcare",
  "wellness",
  "well-being",
  "wellbeing",
  "quality of life",
  "housing project",
  "barracks renovation",
  "base housing",
  "child development center",
  "school liaison",
  "dependent care",
  "retiree",
  "retirees",
  "retired soldier",
  "retired airman",
  "retired sailor",
  "veteran affairs",
  "va benefits",
  "service members receive",
  "service member receives"
];

const CATEGORY_RULES = {
  air: [
    "airstrike",
    "air strike",
    "fighter jet",
    "fighter aircraft",
    "combat aircraft",
    "bomber",
    "helicopter",
    "airbase",
    "air base",
    "air defense",
    "air defence",
    "missile",
    "drone",
    "uav"
  ],

  naval: [
    "warship",
    "naval operation",
    "frigate",
    "destroyer",
    "submarine",
    "aircraft carrier",
    "carrier strike group",
    "maritime",
    "red sea",
    "strait",
    "tanker",
    "shipbuilding"
  ],

  land: [
    "troops",
    "army",
    "tank",
    "artillery",
    "frontline",
    "ground offensive",
    "border clash",
    "military convoy",
    "checkpoint",
    "combat vehicle"
  ],

  cyber: [
    "cyberattack",
    "cyber attack",
    "cyber operation",
    "cyber operations",
    "hack",
    "malware",
    "internet outage",
    "power grid",
    "infrastructure attack"
  ],

  strategic: [
    "nuclear",
    "ballistic",
    "mobilization",
    "mobilisation",
    "sanctions",
    "escalation",
    "proxy",
    "ceasefire",
    "hypersonic"
  ],

  defense_tech: [
    "defense contract",
    "defence contract",
    "contract award",
    "arms deal",
    "arms sales",
    "weapons deal",
    "procurement",
    "acquisition",
    "weapon system",
    "weapons system",
    "military technology",
    "military tech",
    "radar system",
    "sensor system",
    "counter-drone",
    "counter drone",
    "counter-uas",
    "c-uas",
    "anti-drone",
    "loitering munition",
    "unmanned system",
    "autonomous system",
    "ammunition production",
    "munition production",
    "munitions production",
    "shipbuilding",
    "naval shipbuilding",
    "missile defense",
    "missile defence",
    "air defense system",
    "air defence system",
    "weapons test",
    "missile test",
    "drone test",
    "fighter program",
    "submarine program"
  ],

  humanitarian: [
    "refugee",
    "refugees",
    "displacement",
    "civilian casualties",
    "civilian deaths",
    "humanitarian",
    "humanitarian corridor",
    "aid convoy",
    "evacuation",
    "evacuation order"
  ]
};

const OFFICIAL_MILITARY_SOURCE_HINTS = [
  "air force",
  "navy",
  "army",
  "marines",
  "marine corps",
  "space force",
  "national guard",
  "war.gov",
  "defense.gov",
  "defence.gov",
  "dod"
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getItemText(item = {}) {
  return normalizeText([
    item.title,
    item.summary,
    item.description,
    item.content,
    item.contentSnippet
  ].filter(Boolean).join(" "));
}

function includesKeyword(text, keyword) {
  return text.includes(normalizeText(keyword));
}

function countMatches(text, keywords = []) {
  return keywords.reduce((count, keyword) => {
    return count + (includesKeyword(text, keyword) ? 1 : 0);
  }, 0);
}

function hasAnyKeyword(text, keywords = []) {
  return keywords.some(keyword => includesKeyword(text, keyword));
}

function isOfficialMilitarySource(item = {}) {
  const sourceText = normalizeText([
    item.source_name,
    item.sourceName,
    item.source_id,
    item.source_category
  ].filter(Boolean).join(" "));

  return OFFICIAL_MILITARY_SOURCE_HINTS.some(keyword =>
    includesKeyword(sourceText, keyword)
  );
}

function isMilitaryTechOrProcurement(text) {
  return hasAnyKeyword(text, [
    "defense contract",
    "defence contract",
    "contract award",
    "arms deal",
    "arms sales",
    "weapons deal",
    "weapon deal",
    "weapons package",
    "military aid package",
    "security assistance package",
    "foreign military sale",
    "foreign military sales",
    "procurement",
    "acquisition",
    "defense acquisition",
    "defence acquisition",
    "weapon system",
    "weapons system",
    "military technology",
    "military tech",
    "defense technology",
    "defence technology",
    "missile defense",
    "missile defence",
    "air defense system",
    "air defence system",
    "radar system",
    "sensor system",
    "counter-drone",
    "counter drone",
    "counter-uas",
    "c-uas",
    "anti-drone",
    "loitering munition",
    "unmanned system",
    "autonomous system",
    "combat vehicle",
    "ammunition production",
    "munition production",
    "munitions production",
    "shipbuilding",
    "naval shipbuilding",
    "fighter program",
    "submarine program",
    "hypersonic",
    "test flight",
    "flight test",
    "weapons test",
    "missile test",
    "drone test"
  ]);
}

function isMilitaryAdminNoise(text) {
  const hasAdminNoise = hasAnyKeyword(text, [
    "hospital",
    "pension",
    "benefits",
    "medical",
    "clinic",
    "health care",
    "healthcare",
    "wounded warrior",
    "veteran",
    "veterans",
    "retiree",
    "retirement",
    "family support",
    "spouse",
    "housing",
    "allowance",
    "tuition",
    "scholarship",
    "ceremony",
    "award",
    "graduation",
    "recruiting",
    "fitness",
    "chaplain",
    "community",
    "super bowl",
    "museum",
    "memorial"
  ]);

  const hasOperationalOrTechException = hasAnyKeyword(text, [
    "airstrike",
    "air strike",
    "missile strike",
    "drone strike",
    "shelling",
    "artillery",
    "bombardment",
    "border clash",
    "frontline",
    "offensive",
    "invasion",
    "incursion",
    "warship",
    "submarine",
    "carrier strike group",
    "fighter jet",
    "air defense",
    "military operation",
    "troops deployed",
    "deployed troops",
    "deployment to",
    "red sea",
    "taiwan strait",
    "south china sea",
    "defense contract",
    "defence contract",
    "arms deal",
    "weapons deal",
    "procurement",
    "weapon system",
    "radar system",
    "shipbuilding",
    "missile defense",
    "air defense system"
  ]);

  return hasAdminNoise && !hasOperationalOrTechException;
}

function isLocalCrimeNoise(text) {
  const hasCrimeNoise = hasAnyKeyword(text, [
    "police",
    "sheriff",
    "arrested",
    "charged",
    "court",
    "trial",
    "robbery",
    "burglary",
    "homicide",
    "murder",
    "stabbing",
    "kidnapping",
    "abduction",
    "school shooting",
    "mass shooting",
    "city shooting",
    "domestic violence"
  ]);

  const hasStrategicException = hasAnyKeyword(text, [
    "terrorist",
    "terror attack",
    "terrorism",
    "militia",
    "insurgent",
    "insurgency",
    "rebel",
    "armed group",
    "war crime",
    "war crimes",
    "armed conflict",
    "border clash",
    "airstrike",
    "missile",
    "drone",
    "shelling",
    "artillery",
    "warship",
    "troops",
    "military operation"
  ]);

  return hasCrimeNoise && !hasStrategicException;
}

function scoreConflictNews(item = {}) {
  const text = getItemText(item);

  const hardConflictMatches = countMatches(text, HARD_CONFLICT_KEYWORDS);
  const highValueMatches = countMatches(text, HIGH_VALUE_KEYWORDS);
  const militaryMatches = countMatches(text, MILITARY_KEYWORDS);
  const negativeMatches = countMatches(text, NEGATIVE_KEYWORDS);

  const hasHardConflictSignal = hardConflictMatches > 0;
  const hasHighValueSignal = highValueMatches > 0;
  const officialSource = isOfficialMilitarySource(item);
  const localCrimeNoise = isLocalCrimeNoise(text);
  const militaryAdminNoise = isMilitaryAdminNoise(text);
  const militaryTechOrProcurement = isMilitaryTechOrProcurement(text);

  let score = 0;

  score += militaryMatches * 4;
  score += hardConflictMatches * 8;
  score += highValueMatches * 10;
  score -= negativeMatches * 20;

  // Reward procurement / weapons-tech stories because StratOps should include them.
  if (militaryTechOrProcurement) score += 18;

  // Extra context scoring
  if (text.includes("killed") || text.includes("wounded")) score += 3;
  if (text.includes("casualties")) score += 4;
  if (text.includes("civilian casualties")) score += 5;
  if (text.includes("defense ministry") || text.includes("defence ministry")) score += 6;
  if (text.includes("ministry of defense") || text.includes("ministry of defence")) score += 6;
  if (text.includes("claimed responsibility")) score += 5;
  if (text.includes("near the border")) score += 5;
  if (text.includes("border clash") || text.includes("border clashes")) score += 8;
  if (text.includes("red sea")) score += 4;
  if (text.includes("taiwan strait")) score += 5;
  if (text.includes("south china sea")) score += 5;
  if (text.includes("gaza") || text.includes("ukraine") || text.includes("iran")) score += 4;
  if (text.includes("contract") || text.includes("procurement") || text.includes("arms deal")) score += 6;
  if (text.includes("weapon") || text.includes("weapons") || text.includes("missile defense")) score += 6;

  // Strong disqualifiers
  if (!hasHardConflictSignal && !militaryTechOrProcurement) {
    score -= 35;
  }

  // Official military feeds contain lots of admin, medical, pension, training,
  // ceremony, family, award, recruitment, and veteran content.
  // For StratOps, official-source items must show real operational, tech, or weapons value.
  if (officialSource && !hasHighValueSignal && !militaryTechOrProcurement) {
    score -= 55;
  }

  if (officialSource && hardConflictMatches < 2 && !militaryTechOrProcurement) {
    score -= 30;
  }

  if (localCrimeNoise) {
    score -= 60;
  }

  if (militaryAdminNoise) {
    score -= 70;
  }

  // Soft military words should not qualify a story by themselves.
  const softOnlyMatches = countMatches(text, SOFT_MILITARY_ONLY_KEYWORDS);
  if (softOnlyMatches > 0 && !hasHardConflictSignal && !militaryTechOrProcurement) {
    score -= 25;
  }

  return score;
}

function detectCategory(item = {}) {
  const text = getItemText(item);

  let bestCategory = "general";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    let categoryScore = countMatches(text, keywords);

    if (category === "defense_tech" && isMilitaryTechOrProcurement(text)) {
      categoryScore += 2;
    }

    if (categoryScore > bestScore) {
      bestScore = categoryScore;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function isConflictRelevant(item = {}, minimumScore = 30) {
  return scoreConflictNews(item) >= minimumScore;
}

function enrichConflictItem(item = {}, options = {}) {
  const minimumScore = options.minimumScore || 30;
  const confidenceScore = scoreConflictNews(item);
  const category = detectCategory(item);

  return {
    ...item,
    category,
    confidence_score: confidenceScore,
    is_conflict_relevant: confidenceScore >= minimumScore
  };
}

function filterConflictItems(items = [], options = {}) {
  const minimumScore = options.minimumScore || 30;

  return items
    .map(item => enrichConflictItem(item, { minimumScore }))
    .filter(item => item.is_conflict_relevant);
}

export {
  scoreConflictNews,
  detectCategory,
  isConflictRelevant,
  enrichConflictItem,
  filterConflictItems
};
