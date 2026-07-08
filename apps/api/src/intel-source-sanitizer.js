function normalizeToken(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripNonEnglishText(value = "", fallback = "") {
    const cleaned = String(value ?? "")
        .replace(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{Number}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || String(fallback || "").trim();
}

function getRawObject(value) {
    if (!value) return {};
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const MAX_PUBLIC_IMAGES = 4;
const MAX_PUBLIC_VIDEOS = 2;
const MIN_PUBLIC_IMAGE_WIDTH = 300;
const MIN_PUBLIC_IMAGE_HEIGHT = 180;
const MIN_PUBLIC_IMAGE_SCORE = 18;
const STRONG_PUBLIC_IMAGE_SCORE = 52;
const INTEL_MEDIA_NEGATIVE_TOKENS = [
    "logo",
    "icon",
    "sprite",
    "avatar",
    "button",
    "arrow",
    "placeholder",
    "default",
    "spinner",
    "loader",
    "badge",
    "favicon",
    "social",
    "share",
    "comment",
    "tracking",
    "pixel",
    "banner",
    "advert",
    "ads",
    "emoji",
    "widget",
];
const INTEL_MEDIA_POSITIVE_TOKENS = [
    "upload",
    "uploads",
    "media",
    "image",
    "images",
    "photo",
    "photos",
    "article",
    "story",
    "news",
    "content",
    "post",
    "figure",
    "hero",
    "lead",
];
const INTEL_TITLE_STOP_WORDS = new Set([
    "about", "after", "also", "amid", "and", "army", "before", "between", "could", "from",
    "have", "into", "just", "latest", "more", "news", "over", "said", "says", "that", "their",
    "there", "these", "they", "this", "through", "under", "with", "your",
]);
const SAFE_VIDEO_HOST_PATTERNS = [
    /(^|\.)youtube\.com$/i,
    /(^|\.)youtu\.be$/i,
    /(^|\.)ytimg\.com$/i,
    /(^|\.)vimeo\.com$/i,
    /(^|\.)player\.vimeo\.com$/i,
];

const NAMED_SOURCE_LABELS = new Map([
    ["gdelt", "GDELT"],
    ["bbc", "BBC"],
    ["bbc world", "BBC"],
    ["bbc middle east", "BBC"],
    ["bbc europe", "BBC"],
    ["bbc asia", "BBC"],
    ["al jazeera", "Al Jazeera"],
    ["al jazeera all", "Al Jazeera"],
    ["france 24", "France 24"],
    ["france 24 english", "France 24"],
    ["the guardian", "The Guardian"],
    ["guardian world", "The Guardian"],
    ["npr", "NPR"],
    ["npr world", "NPR"],
    ["deutsche welle", "Deutsche Welle"],
    ["dw", "Deutsche Welle"],
    ["dw world", "Deutsche Welle"],
    ["reuters", "Reuters"],
    ["associated press", "Associated Press"],
    ["ap", "Associated Press"],
    ["ap news", "Associated Press"],
    ["bellingcat", "Bellingcat"],
    ["ooni", "OONI"],
    ["ooni incidents api", "OONI"],
    ["ooni blog rss", "OONI"],
    ["cisa", "CISA"],
    ["cisa advisories", "CISA"],
]);

const GROUPED_SOURCE_LABELS = new Map([
    ["the war zone", "Defense Media Feed"],
    ["twz feed", "Defense Media Feed"],
    ["twz feed", "Defense Media Feed"],
    ["war on the rocks", "Defense Analysis Feed"],
    ["breaking defense", "Defense Media Feed"],
    ["defense blog", "Military News Feed"],
    ["defence blog", "Military News Feed"],
    ["overt defense", "Defense Media Feed"],
    ["defense advancement", "Defense Technology Feed"],
    ["army technology", "Defense Technology Feed"],
    ["airforce technology", "Defense Technology Feed"],
    ["naval technology", "Naval Monitoring Feed"],
    ["defense news home", "Defense Media Feed"],
    ["defense news global", "Defense Media Feed"],
    ["defense news industry", "Defense Media Feed"],
    ["defense news air", "Defense Media Feed"],
    ["defense news land", "Defense Media Feed"],
    ["defense news naval", "Defense Media Feed"],
    ["defense news space", "Defense Media Feed"],
    ["defense news unmanned", "Defense Media Feed"],
    ["defense news pentagon", "Defense Media Feed"],
    ["defense news congress", "Defense Media Feed"],
    ["naval news", "Naval Monitoring Feed"],
    ["usni news", "Naval Monitoring Feed"],
    ["air space forces magazine", "Aviation Defense Feed"],
    ["air and space forces magazine", "Aviation Defense Feed"],
    ["military times news", "Military News Feed"],
    ["european security defence", "Defense Media Feed"],
    ["european security and defence", "Defense Media Feed"],
    ["c4isrnet", "Defense Technology Feed"],
    ["task purpose", "Military News Feed"],
    ["task and purpose", "Military News Feed"],
    ["shephard media news", "Defense Media Feed"],
    ["shepherd media news", "Defense Media Feed"],
    ["edr magazine", "Defense Media Feed"],
    ["defensescoop", "Defense Technology Feed"],
    ["the diplomat asia defense", "Asia-Pacific Defense Feed"],
    ["livefist defense", "Regional Defense Feed"],
    ["livefist defence", "Regional Defense Feed"],
    ["indian defense news", "Regional Defense Feed"],
    ["indian defence news", "Regional Defense Feed"],
    ["quwa defence news and analysis", "Regional Defense Feed"],
    ["china arms", "Regional Defense Feed"],
    ["china defense blog", "Regional Defense Feed"],
    ["uk defence journal", "Regional Defense Feed"],
    ["kyiv independent", "Ukraine Regional Feed"],
    ["ukrainska pravda english", "Ukraine Regional Feed"],
    ["the moscow times", "Russia Regional Feed"],
    ["balkan insight", "Europe Regional Feed"],
    ["south china morning post world", "Asia-Pacific Regional Feed"],
    ["the times of israel", "Middle East Regional Feed"],
    ["the jerusalem post", "Middle East Regional Feed"],
    ["jerusalem post", "Middle East Regional Feed"],
    ["middle east eye", "Middle East Regional Feed"],
    ["long war journal", "Conflict Analysis Feed"],
    ["international crisis group", "Conflict Analysis Feed"],
    ["modern war institute", "Defense Analysis Feed"],
    ["csis", "Strategic Analysis Feed"],
    ["atlantic council", "Strategic Analysis Feed"],
    ["foundation for defense of democracies", "Strategic Analysis Feed"],
    ["fdd", "Strategic Analysis Feed"],
    ["political geography now", "Geopolitical Analysis Feed"],
    ["global security review", "Security Analysis Feed"],
    ["oryx", "OSINT Research Feed"],
    ["the record cyber", "Cyber Monitoring Feed"],
    ["the record", "Cyber Monitoring Feed"],
    ["bleepingcomputer", "Cyber Monitoring Feed"],
    ["bleeping computer", "Cyber Monitoring Feed"],
    ["krebs on security", "Cyber Monitoring Feed"],
    ["securityweek", "Cyber Monitoring Feed"],
    ["security week", "Cyber Monitoring Feed"],
    ["the hacker news", "Cyber Monitoring Feed"],
    ["u s department of defense news", "Government Defense Feed"],
    ["us department of defense news", "Government Defense Feed"],
    ["u s navy top stories", "Naval Defense Feed"],
    ["u s air force news", "Aviation Defense Feed"],
    ["dsca news", "Government Defense Feed"],
    ["dsca new", "Government Defense Feed"],
    ["dsca cooperation news", "Government Defense Feed"],
    ["dsca featured news", "Government Defense Feed"],
    ["twz status fallback", "Defense Media Feed"],
    ["defense news global status fallback", "Defense Media Feed"],
]);

const GROUPED_SOURCE_IDS = new Map([
    ["twz-feed", "Defense Media Feed"],
    ["war-on-the-rocks", "Defense Analysis Feed"],
    ["breaking-defense-feed", "Defense Media Feed"],
    ["defence-blog-feed", "Military News Feed"],
    ["overt-defense-feed", "Defense Media Feed"],
    ["defense-advancement-feed", "Defense Technology Feed"],
    ["army-technology-feed", "Defense Technology Feed"],
    ["airforce-technology-feed", "Defense Technology Feed"],
    ["naval-technology-feed", "Naval Monitoring Feed"],
    ["defense-news-home", "Defense Media Feed"],
    ["defense-news-global", "Defense Media Feed"],
    ["defense-news-industry", "Defense Media Feed"],
    ["defense-news-air", "Defense Media Feed"],
    ["defense-news-land", "Defense Media Feed"],
    ["defense-news-naval", "Defense Media Feed"],
    ["defense-news-space", "Defense Media Feed"],
    ["defense-news-unmanned", "Defense Media Feed"],
    ["defense-news-pentagon", "Defense Media Feed"],
    ["defense-news-congress", "Defense Media Feed"],
    ["naval-news-feed", "Naval Monitoring Feed"],
    ["usni-news-feed", "Naval Monitoring Feed"],
    ["air-space-forces-feed", "Aviation Defense Feed"],
    ["military-times-news", "Military News Feed"],
    ["euro-sd", "Defense Media Feed"],
    ["c4isrnet", "Defense Technology Feed"],
    ["task-and-purpose", "Military News Feed"],
    ["shepherd-media-news", "Defense Media Feed"],
    ["edr-magazine", "Defense Media Feed"],
    ["defensescoop", "Defense Technology Feed"],
    ["the-diplomat-asia-defense", "Asia-Pacific Defense Feed"],
    ["livefist-defense", "Regional Defense Feed"],
    ["indian-defense-news", "Regional Defense Feed"],
    ["quwa-feed", "Regional Defense Feed"],
    ["china-arms-feed", "Regional Defense Feed"],
    ["china-defense-blog", "Regional Defense Feed"],
    ["uk-defense-journal", "Regional Defense Feed"],
    ["kyiv-independent", "Ukraine Regional Feed"],
    ["ukrainska-pravda-en", "Ukraine Regional Feed"],
    ["moscow-times", "Russia Regional Feed"],
    ["balkan-insight", "Europe Regional Feed"],
    ["scmp-world", "Asia-Pacific Regional Feed"],
    ["times-of-israel", "Middle East Regional Feed"],
    ["jerusalem-post", "Middle East Regional Feed"],
    ["middle-east-eye", "Middle East Regional Feed"],
    ["long-war-journal", "Conflict Analysis Feed"],
    ["crisisgroup-global", "Conflict Analysis Feed"],
    ["modern-war-institute", "Defense Analysis Feed"],
    ["csis-feed", "Strategic Analysis Feed"],
    ["atlantic-council-feed", "Strategic Analysis Feed"],
    ["fdd-feed", "Strategic Analysis Feed"],
    ["political-geography-now", "Geopolitical Analysis Feed"],
    ["global-security-review", "Security Analysis Feed"],
    ["oryx", "OSINT Research Feed"],
    ["the-record-cyber", "Cyber Monitoring Feed"],
    ["the-record-rss", "Cyber Monitoring Feed"],
    ["bleeping-computer", "Cyber Monitoring Feed"],
    ["bleepingcomputer-rss", "Cyber Monitoring Feed"],
    ["krebs-on-security", "Cyber Monitoring Feed"],
    ["securityweek-rss", "Cyber Monitoring Feed"],
    ["thehackernews-rss", "Cyber Monitoring Feed"],
    ["ooni-incidents-api", "OONI"],
    ["ooni-rss", "OONI"],
    ["cisa-advisories", "CISA"],
    ["us-defense-gov-news", "Government Defense Feed"],
    ["navy-mil-top-stories", "Naval Defense Feed"],
    ["af-mil-news", "Aviation Defense Feed"],
    ["dsca-news", "Government Defense Feed"],
    ["dsca-new", "Government Defense Feed"],
    ["dsca-featured-news", "Government Defense Feed"],
    ["twz-status-fallback", "Defense Media Feed"],
    ["defense-news-global-status-fallback", "Defense Media Feed"],
    ["military-watch-magazine", "Defense Media Feed"],
    ["uk-mod-news", "Government Defense Feed"],
    ["aviation-defense-market-reports", "Aviation Defense Feed"],
    ["military-africa", "Regional Defense Feed"],
    ["the-aviationist", "Aviation Defense Feed"],
    ["militaryleak", "Defense Media Feed"],
    ["janes-defense-news-1", "Defense Intelligence Feed"],
    ["janes-defense-news-2", "Defense Intelligence Feed"],
    ["janes-defense-news-3", "Defense Intelligence Feed"],
    ["janes-defense-news-4", "Defense Intelligence Feed"],
    ["janes-defense-news-5", "Defense Intelligence Feed"],
    ["us-war-dept-news", "Government Defense Feed"],
    ["military-times-rss", "Military News Feed"],
    ["faa-cleared-for-takeoff", "Aviation Data Feed"],
]);

const NAMED_SOURCE_MATCHERS = [
    { tokens: ["bbc"], label: "BBC" },
    { tokens: ["guardian"], label: "The Guardian" },
    { tokens: ["al jazeera"], label: "Al Jazeera" },
    { tokens: ["france 24"], label: "France 24" },
    { tokens: ["deutsche welle", "dw"], label: "Deutsche Welle" },
    { tokens: ["reuters"], label: "Reuters" },
    { tokens: ["associated press", "ap news", " ap "], label: "Associated Press" },
    { tokens: ["bellingcat"], label: "Bellingcat" },
    { tokens: ["ooni"], label: "OONI" },
    { tokens: ["cisa"], label: "CISA" },
    { tokens: ["gdelt"], label: "GDELT" },
];

const GROUPED_SOURCE_MATCHERS = [
    { tokens: ["war zone", "twz"], label: "Defense Media Feed" },
    { tokens: ["war on the rocks"], label: "Defense Analysis Feed" },
    { tokens: ["breaking defense"], label: "Defense Media Feed" },
    { tokens: ["defense blog", "defence blog"], label: "Military News Feed" },
    { tokens: ["defense advancement"], label: "Defense Technology Feed" },
    { tokens: ["army technology", "airforce technology"], label: "Defense Technology Feed" },
    { tokens: ["naval technology", "naval news", "usni news"], label: "Naval Monitoring Feed" },
    { tokens: ["defense news"], label: "Defense Media Feed" },
    { tokens: ["military times"], label: "Military News Feed" },
    { tokens: ["c4isrnet", "defensescoop"], label: "Defense Technology Feed" },
    { tokens: ["task and purpose", "task purpose"], label: "Military News Feed" },
    { tokens: ["shephard", "shepherd media"], label: "Defense Media Feed" },
    { tokens: ["the diplomat"], label: "Asia-Pacific Defense Feed" },
    { tokens: ["livefist", "quwa", "china arms", "china defense blog", "uk defence journal"], label: "Regional Defense Feed" },
    { tokens: ["kyiv independent", "ukrainska pravda"], label: "Ukraine Regional Feed" },
    { tokens: ["moscow times"], label: "Russia Regional Feed" },
    { tokens: ["balkan insight"], label: "Europe Regional Feed" },
    { tokens: ["south china morning post", "scmp"], label: "Asia-Pacific Regional Feed" },
    { tokens: ["times of israel", "jerusalem post", "middle east eye"], label: "Middle East Regional Feed" },
    { tokens: ["long war journal", "crisis group"], label: "Conflict Analysis Feed" },
    { tokens: ["modern war institute"], label: "Defense Analysis Feed" },
    { tokens: ["csis", "atlantic council", "foundation for defense of democracies", "fdd"], label: "Strategic Analysis Feed" },
    { tokens: ["political geography now"], label: "Geopolitical Analysis Feed" },
    { tokens: ["global security review"], label: "Security Analysis Feed" },
    { tokens: ["oryx"], label: "OSINT Research Feed" },
    { tokens: ["the record", "bleepingcomputer", "bleeping computer", "krebs on security", "securityweek", "security week", "hacker news"], label: "Cyber Monitoring Feed" },
    { tokens: ["department of defense", "dsca"], label: "Government Defense Feed" },
    { tokens: ["ministry of defence", "ministry of defense", "gov uk"], label: "Government Defense Feed" },
    { tokens: ["aviation and defense market reports"], label: "Aviation Defense Feed" },
    { tokens: ["military africa"], label: "Regional Defense Feed" },
    { tokens: ["aviationist"], label: "Aviation Defense Feed" },
    { tokens: ["militaryleak"], label: "Defense Media Feed" },
    { tokens: ["janes"], label: "Defense Intelligence Feed" },
    { tokens: ["department of war", "war gov"], label: "Government Defense Feed" },
    { tokens: ["cleared for takeoff", "faa"], label: "Aviation Data Feed" },
    { tokens: ["military watch magazine"], label: "Defense Media Feed" },
];

function findMatcherLabel(normalizedName = "", matchers = []) {
    for (const matcher of matchers) {
        if ((matcher.tokens || []).some((token) => normalizedName.includes(token))) {
            return matcher.label;
        }
    }
    return "";
}

function detectPublicSourceLabel(item = {}) {
    const raw = getRawObject(item.raw);
    const sourceId = String(item.source_id || item.sourceId || raw.source_id || raw.sourceId || "").trim().toLowerCase();
    const sourceName = String(item.source_name || item.sourceName || raw.source_name || raw.sourceName || "").trim();
    const sourceType = String(item.source_type || item.sourceType || raw.source_type || raw.sourceType || "").trim().toLowerCase();
    const sourceCategory = normalizeToken(item.source_category || item.sourceCategory || raw.source_category || raw.sourceCategory || "");
    const category = normalizeToken(item.category || raw.category || "");
    const url = String(item.url || item.source_url || item.sourceUrl || raw.url || raw.source_url || raw.sourceUrl || "").trim().toLowerCase();
    const normalizedName = normalizeToken(sourceName);

    if (sourceId && GROUPED_SOURCE_IDS.has(sourceId)) {
        return {
            sourceLabel: GROUPED_SOURCE_IDS.get(sourceId),
            sourceTypeLabel: null,
            sourceAttributionLevel: "grouped",
        };
    }

    if (sourceId && NAMED_SOURCE_LABELS.has(sourceId)) {
        return {
            sourceLabel: NAMED_SOURCE_LABELS.get(sourceId),
            sourceTypeLabel: null,
            sourceAttributionLevel: "named",
        };
    }

    if (normalizedName && NAMED_SOURCE_LABELS.has(normalizedName)) {
        return {
            sourceLabel: NAMED_SOURCE_LABELS.get(normalizedName),
            sourceTypeLabel: null,
            sourceAttributionLevel: "named",
        };
    }

    if (normalizedName && GROUPED_SOURCE_LABELS.has(normalizedName)) {
        return {
            sourceLabel: GROUPED_SOURCE_LABELS.get(normalizedName),
            sourceTypeLabel: null,
            sourceAttributionLevel: "grouped",
        };
    }

    const namedMatch = findMatcherLabel(normalizedName, NAMED_SOURCE_MATCHERS);
    if (namedMatch) {
        return {
            sourceLabel: namedMatch,
            sourceTypeLabel: null,
            sourceAttributionLevel: "named",
        };
    }

    const groupedMatch = findMatcherLabel(normalizedName, GROUPED_SOURCE_MATCHERS);
    if (groupedMatch) {
        return {
            sourceLabel: groupedMatch,
            sourceTypeLabel: null,
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        normalizedName.includes("notam") ||
        normalizedName.includes("seaaero") ||
        sourceCategory.includes("notam") ||
        category.includes("notam") ||
        (sourceType === "telegram" && (sourceCategory.includes("airspace") || category.includes("airspace") || sourceCategory.includes("aviation") || category.includes("aviation")))
    ) {
        return {
            sourceLabel: "NOTAM Monitor",
            sourceTypeLabel: "Advisory Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceType === "telegram" ||
        normalizedName.includes("telegram") ||
        url.includes("t.me") ||
        url.includes("telegram.me")
    ) {
        return {
            sourceLabel: "Telegram OSINT Monitor",
            sourceTypeLabel: "Telegram Monitor",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceCategory.includes("airspace") ||
        category.includes("airspace") ||
        sourceCategory.includes("aviation") ||
        category.includes("aviation")
    ) {
        return {
            sourceLabel: "Aviation Data Feed",
            sourceTypeLabel: sourceType === "api" ? "API Monitor" : "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceCategory.includes("naval") ||
        category.includes("naval")
    ) {
        return {
            sourceLabel: "Naval Monitoring Feed",
            sourceTypeLabel: sourceType === "api" ? "API Monitor" : "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceCategory.includes("cyber") ||
        sourceCategory.includes("network") ||
        sourceCategory.includes("infrastructure") ||
        category.includes("cyber") ||
        category.includes("network") ||
        category.includes("infrastructure")
    ) {
        return {
            sourceLabel: "Cyber Monitoring Feed",
            sourceTypeLabel: sourceType === "api" ? "API Monitor" : "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceCategory.includes("defense") ||
        sourceCategory.includes("military") ||
        category.includes("defense") ||
        category.includes("military") ||
        normalizedName.includes("defense") ||
        normalizedName.includes("defence")
    ) {
        return {
            sourceLabel: "Defense Media Feed",
            sourceTypeLabel: sourceType === "api" ? "API Monitor" : "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (
        sourceCategory.includes("regional") ||
        category.includes("regional")
    ) {
        return {
            sourceLabel: "Regional Media Feed",
            sourceTypeLabel: "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (sourceType === "rss" && category.includes("conflict")) {
        return {
            sourceLabel: "Conflict Intelligence Feed",
            sourceTypeLabel: "Feed",
            sourceAttributionLevel: "grouped",
        };
    }

    if (sourceType === "api" && (category.includes("status") || sourceCategory.includes("status"))) {
        return {
            sourceLabel: "Status Monitoring Feed",
            sourceTypeLabel: "API Monitor",
            sourceAttributionLevel: "grouped",
        };
    }

    return {
        sourceLabel: "Intel Wire Source",
        sourceTypeLabel: sourceType === "api" ? "API Monitor" : sourceType === "rss" ? "Feed" : null,
        sourceAttributionLevel: "hidden",
    };
}

function resolvePublicUrl(item = {}) {
    const raw = getRawObject(item.raw);
    const allowPublicUrl =
        item.allowPublicUrl === true ||
        item.allow_public_url === true ||
        raw.allowPublicUrl === true ||
        raw.allow_public_url === true;

    if (!allowPublicUrl) return null;

    const candidate = String(item.publicUrl || item.public_url || item.url || raw.publicUrl || raw.public_url || raw.url || "").trim();
    return /^https?:\/\//i.test(candidate) ? candidate : null;
}

function sanitizeIntelSource(item = {}) {
    const base = detectPublicSourceLabel(item);
    return {
        ...base,
        publicUrl: resolvePublicUrl(item),
    };
}

function extractSeverity(item = {}) {
    const raw = getRawObject(item.raw);
    const value = item.severity || raw.severity || raw.priority || "";
    return value ? String(value).trim().toLowerCase() : "unknown";
}

function trimString(value = "", maxLength = 240) {
    const text = String(value || "").trim();
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function trimWords(value = "", maxWords = 300, maxLength = 2200) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const words = text.split(" ");
    const limited = words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}...` : text;
    return limited.length > maxLength ? `${limited.slice(0, Math.max(0, maxLength - 3)).trim()}...` : limited;
}

function getHostname(value = "") {
    try {
        return new URL(String(value || "").trim()).hostname.toLowerCase();
    } catch {
        return "";
    }
}

function isPublicHttpUrl(value = "") {
    return /^https?:\/\//i.test(String(value || "").trim());
}

function isDirectImageUrl(value = "") {
    return /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(String(value || "").trim());
}

function isLikelyImageUrl(value = "") {
    const url = String(value || "").trim();
    if (!isPublicHttpUrl(url)) return false;
    if (isDirectImageUrl(url)) return true;
    try {
        const parsed = new URL(url);
        const path = `${parsed.hostname} ${parsed.pathname}`.toLowerCase();
        const query = parsed.search.toLowerCase();
        return (
            /(?:^|[\/._-])(image|images|img|photo|photos|picture|media|uploads|wp-content|cdn-cgi)(?:$|[\/._-])/i.test(path) ||
            /(?:format|fm|type|mime|content-type)=(?:jpg|jpeg|png|webp|gif|avif|image)/i.test(query) ||
            /(?:[?&](?:url|src|image|img)=https?%3a%2f%2f)/i.test(query)
        );
    } catch {
        return false;
    }
}

function isDirectVideoUrl(value = "") {
    return /\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i.test(String(value || "").trim());
}

function isSafePublicEmbedUrl(value = "") {
    const url = String(value || "").trim();
    if (!isPublicHttpUrl(url)) return false;
    const host = getHostname(url);
    return SAFE_VIDEO_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function normalizeAssetUrl(value = "") {
    const url = String(value || "").trim();
    if (url.startsWith("//")) return `https:${url}`;
    return isPublicHttpUrl(url) ? url : "";
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseHtmlAttributes(value = "") {
    const attrs = {};
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g;
    let match;
    while ((match = pattern.exec(String(value || "")))) {
        attrs[String(match[1] || "").toLowerCase()] = decodeHtmlEntities(match[2] || "");
    }
    return attrs;
}

function decodeHtmlEntities(value = "") {
    let current = String(value || "");
    for (let index = 0; index < 3; index += 1) {
        const decoded = current
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;|&#x27;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");
        if (decoded === current) break;
        current = decoded;
    }
    return current;
}

function stripHtmlToText(value = "") {
    const decoded = decodeHtmlEntities(value);
    const withoutTags = decoded
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=["'][^"']*["']/gi, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=\S+/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/\{[^{}]*(?:url|uri|html|node|data-history)[^{}]*\}/gi, " ");
    const leakedIndex = withoutTags.search(/\b(?:data-history-node-id|about=|href=|class=|src=|<article|<\/article|<p>|<\/p>)/i);
    const text = leakedIndex >= 0 ? withoutTags.slice(0, leakedIndex) : withoutTags;
    return text
        .replace(/\s+/g, " ")
        .trim();
}

function looksLikeLeakedHtmlSummary(value = "") {
    const text = String(value || "");
    if (!text) return false;
    return (
        /<(article|div|span|p|img|figure|figcaption|a)\b/i.test(text) ||
        /&lt;(article|div|span|p|img|figure|figcaption|a)\b/i.test(text) ||
        /\b(?:class|href|style|src|about|data-[a-z0-9_-]+)=/i.test(text)
    );
}

function walkValues(value, visit) {
    if (value == null) return;
    if (Array.isArray(value)) {
        value.forEach((entry) => walkValues(entry, visit));
        return;
    }
    if (typeof value === "object") {
        visit(value);
        Object.values(value).forEach((entry) => walkValues(entry, visit));
    }
}

function parseHtmlMediaCandidates(html = "") {
    const text = decodeHtmlEntities(html);
    if (!text) return [];
    const matches = [];
    const attrPattern = /<(img|video|source|iframe)\b([^>]*)>/gi;
    let match;
    while ((match = attrPattern.exec(text))) {
        const attrs = parseHtmlAttributes(match[2] || "");
        const sourceUrl = attrs.src ||
            attrs["data-src"] ||
            attrs["data-lazy-src"] ||
            attrs["data-original"] ||
            attrs.poster ||
            extractFirstSrcsetUrl(attrs.srcset || attrs["data-srcset"] || "");
        const contextStart = Math.max(0, match.index - 240);
        const contextEnd = Math.min(text.length, attrPattern.lastIndex + 360);
        const context = text.slice(contextStart, contextEnd);
        const captionMatch = context.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
        matches.push({
            tag: String(match[1] || "").toLowerCase(),
            url: normalizeAssetUrl(sourceUrl),
            alt: trimString(attrs.alt || "", 180),
            width: toFiniteNumber(attrs.width),
            height: toFiniteNumber(attrs.height),
            inFigure: /<figure\b/i.test(context),
            hasCaption: /<figcaption\b/i.test(context) || /\bcaption\b/i.test(context),
            caption: captionMatch ? trimString(stripHtmlToText(captionMatch[1] || ""), 180) : "",
            articleContext: /(article|entry-content|post-content|story-body|story-content|main-image|hero-image|wp-caption|article-body)/i.test(context),
        });
    }
    return matches.filter((entry) => entry.url);
}

function extractFirstSrcsetUrl(value = "") {
    const first = String(value || "").split(",")[0] || "";
    return first.trim().split(/\s+/)[0] || "";
}

function collectHtmlMetadataCandidates(html = "", pushImage = () => {}, pushVideo = () => {}) {
    const text = decodeHtmlEntities(html);
    if (!text) return;

    const metaPattern = /<meta\b([^>]*)>/gi;
    let metaMatch;
    while ((metaMatch = metaPattern.exec(text))) {
        const attrs = parseHtmlAttributes(metaMatch[1] || "");
        const key = String(attrs.property || attrs.name || "").toLowerCase();
        const content = normalizeAssetUrl(attrs.content || "");
        if (!content) continue;
        if (key === "og:image" || key === "og:image:url" || key === "twitter:image" || key === "twitter:image:src") {
            pushImage(content, { sourceKind: "metadata" });
        }
        if (key === "og:video" || key === "twitter:player") {
            pushVideo(content, { sourceKind: "metadata" });
        }
    }

    const ldJsonPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldJsonMatch;
    while ((ldJsonMatch = ldJsonPattern.exec(text))) {
        const jsonText = String(ldJsonMatch[1] || "").trim();
        if (!jsonText) continue;
        try {
            const parsed = JSON.parse(jsonText);
            walkValues(parsed, (node) => {
                if (!node || typeof node !== "object") return;
                const type = String(node["@type"] || "").toLowerCase();
                const imageValue = node.image || node.thumbnailUrl || node.thumbnail;
                if (!/article|newsarticle|reportage/i.test(type) || !imageValue) return;
                if (Array.isArray(imageValue)) {
                    imageValue.forEach((entry) => {
                        const url = normalizeAssetUrl(typeof entry === "string" ? entry : entry?.url || entry?.contentUrl || "");
                        if (url) pushImage(url, { sourceKind: "metadata" });
                    });
                    return;
                }
                const url = normalizeAssetUrl(typeof imageValue === "string" ? imageValue : imageValue?.url || imageValue?.contentUrl || "");
                if (url) pushImage(url, { sourceKind: "metadata" });
            });
        } catch {}
    }
}

function normalizeTokenList(value = "") {
    return normalizeToken(value)
        .split(" ")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function getIntelTitleKeywords(item = {}) {
    const keywords = normalizeTokenList([
        item.title || "",
        item.country || "",
        item.region || "",
    ].join(" "));
    return keywords.filter((token) => token.length >= 3 && !INTEL_TITLE_STOP_WORDS.has(token)).slice(0, 16);
}

function inferImageDimensions(entry = {}) {
    let width = toFiniteNumber(entry.width);
    let height = toFiniteNumber(entry.height);
    if (width && height) return { width, height };

    const url = String(entry.url || entry.thumbUrl || "").toLowerCase();
    const dimensionMatch = url.match(/(?:^|[\/._-])(\d{2,4})[xX](\d{2,4})(?:$|[\/?._-])/);
    if (dimensionMatch) {
        width = width || toFiniteNumber(dimensionMatch[1]);
        height = height || toFiniteNumber(dimensionMatch[2]);
    }
    return { width, height };
}

function containsIntelNegativeToken(value = "") {
    const tokens = new Set(normalizeTokenList(value));
    return INTEL_MEDIA_NEGATIVE_TOKENS.some((token) => tokens.has(token));
}

function containsIntelPositiveToken(value = "") {
    const tokens = new Set(normalizeTokenList(value));
    return INTEL_MEDIA_POSITIVE_TOKENS.some((token) => tokens.has(token));
}

function isRejectedIntelImageCandidate(entry = {}) {
    const url = String(entry.url || "").trim().toLowerCase();
    if (!url || !isLikelyImageUrl(url)) return true;
    if (/^data:/i.test(url)) return true;
    if (/\.svg(?:[?#].*)?$/i.test(url)) return true;
    if (containsIntelNegativeToken(url)) return true;
    if (/(?:^|[/?=_-])(16|24|32|48|64|72|96|100|120|128|150)x(16|24|32|48|64|72|96|100|120|128|150)(?:$|[/?&._-])/i.test(url)) return true;
    if (/gravatar|favicon|emoji|sprite|tracking|pixel/i.test(url)) return true;
    if (containsIntelNegativeToken(entry.alt || "")) return true;
    if (containsIntelNegativeToken(entry.caption || "")) return true;

    const { width, height } = inferImageDimensions(entry);
    if (width && width < MIN_PUBLIC_IMAGE_WIDTH) return true;
    if (height && height < MIN_PUBLIC_IMAGE_HEIGHT) return true;
    if (width && height) {
        const aspectRatio = width / height;
        if (aspectRatio < 0.6 || aspectRatio > 3.2) return true;
    }

    return false;
}

function scoreIntelMediaImage(entry = {}, item = {}) {
    const url = String(entry.url || "").toLowerCase();
    const keywords = getIntelTitleKeywords(item);
    const metadataText = `${entry.alt || ""} ${entry.caption || ""}`;
    const metadataTokens = normalizeTokenList(metadataText);
    const keywordHits = keywords.filter((token) => metadataTokens.includes(token)).length;
    const { width, height } = inferImageDimensions(entry);
    const aspectRatio = width && height ? width / height : 0;
    let score = 0;

    switch (String(entry.sourceKind || "")) {
        case "rss":
            score += 48;
            break;
        case "metadata":
            score += 44;
            break;
        case "figure":
            score += 34;
            break;
        case "article-html":
            score += 24;
            break;
        default:
            score += 10;
            break;
    }

    if (width && height) {
        if (width >= 1200 || height >= 675) score += 14;
        else if (width >= 640 && height >= 360) score += 10;
        else if (width >= MIN_PUBLIC_IMAGE_WIDTH && height >= MIN_PUBLIC_IMAGE_HEIGHT) score += 4;
    }
    if (aspectRatio >= 1.2 && aspectRatio <= 2.2) score += 8;
    else if (aspectRatio >= 0.8 && aspectRatio <= 2.8) score += 4;
    if (entry.inFigure) score += 8;
    if (entry.hasCaption) score += 10;
    if (entry.articleContext) score += 8;
    if (containsIntelPositiveToken(url)) score += 6;
    if (keywordHits) score += Math.min(12, keywordHits * 4);
    if (containsIntelNegativeToken(url) || containsIntelNegativeToken(metadataText)) score -= 40;

    return score;
}

function selectIntelImageCandidates(candidates = [], item = {}) {
    const bestByUrl = new Map();
    candidates.forEach((entry, index) => {
        const url = normalizeAssetUrl(entry?.url || "");
        if (!url) return;
        const candidate = {
            ...entry,
            url,
            _order: index,
        };
        if (isRejectedIntelImageCandidate(candidate)) return;
        candidate._score = scoreIntelMediaImage(candidate, item);
        if (candidate._score < MIN_PUBLIC_IMAGE_SCORE) return;

        const key = url.toLowerCase();
        const current = bestByUrl.get(key);
        if (!current || candidate._score > current._score || (candidate._score === current._score && candidate._order < current._order)) {
            bestByUrl.set(key, candidate);
        }
    });

    const selected = [...bestByUrl.values()].sort((left, right) => {
        if (right._score !== left._score) return right._score - left._score;
        return left._order - right._order;
    });

    if (selected.length > 1 && selected[0]._score >= STRONG_PUBLIC_IMAGE_SCORE && selected[1]._score <= selected[0]._score - 18) {
        return [selected[0]];
    }

    return selected.slice(0, MAX_PUBLIC_IMAGES);
}

function scoreIntelMediaVideo(entry = {}) {
    let score = 0;
    switch (String(entry.sourceKind || "")) {
        case "rss":
            score += 40;
            break;
        case "metadata":
            score += 34;
            break;
        default:
            score += 20;
            break;
    }
    if (entry.thumbUrl && isLikelyImageUrl(entry.thumbUrl)) score += 6;
    if (entry.videoUrl && isDirectVideoUrl(entry.videoUrl)) score += 6;
    if (entry.embedUrl && isSafePublicEmbedUrl(entry.embedUrl)) score += 4;
    return score;
}

function selectIntelVideoCandidates(candidates = []) {
    const bestByKey = new Map();
    candidates.forEach((entry, index) => {
        const videoUrl = normalizeAssetUrl(entry?.videoUrl || "");
        const embedUrl = normalizeAssetUrl(entry?.embedUrl || "");
        const thumbUrl = normalizeAssetUrl(entry?.thumbUrl || "");
        if (!isDirectVideoUrl(videoUrl) && !isSafePublicEmbedUrl(embedUrl)) return;
        const candidate = {
            ...entry,
            videoUrl: isDirectVideoUrl(videoUrl) ? videoUrl : "",
            embedUrl: isSafePublicEmbedUrl(embedUrl) ? embedUrl : "",
            thumbUrl: isLikelyImageUrl(thumbUrl) ? thumbUrl : "",
            _order: index,
        };
        candidate._score = scoreIntelMediaVideo(candidate);
        const key = (candidate.videoUrl || candidate.embedUrl || candidate.thumbUrl).toLowerCase();
        const current = bestByKey.get(key);
        if (!current || candidate._score > current._score || (candidate._score === current._score && candidate._order < current._order)) {
            bestByKey.set(key, candidate);
        }
    });

    return [...bestByKey.values()]
        .sort((left, right) => {
            if (right._score !== left._score) return right._score - left._score;
            return left._order - right._order;
        })
        .slice(0, MAX_PUBLIC_VIDEOS);
}

function collectRawMediaCandidates(item = {}) {
    const raw = getRawObject(item.raw);
    const candidates = {
        images: [],
        videos: [],
    };

    const pushImage = (url = "", meta = {}) => {
        const normalizedUrl = normalizeAssetUrl(url);
        if (!normalizedUrl) return;
        candidates.images.push({
            url: normalizedUrl,
            thumbUrl: normalizeAssetUrl(meta.thumbUrl || meta.thumbnail || normalizedUrl),
            alt: trimString(meta.alt || item.title || ""),
            width: Number.isFinite(Number(meta.width)) ? Number(meta.width) : null,
            height: Number.isFinite(Number(meta.height)) ? Number(meta.height) : null,
            caption: trimString(meta.caption || "", 180),
            hasCaption: meta.hasCaption === true,
            inFigure: meta.inFigure === true,
            articleContext: meta.articleContext === true,
            sourceKind: meta.sourceKind || "fallback",
        });
    };

    const pushVideo = (url = "", meta = {}) => {
        const normalizedUrl = normalizeAssetUrl(url);
        const embedUrl = normalizeAssetUrl(meta.embedUrl || "");
        if (!normalizedUrl && !embedUrl) return;
        candidates.videos.push({
            videoUrl: normalizedUrl,
            thumbUrl: normalizeAssetUrl(meta.thumbUrl || meta.poster || meta.thumbnail || ""),
            embedUrl,
            title: trimString(meta.title || item.title || ""),
            duration: trimString(meta.duration || ""),
            providerLabel: trimString(meta.providerLabel || "Intel Wire Media", 64),
            sourceKind: meta.sourceKind || "fallback",
        });
    };

    const pushDirectAsset = (value, meta = {}) => {
        const normalizedUrl = normalizeAssetUrl(value);
        if (!normalizedUrl) return;
        if (isDirectVideoUrl(normalizedUrl)) {
            pushVideo(normalizedUrl, meta);
            return;
        }
        if (isDirectImageUrl(normalizedUrl)) {
            pushImage(normalizedUrl, meta);
            return;
        }
        if (isSafePublicEmbedUrl(normalizedUrl)) {
            pushVideo("", { ...meta, embedUrl: normalizedUrl });
        }
    };

    [
        item.image,
        item.image_url,
        item.imageUrl,
        item.thumbnail,
        item.thumbnailUrl,
        item.media_url,
        item.mediaUrl,
        raw.image,
        raw.image_url,
        raw.imageUrl,
        raw.thumbnail,
        raw.thumbnailUrl,
        raw.poster,
        raw.hero_image,
        raw.heroImage,
        raw.lead_image,
        raw.leadImage,
        raw.og_image,
        raw.ogImage,
        raw.twitter_image,
        raw.twitterImage,
        raw.photo,
    ].forEach((value) => pushDirectAsset(value, { sourceKind: "metadata" }));

    [raw.enclosure, raw.media, raw.media_content, raw["media:content"], raw.media_thumbnail, raw["media:thumbnail"]]
        .filter(Boolean)
        .forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((entry) => pushDirectAsset(entry?.url || entry?.href || entry?.src || entry, { ...entry, sourceKind: "rss" }));
                return;
            }
            if (typeof value === "object") {
                pushDirectAsset(value.url || value.href || value.src || value.contentUrl, { ...value, sourceKind: "rss" });
                return;
            }
            pushDirectAsset(value, { sourceKind: "rss" });
        });

    const rawTextSources = [
        raw.content,
        raw.summary,
        raw.description,
        raw["content:encoded"],
    ];

    rawTextSources.forEach((value) => {
        collectHtmlMetadataCandidates(value, pushImage, pushVideo);
        parseHtmlMediaCandidates(value).forEach((entry) => {
            if (entry.tag === "iframe") {
                if (isSafePublicEmbedUrl(entry.url)) {
                    candidates.videos.push({
                        videoUrl: "",
                        thumbUrl: "",
                        embedUrl: entry.url,
                        title: trimString(item.title || ""),
                        duration: "",
                        providerLabel: "Intel Wire Video",
                        sourceKind: "metadata",
                    });
                }
                return;
            }
            if (entry.tag === "video" || entry.tag === "source") {
                pushVideo(entry.url, { ...entry, sourceKind: "article-html" });
                return;
            }
            pushImage(entry.url, {
                ...entry,
                sourceKind: entry.inFigure || entry.hasCaption ? "figure" : "article-html",
            });
        });
    });

    walkValues(raw, (node) => {
        const urlCandidates = [
            node.url,
            node.href,
            node.src,
            node.poster,
            node.thumbnail,
            node.thumbnailUrl,
            node.image,
            node.image_url,
            node.imageUrl,
            node.enclosure?.url,
        ].map(normalizeAssetUrl).filter(Boolean);

        urlCandidates.forEach((url) => {
            if (isDirectVideoUrl(url)) {
                pushVideo(url, node);
                return;
            }
            if (isDirectImageUrl(url)) {
                pushImage(url, node);
                return;
            }
            if (isSafePublicEmbedUrl(url)) {
                candidates.videos.push({
                    videoUrl: "",
                    thumbUrl: normalizeAssetUrl(node.thumbnail || node.thumbnailUrl || node.poster || ""),
                    embedUrl: url,
                    title: trimString(node.title || item.title || ""),
                    duration: trimString(node.duration || ""),
                    providerLabel: "Intel Wire Video",
                });
            }
        });
    });

    return candidates;
}

function dedupeMediaByUrl(items = [], getKey) {
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
        const key = String(getKey(item) || "").trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(item);
    });
    return out;
}

function sanitizeMediaBaseUrl(value = "") {
    try {
        const url = new URL(String(value || "").trim());
        return `${url.origin}/`;
    } catch {
        return "";
    }
}

function buildMediaProxyUrl(baseUrl = "", itemId = "", kind = "", index = 0, variant = "full") {
    const safeBase = sanitizeMediaBaseUrl(baseUrl);
    if (!safeBase || !itemId || !kind) return null;
    return new URL(
        `/events/intel-feed/media/${encodeURIComponent(String(itemId))}/${encodeURIComponent(String(kind))}/${Math.max(0, Number(index) || 0)}/${encodeURIComponent(String(variant))}`,
        safeBase
    ).toString();
}

function buildPublicIntelWireMedia(item = {}, mediaBaseUrl = "") {
    const candidates = collectRawMediaCandidates(item);
    const images = selectIntelImageCandidates(candidates.images, item)
        .slice(0, MAX_PUBLIC_IMAGES)
        .map((entry, index) => ({
            thumbUrl: isLikelyImageUrl(entry.thumbUrl) ? entry.thumbUrl : (isLikelyImageUrl(entry.url) ? entry.url : null),
            fullUrl: isLikelyImageUrl(entry.url) ? entry.url : (isLikelyImageUrl(entry.thumbUrl) ? entry.thumbUrl : null),
            alt: entry.alt || null,
            width: inferImageDimensions(entry).width,
            height: inferImageDimensions(entry).height,
        }))
        .filter((entry) => entry.thumbUrl && entry.fullUrl);

    const videos = selectIntelVideoCandidates(candidates.videos)
        .slice(0, MAX_PUBLIC_VIDEOS)
        .map((entry) => ({
            thumbUrl: isLikelyImageUrl(entry.thumbUrl) ? entry.thumbUrl : null,
            videoUrl: isDirectVideoUrl(entry.videoUrl)
                ? entry.videoUrl
                : null,
            embedUrl: isSafePublicEmbedUrl(entry.embedUrl) ? entry.embedUrl : null,
            title: entry.title || null,
            duration: entry.duration || null,
            providerLabel: entry.providerLabel || "Intel Wire Media",
        }))
        .filter((entry) => entry.videoUrl || entry.embedUrl);

    if (!images.length && !videos.length) return null;
    return { images, videos };
}

function getIntelWireMediaAsset(item = {}, kind = "", index = 0, variant = "full") {
    const candidates = collectRawMediaCandidates(item);
    if (kind === "image") {
        const images = selectIntelImageCandidates(candidates.images, item).slice(0, MAX_PUBLIC_IMAGES);
        const image = images[Math.max(0, Number(index) || 0)];
        if (!image) return null;
        if (variant === "thumb" && image.thumbUrl) {
            return { url: image.thumbUrl, type: "image" };
        }
        return { url: image.url, type: "image" };
    }
    if (kind === "video") {
        const videos = selectIntelVideoCandidates(candidates.videos).slice(0, MAX_PUBLIC_VIDEOS);
        const video = videos[Math.max(0, Number(index) || 0)];
        if (!video) return null;
        if (variant === "thumb") {
            if (!video.thumbUrl || !isLikelyImageUrl(video.thumbUrl)) return null;
            return { url: video.thumbUrl, type: "image" };
        }
        if (variant === "stream") {
            if (!isDirectVideoUrl(video.videoUrl)) return null;
            return { url: video.videoUrl, type: "video" };
        }
    }
    return null;
}

function buildPublicSummary(item = {}) {
    const raw = getRawObject(item.raw);
    const candidates = [
        raw.summary,
        raw.description,
        raw.content,
        raw["content:encoded"],
        item.summary,
    ];
    for (const candidate of candidates) {
        const cleaned = stripHtmlToText(candidate);
        if (!cleaned) continue;
        if (looksLikeLeakedHtmlSummary(cleaned)) continue;
        const englishOnly = stripNonEnglishText(cleaned);
        if (!englishOnly) continue;
        return trimWords(englishOnly, 300, 2200);
    }
    return "";
}

function toPublicIntelWireItem(item = {}, options = {}) {
    const source = sanitizeIntelSource(item);
    const timestamp = item.published_at || item.fetched_at || new Date().toISOString();
    const media = buildPublicIntelWireMedia(item, options.mediaBaseUrl || "");
    return {
        id: item.id,
        title: stripNonEnglishText(stripHtmlToText(item.title || ""), "Intel update"),
        summary: buildPublicSummary(item),
        category: item.category || item.source_category || "intel",
        severity: extractSeverity(item),
        location: stripNonEnglishText(item.country || item.region || "", ""),
        timestamp,
        published_at: item.published_at || null,
        fetched_at: item.fetched_at || null,
        region: stripNonEnglishText(item.region || "", "") || null,
        country: stripNonEnglishText(item.country || "", "") || null,
        confidence: Number(item.confidence_score || 0),
        confidence_score: Number(item.confidence_score || 0),
        is_conflict_relevant: item.is_conflict_relevant === true,
        sourceLabel: source.sourceLabel,
        sourceTypeLabel: source.sourceTypeLabel,
        sourceAttributionLevel: source.sourceAttributionLevel,
        publicUrl: source.publicUrl,
        media,
    };
}

export {
    buildPublicIntelWireMedia,
    getIntelWireMediaAsset,
    sanitizeIntelSource,
    toPublicIntelWireItem,
    detectPublicSourceLabel as getPublicSourceLabel,
};
