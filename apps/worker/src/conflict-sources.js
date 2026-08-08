// apps/worker/src/conflict-sources.js
// StratOps global source registry.
// Focus: global military conflict, defense technology, weapons procurement,
// arms sales, air/naval/land capability, strategic posture, and regional defense news.
//
// Important:
// - This file is intentionally global, not US-only.
// - getRssSources() returns enabled RSS sources only.
// - Some candidate feeds may change or block automated requests.
// - If a source returns 403/404/timeout, set enabled:false until fixed.
// - ReliefWeb API and GDELT are kept disabled here. Use separate approved/throttled workers for them.

import { normalizeSourceDefinition } from "../../shared/source-quality-policy.js";

const RSS_SOURCES = [
  // ---------------------------------------------------------------------------
  // Global conflict / geopolitical analysis
  // ---------------------------------------------------------------------------
  {
    id: "crisisgroup-global",
    name: "International Crisis Group",
    type: "rss",
    category: "conflict-analysis",
    region_scope: "global",
    url: "https://www.crisisgroup.org/rss",
    enabled: true
  },
  {
    id: "war-on-the-rocks",
    name: "War on the Rocks",
    type: "rss",
    category: "conflict-analysis",
    region_scope: "global",
    url: "https://warontherocks.com/feed/",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Global defense / military technology / procurement
  // ---------------------------------------------------------------------------
  {
    id: "twz-feed",
    name: "The War Zone",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://www.twz.com/feed",
    enabled: true
  },
  {
    id: "breaking-defense-feed",
    name: "Breaking Defense",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://breakingdefense.com/feed/",
    enabled: true
  },
  {
    id: "defence-blog-feed",
    name: "Defence Blog",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://defence-blog.com/feed/",
    enabled: true
  },
  {
    id: "overt-defense-feed",
    name: "Overt Defense",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.overtdefense.com/feed/",
    enabled: true
  },
  {
    id: "defense-advancement-feed",
    name: "Defense Advancement",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://www.defenseadvancement.com/feed/",
    enabled: true
  },
  {
    id: "army-technology-feed",
    name: "Army Technology",
    type: "rss",
    category: "land",
    region_scope: "global",
    url: "https://www.army-technology.com/feed/",
    enabled: true
  },
  {
    id: "airforce-technology-feed",
    name: "Airforce Technology",
    type: "rss",
    category: "air",
    region_scope: "global",
    url: "https://www.airforce-technology.com/feed/",
    enabled: true
  },
  {
    id: "naval-technology-feed",
    name: "Naval Technology",
    type: "rss",
    category: "naval",
    region_scope: "global",
    url: "https://www.naval-technology.com/feed/",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Defense News categories
  // ---------------------------------------------------------------------------
  {
    id: "defense-news-home",
    name: "Defense News Home",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/",
    enabled: true
  },
  {
    id: "defense-news-global",
    name: "Defense News Global",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/",
    enabled: true
  },
  {
    id: "defense-news-industry",
    name: "Defense News Industry",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/industry/",
    enabled: true
  },
  {
    id: "defense-news-air",
    name: "Defense News Air",
    type: "rss",
    category: "air",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/air/",
    enabled: true
  },
  {
    id: "defense-news-land",
    name: "Defense News Land",
    type: "rss",
    category: "land",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/land/",
    enabled: true
  },
  {
    id: "defense-news-naval",
    name: "Defense News Naval",
    type: "rss",
    category: "naval",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/naval/",
    enabled: true
  },
  {
    id: "defense-news-space",
    name: "Defense News Space",
    type: "rss",
    category: "space",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/space/",
    enabled: true
  },
  {
    id: "defense-news-unmanned",
    name: "Defense News Unmanned",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/unmanned/",
    enabled: true
  },
  {
    id: "defense-news-pentagon",
    name: "Defense News Pentagon",
    type: "rss",
    category: "official-military",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/pentagon/",
    enabled: true
  },
  {
    id: "defense-news-congress",
    name: "Defense News Congress",
    type: "rss",
    category: "defense-policy",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/congress/",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Naval / maritime global
  // ---------------------------------------------------------------------------
  {
    id: "naval-news-feed",
    name: "Naval News",
    type: "rss",
    category: "naval",
    region_scope: "global",
    url: "https://www.navalnews.com/feed/",
    enabled: true
  },
  {
    id: "usni-news-feed",
    name: "USNI News",
    type: "rss",
    category: "naval",
    region_scope: "global",
    url: "https://news.usni.org/feed",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Army Recognition global feeds
  // ---------------------------------------------------------------------------
  {
    id: "army-recognition-land",
    name: "Army Recognition Land Defense",
    type: "rss",
    category: "land",
    region_scope: "global",
    url: "https://armyrecognition.com/news/army-news/feed/rss",
    enabled: false,
    note: "Disabled after local smoke test: RSS parser failed on invalid entity character."
  },
  {
    id: "army-recognition-naval",
    name: "Army Recognition Naval Defense",
    type: "rss",
    category: "naval",
    region_scope: "global",
    url: "https://armyrecognition.com/news/navy-news/feed/rss",
    enabled: false,
    note: "Disabled after local smoke test: feed was not recognized as RSS."
  },
  {
    id: "army-recognition-aerospace",
    name: "Army Recognition Aerospace Defense",
    type: "rss",
    category: "air",
    region_scope: "global",
    url: "https://armyrecognition.com/news/aerospace-news/feed/rss",
    enabled: false,
    note: "Disabled after local smoke test: RSS parser failed on invalid entity character."
  },

  // ---------------------------------------------------------------------------
  // Asia / China / India / Pakistan / Indo-Pacific
  // ---------------------------------------------------------------------------
  {
    id: "the-diplomat-asia-defense",
    name: "The Diplomat Asia Defense",
    type: "rss",
    category: "regional-defense",
    region_scope: "asia-indo-pacific",
    url: "https://thediplomat.com/category/asia-defense/feed/",
    enabled: true
  },
  {
    id: "livefist-defense",
    name: "Livefist Defence",
    type: "rss",
    category: "regional-defense",
    region_scope: "india",
    url: "https://www.livefistdefence.com/feed/",
    enabled: true
  },
  {
    id: "idrw-feed",
    name: "Indian Defence Research Wing",
    type: "rss",
    category: "regional-defense",
    region_scope: "india",
    url: "https://idrw.org/feed/",
    enabled: false,
    note: "Disabled after local smoke test: feed returned HTTP 404."
  },
  {
    id: "indian-defense-news",
    name: "Indian Defence News",
    type: "rss",
    category: "regional-defense",
    region_scope: "india",
    url: "https://www.indiandefensenews.in/feeds/posts/default?alt=rss",
    enabled: true
  },
  {
    id: "quwa-feed",
    name: "Quwa Defence News and Analysis",
    type: "rss",
    category: "regional-defense",
    region_scope: "pakistan-middle-east",
    url: "https://quwa.org/feed/",
    enabled: true
  },
  {
    id: "china-arms-feed",
    name: "China Arms",
    type: "rss",
    category: "regional-defense",
    region_scope: "china",
    url: "https://www.china-arms.com/feed/",
    enabled: true
  },
  {
    id: "china-defense-blog",
    name: "China Defense Blog",
    type: "rss",
    category: "regional-defense",
    region_scope: "china",
    url: "https://china-defense.blogspot.com/feeds/posts/default?alt=rss",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Europe / UK / France / NATO-adjacent
  // ---------------------------------------------------------------------------
  {
    id: "uk-defense-journal",
    name: "UK Defence Journal",
    type: "rss",
    category: "regional-defense",
    region_scope: "uk-europe",
    url: "https://ukdefencejournal.org.uk/feed/",
    enabled: true
  },
  {
    id: "air-space-forces-feed",
    name: "Air & Space Forces Magazine",
    type: "rss",
    category: "air-space",
    region_scope: "global",
    url: "https://www.airandspaceforces.com/feed/",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Broad global news feeds. These are useful for Intel Wire context; frontend
  // and worker promotion gates keep non-operational stories off map surfaces.
  // ---------------------------------------------------------------------------
  {
    id: "bbc-world",
    name: "BBC World",
    type: "rss",
    category: "global-news",
    region_scope: "global",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    enabled: true
  },
  {
    id: "bbc-middle-east",
    name: "BBC Middle East",
    type: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    enabled: true
  },
  {
    id: "bbc-europe",
    name: "BBC Europe",
    type: "rss",
    category: "regional-conflict",
    region_scope: "europe",
    url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
    enabled: true
  },
  {
    id: "bbc-asia",
    name: "BBC Asia",
    type: "rss",
    category: "regional-conflict",
    region_scope: "asia-indo-pacific",
    url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml",
    enabled: true
  },
  {
    id: "al-jazeera-all",
    name: "Al Jazeera",
    type: "rss",
    category: "global-news",
    region_scope: "global",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    enabled: true
  },
  {
    id: "france24-en",
    name: "France 24 English",
    type: "rss",
    parser: "rss",
    category: "global-news",
    region_scope: "global",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/rss",
    attribution: "France 24 RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 38,
    enabled: false,
    health: "disabled",
    disabled_reason: "Verified 2026-08-08: /en/rss redirects to an HTML RSS index. Working live-news and regional France 24 feeds remain enabled."
  },
  {
    id: "france24-live-news",
    name: "France 24 Live News",
    type: "rss",
    parser: "rss",
    category: "global-news",
    region_scope: "global",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/live-news/rss",
    attribution: "France 24 Live News RSS",
    request_interval_ms: 10 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 52,
    enabled: true
  },
  {
    id: "france24-middle-east",
    name: "France 24 Middle East",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/middle-east/rss",
    attribution: "France 24 RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 30,
    enabled: true
  },
  {
    id: "france24-africa",
    name: "France 24 Africa",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "africa",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/africa/rss",
    attribution: "France 24 RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 34,
    enabled: true
  },
  {
    id: "france24-americas",
    name: "France 24 Americas",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "americas",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/americas/rss",
    attribution: "France 24 RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 36,
    enabled: true
  },
  {
    id: "france24-asia-pacific",
    name: "France 24 Asia-Pacific",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "asia-indo-pacific",
    base_url: "https://www.france24.com/",
    url: "https://www.france24.com/en/asia-pacific/rss",
    attribution: "France 24 RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 34,
    enabled: true
  },
  {
    id: "nyt-world",
    name: "The New York Times World",
    type: "rss",
    parser: "rss",
    category: "global-news",
    region_scope: "global",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 40,
    enabled: true
  },
  {
    id: "nyt-us",
    name: "The New York Times U.S.",
    type: "rss",
    parser: "rss",
    category: "global-news",
    region_scope: "us-global",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 48,
    enabled: true
  },
  {
    id: "nyt-africa",
    name: "The New York Times Africa",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "africa",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 36,
    enabled: true
  },
  {
    id: "nyt-americas",
    name: "The New York Times Americas",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "americas",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 38,
    enabled: true
  },
  {
    id: "nyt-asia-pacific",
    name: "The New York Times Asia Pacific",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "asia-indo-pacific",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 34,
    enabled: true
  },
  {
    id: "nyt-middle-east",
    name: "The New York Times Middle East",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    base_url: "https://www.nytimes.com/",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml",
    attribution: "New York Times RSS",
    request_interval_ms: 20 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 3000,
    minimumScore: 32,
    enabled: true
  },
  {
    id: "guardian-world",
    name: "The Guardian World",
    type: "rss",
    category: "global-news",
    region_scope: "global",
    url: "https://www.theguardian.com/world/rss",
    enabled: true
  },
  {
    id: "npr-world",
    name: "NPR World",
    type: "rss",
    category: "global-news",
    region_scope: "global",
    url: "https://feeds.npr.org/1004/rss.xml",
    enabled: true
  },
  {
    id: "dw-world",
    name: "Deutsche Welle World",
    type: "rss",
    category: "global-news",
    region_scope: "global",
    url: "https://rss.dw.com/xml/rss-en-all",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Conflict research / OSINT / strategy analysis
  // ---------------------------------------------------------------------------
  {
    id: "long-war-journal",
    name: "FDD Long War Journal",
    type: "rss",
    category: "conflict-analysis",
    region_scope: "global",
    url: "https://www.longwarjournal.org/feed",
    enabled: true
  },
  {
    id: "bellingcat",
    name: "Bellingcat",
    type: "rss",
    category: "osint",
    region_scope: "global",
    url: "https://www.bellingcat.com/feed/",
    enabled: true
  },
  {
    id: "oryx",
    name: "Oryx",
    type: "rss",
    category: "osint",
    region_scope: "global",
    url: "https://www.oryxspioenkop.com/feeds/posts/default?alt=rss",
    enabled: true
  },
  {
    id: "modern-war-institute",
    name: "Modern War Institute",
    type: "rss",
    category: "conflict-analysis",
    region_scope: "global",
    url: "https://mwi.westpoint.edu/feed/",
    enabled: true
  },
  {
    id: "csis-feed",
    name: "CSIS",
    type: "rss",
    category: "strategic-analysis",
    region_scope: "global",
    url: "https://www.csis.org/rss.xml",
    enabled: true
  },
  {
    id: "atlantic-council-feed",
    name: "Atlantic Council",
    type: "rss",
    category: "strategic-analysis",
    region_scope: "global",
    url: "https://www.atlanticcouncil.org/feed/",
    enabled: true
  },
  {
    id: "fdd-feed",
    name: "Foundation for Defense of Democracies",
    type: "rss",
    category: "strategic-analysis",
    region_scope: "global",
    url: "https://www.fdd.org/feed/",
    enabled: true
  },
  {
    id: "political-geography-now",
    name: "Political Geography Now",
    type: "rss",
    category: "conflict-analysis",
    region_scope: "global",
    url: "https://www.polgeonow.com/feeds/posts/default?alt=rss",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Additional defense / command-and-control / cyber feeds
  // ---------------------------------------------------------------------------
  {
    id: "defense-daily",
    name: "Defense Daily",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.defensedaily.com/feed/",
    enabled: true
  },
  {
    id: "global-security-review",
    name: "Global Security Review",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://globalsecurityreview.com/feed/",
    enabled: true
  },
  {
    id: "defensescoop",
    name: "DefenseScoop",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://defensescoop.com/feed/",
    enabled: true
  },
  {
    id: "c4isrnet",
    name: "C4ISRNET",
    type: "rss",
    category: "defense-tech",
    region_scope: "global",
    url: "https://www.c4isrnet.com/arc/outboundfeeds/rss/",
    enabled: true
  },
  {
    id: "task-and-purpose",
    name: "Task & Purpose",
    type: "rss",
    category: "military-news",
    region_scope: "us-global",
    url: "https://taskandpurpose.com/feed/",
    enabled: true
  },
  {
    id: "shephard-media-news",
    name: "Shephard Media News",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.shephardmedia.com/news/feed/",
    enabled: true
  },
  {
    id: "aviation-defense-market-reports",
    name: "Aviation and Defense Market Reports",
    type: "rss",
    category: "air",
    region_scope: "global",
    url: "https://aviationanddefensemarketreports.com/feed/",
    enabled: true
  },
  {
    id: "the-aviationist",
    name: "The Aviationist",
    type: "rss",
    category: "air",
    region_scope: "global",
    url: "https://theaviationist.com/feed/",
    enabled: true
  },
  {
    id: "militaryleak",
    name: "MilitaryLeak",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://militaryleak.com/feed/",
    enabled: true
  },
  {
    id: "military-times-news",
    name: "Military Times News",
    type: "rss",
    category: "military-news",
    region_scope: "us-global",
    url: "https://www.militarytimes.com/arc/outboundfeeds/rss/category/news/?outputType=xml",
    enabled: true
  },
  {
    id: "edr-magazine",
    name: "EDR Magazine",
    type: "rss",
    category: "defense-news",
    region_scope: "europe",
    url: "https://www.edrmagazine.eu/feed",
    enabled: true
  },
  {
    id: "euro-sd",
    name: "European Security & Defence",
    type: "rss",
    category: "defense-news",
    region_scope: "europe",
    url: "https://euro-sd.com/feed/",
    enabled: true
  },
  {
    id: "the-record-cyber",
    name: "The Record Cyber",
    type: "rss",
    category: "cyber",
    region_scope: "global",
    url: "https://therecord.media/feed",
    enabled: true
  },
  {
    id: "bleepingcomputer",
    name: "BleepingComputer",
    type: "rss",
    category: "cyber",
    region_scope: "global",
    url: "https://www.bleepingcomputer.com/feed/",
    enabled: true
  },
  {
    id: "krebs-on-security",
    name: "Krebs on Security",
    type: "rss",
    category: "cyber",
    region_scope: "global",
    url: "https://krebsonsecurity.com/feed/",
    enabled: true
  },
  {
    id: "cisa-advisories",
    name: "CISA Advisories",
    type: "rss",
    category: "cyber",
    region_scope: "us-global",
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Regional conflict feeds
  // ---------------------------------------------------------------------------
  {
    id: "times-of-israel",
    name: "The Times of Israel",
    type: "rss",
    category: "regional-conflict",
    region_scope: "israel-palestine-middle-east",
    url: "https://www.timesofisrael.com/feed/",
    enabled: true
  },
  {
    id: "jerusalem-post",
    name: "The Jerusalem Post",
    type: "rss",
    category: "regional-conflict",
    region_scope: "israel-palestine-middle-east",
    url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx",
    health: "healthy",
    last_verified: "2026-08-08",
    enabled: true
  },
  {
    id: "middle-east-eye",
    name: "Middle East Eye",
    type: "rss",
    parser: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    base_url: "https://www.middleeasteye.net/",
    url: "https://www.middleeasteye.net/rss",
    attribution: "Middle East Eye RSS",
    request_interval_ms: 15 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 30,
    enabled: true
  },
  {
    id: "kyiv-independent",
    name: "Kyiv Independent",
    type: "rss",
    category: "regional-conflict",
    region_scope: "ukraine",
    url: "https://kyivindependent.com/news-archive/rss/",
    health: "healthy",
    last_verified: "2026-08-08",
    enabled: true
  },
  {
    id: "ukrainska-pravda-en",
    name: "Ukrainska Pravda English",
    type: "rss",
    category: "regional-conflict",
    region_scope: "ukraine",
    url: "https://www.pravda.com.ua/eng/rss/",
    enabled: true
  },
  {
    id: "moscow-times",
    name: "The Moscow Times",
    type: "rss",
    category: "regional-conflict",
    region_scope: "russia",
    url: "https://www.themoscowtimes.com/rss/news",
    enabled: true
  },
  {
    id: "balkan-insight",
    name: "Balkan Insight",
    type: "rss",
    category: "regional-conflict",
    region_scope: "balkans-europe",
    url: "https://balkaninsight.com/feed/",
    enabled: true
  },
  {
    id: "scmp-world",
    name: "South China Morning Post World",
    type: "rss",
    category: "regional-conflict",
    region_scope: "china-indo-pacific",
    url: "https://www.scmp.com/rss/91/feed",
    enabled: true
  },
  {
    id: "military-africa",
    name: "Military Africa",
    type: "rss",
    category: "regional-defense",
    region_scope: "africa",
    url: "https://www.military.africa/feed/",
    enabled: true
  },

  // ---------------------------------------------------------------------------
  // Official military feeds. Useful, but filter aggressively because these often
  // include admin, awards, medical, family, recruiting, and ceremony noise.
  // ---------------------------------------------------------------------------
  {
    id: "us-defense-gov-news",
    name: "U.S. Department of Defense News",
    type: "rss",
    category: "official-military",
    region_scope: "us-global",
    url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=10&ContentType=1&Site=945",
    enabled: true
  },
  {
    id: "uk-mod-news",
    name: "UK Ministry of Defence",
    type: "rss",
    category: "official-military",
    region_scope: "uk-europe-global",
    url: "https://www.gov.uk/government/organisations/ministry-of-defence.atom",
    enabled: true
  },
  {
    id: "navy-mil-top-stories",
    name: "U.S. Navy Top Stories",
    type: "rss",
    category: "official-naval",
    region_scope: "us-global",
    url: "https://www.navy.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1066&Category=110",
    enabled: true
  },
  {
    id: "af-mil-news",
    name: "U.S. Air Force News",
    type: "rss",
    category: "official-air",
    region_scope: "us-global",
    url: "https://www.af.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1&Category=752",
    enabled: true
  },
  {
    id: "us-war-dept-news",
    name: "Department of War News Feed",
    type: "rss",
    category: "official-military",
    region_scope: "us-global",
    url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?max=400&ContentType=1&Site=945",
    enabled: true,
    note: "Official RSS tested locally. Broad official news source; keep strict conflict filtering."
  },
  {
    id: "faa-cleared-for-takeoff",
    name: "FAA Cleared for Takeoff",
    type: "rss",
    category: "airspace",
    region_scope: "us-global",
    url: "https://www.faa.gov/blog/cleared_for_takeoff/rss.xml",
    enabled: true,
    note: "Official FAA blog RSS tested locally. Broad aviation source; strict conflict filtering should remove general-admin noise."
  },
  {
    id: "space-systems-command",
    name: "Space Systems Command",
    type: "rss",
    category: "space",
    region_scope: "us-global",
    url: "https://www.ssc.spaceforce.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1352&Category=21940",
    enabled: false,
    note: "Candidate official RSS. Enable after local test."
  },
  {
    id: "dsca-news",
    name: "DSCA Security Cooperation News",
    type: "rss",
    category: "arms-sales",
    region_scope: "global",
    url: "https://www.dsca.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=700&Site=1509&isdashboardselected=0&max=100",
    enabled: true,
    note: "Official DSCA RSS tested locally. Arms-sales/procurement items should remain Intel Wire unless promoted by strict operational-event logic."
  },
  {
    id: "dsca-featured-news",
    name: "DSCA Featured News",
    type: "rss",
    category: "defense-policy",
    region_scope: "global",
    url: "https://www.dsca.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&SelectFeaturedContent=1&Site=1509&dashboardmoduleid=63543&max=8&formatxml=0",
    enabled: true,
    note: "Official DSCA featured-content RSS tested locally."
  },

  // ---------------------------------------------------------------------------
  // Candidate sources. Good coverage, but keep disabled until tested locally.
  // ---------------------------------------------------------------------------
  {
    id: "defense-one-all",
    name: "Defense One",
    type: "rss",
    category: "defense-policy",
    region_scope: "global",
    url: "https://www.defenseone.com/rss/all/",
    enabled: false,
    note: "Candidate. Test first to avoid noise."
  },
  {
    id: "real-clear-defense",
    name: "RealClearDefense",
    type: "rss",
    category: "defense-news",
    region_scope: "global",
    url: "https://www.realcleardefense.com/rss",
    enabled: false,
    note: "Candidate. URL may be HTML page or RSS depending on server behavior."
  },
  {
    id: "military-watch-magazine",
    name: "Military Watch Magazine",
    type: "rss",
    category: "defense-news",
    region_scope: "global-russia-china-asia",
    url: "https://militarywatchmagazine.com/feeds/headlines",
    enabled: true,
    note: "Enabled after local RSS parser test on the dedicated headlines feed."
  },
  {
    id: "eurasian-times",
    name: "EurAsian Times",
    type: "rss",
    category: "regional-defense",
    region_scope: "india-china-russia-middle-east",
    url: "https://www.eurasiantimes.com/feed/",
    enabled: false,
    note: "Candidate. Broad source; enable only if filter quality is acceptable."
  },
  {
    id: "middle-east-monitor",
    name: "Middle East Monitor",
    type: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    url: "https://www.middleeastmonitor.com/feed/",
    enabled: false,
    note: "Candidate. The Disqus latest.rss URL is comments-only, not article news; enable only if an official article RSS passes quality checks."
  },
  {
    id: "al-monitor",
    name: "Al-Monitor",
    type: "rss",
    category: "regional-conflict",
    region_scope: "middle-east",
    url: "https://www.al-monitor.com/rss",
    enabled: false,
    note: "Candidate. Broad political source; enable only if parser works and quality is acceptable."
  },
  {
    id: "janes-defense-news",
    name: "Janes Defence News",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence/rss",
    enabled: false,
    note: "Disabled after local test: provided RSS URL returned HTTP 404."
  },
  {
    id: "janes-defense-news-1",
    name: "Janes Defence News Page 1",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence-intelligence-insights/defence-news/1",
    enabled: false,
    note: "Disabled after local test: page is not a valid RSS feed for the current parser flow."
  },
  {
    id: "janes-defense-news-2",
    name: "Janes Defence News Page 2",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence-intelligence-insights/defence-news/2",
    enabled: false,
    note: "Disabled after local test: page is not a valid RSS feed for the current parser flow."
  },
  {
    id: "janes-defense-news-3",
    name: "Janes Defence News Page 3",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence-intelligence-insights/defence-news/3",
    enabled: false,
    note: "Disabled after local test: page is not a valid RSS feed for the current parser flow."
  },
  {
    id: "janes-defense-news-4",
    name: "Janes Defence News Page 4",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence-intelligence-insights/defence-news/4",
    enabled: false,
    note: "Disabled after local test: page is not a valid RSS feed for the current parser flow."
  },
  {
    id: "janes-defense-news-5",
    name: "Janes Defence News Page 5",
    type: "rss",
    category: "defense-intel",
    region_scope: "global",
    url: "https://www.janes.com/defence-intelligence-insights/defence-news/5",
    enabled: false,
    note: "Disabled after local test: page is not a valid RSS feed for the current parser flow."
  },
  {
    id: "military-times-mobile-rss",
    name: "Military Times Mobile RSS",
    type: "rss",
    category: "military-news",
    region_scope: "us-global",
    url: "https://www.militarytimes.com/m/rss/",
    enabled: false,
    note: "Disabled after local test: URL returned HTML instead of an RSS feed."
  }

  // Disabled broken/blocked sources from previous local tests:
  // - International Crisis Group CrisisWatch: 403
  // - War.gov News: 403
  // - RUSI Analysis: 404
  // - ReliefWeb RSS: 404
];

const LIVE_HTML_SOURCES = [
  {
    id: "middle-east-eye-live",
    name: "Middle East Eye Live",
    type: "html",
    parser: "live-html",
    category: "regional-conflict",
    region_scope: "middle-east",
    base_url: "https://www.middleeasteye.net/",
    url: "https://www.middleeasteye.net/live",
    attribution: "Middle East Eye Live",
    request_interval_ms: 10 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2500,
    minimumScore: 28,
    limit: 20,
    enabled: true
  }
];

const TELEGRAM_SOURCES = [
  {
    id: "intelslava",
    name: "Intel Slava",
    type: "telegram",
    parser: "telegram-preview",
    category: "osint",
    region_scope: "global",
    base_url: "https://t.me/intelslava",
    url: "https://t.me/s/intelslava",
    channel: "intelslava",
    attribution: "Telegram / Intel Slava",
    request_interval_ms: 5 * 60 * 1000,
    retry_attempts: 1,
    retry_backoff_ms: 2000,
    minimumScore: 46,
    limit: 20,
    enabled: true
  }
];

const API_SOURCES = [
  {
    id: "reliefweb-reports",
    name: "ReliefWeb Reports",
    type: "api",
    category: "humanitarian-conflict",
    region_scope: "global",
    url: "https://api.reliefweb.int/v2/reports?appname=battlespacex-stratops-conflict-feed",
    enabled: false,
    note: "Disabled until ReliefWeb appname/API access is approved."
  },
  {
    id: "gdelt-doc-api",
    name: "GDELT Doc API",
    type: "api",
    category: "global-events",
    region_scope: "global",
    url: "https://api.gdeltproject.org/api/v2/doc/doc",
    enabled: false,
    note: "Use separate GDELT worker with throttling/backoff to avoid 429."
  },
  {
    id: "acled-api",
    name: "ACLED API",
    type: "api",
    category: "conflict-events",
    region_scope: "global",
    url: "https://api.acleddata.com/acled/read",
    enabled: false,
    note: "Requires ACLED access credentials and a dedicated adapter."
  },
  {
    id: "ucdp-api",
    name: "UCDP API",
    type: "api",
    category: "conflict-events",
    region_scope: "global",
    url: "https://ucdpapi.pcr.uu.se/api/gedevents/",
    enabled: false,
    note: "Requires a dedicated structured-event adapter before enabling."
  },
  {
    id: "cisa-kev-json",
    name: "CISA Known Exploited Vulnerabilities",
    type: "api",
    category: "cyber",
    region_scope: "global",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    enabled: false,
    note: "JSON feed, not RSS. Enable after adding API/JSON normalization."
  },
  {
    id: "gdacs-alerts",
    name: "GDACS Alerts",
    type: "api",
    category: "crisis-alerts",
    region_scope: "global",
    url: "https://www.gdacs.org/xml/rss.xml",
    enabled: false,
    note: "Disaster/crisis signal source. Use separate adapter and filtering before enabling."
  },
  {
    id: "newsapi-everything",
    name: "NewsAPI Everything",
    type: "api",
    category: "global-news",
    region_scope: "global",
    url: "https://newsapi.org/v2/everything",
    enabled: false,
    note: "Requires API key and query adapter."
  },
  {
    id: "event-registry-api",
    name: "Event Registry API",
    type: "api",
    category: "global-news",
    region_scope: "global",
    url: "https://eventregistry.org/api/v1/article/getArticles",
    enabled: false,
    note: "Requires API key and query adapter."
  }
];

function getRssSources(options = {}) {
  const includeDisabled = options.includeDisabled || false;

  if (includeDisabled) {
    return RSS_SOURCES.map(normalizeSourceDefinition);
  }

  return RSS_SOURCES.filter(source => source.enabled !== false).map(normalizeSourceDefinition);
}

function getApiSources(options = {}) {
  const includeDisabled = options.includeDisabled || false;

  if (includeDisabled) {
    return API_SOURCES.map(normalizeSourceDefinition);
  }

  return API_SOURCES.filter(source => source.enabled !== false).map(normalizeSourceDefinition);
}

function getLiveHtmlSources(options = {}) {
  const includeDisabled = options.includeDisabled || false;

  if (includeDisabled) {
    return LIVE_HTML_SOURCES.map(normalizeSourceDefinition);
  }

  return LIVE_HTML_SOURCES.filter(source => source.enabled !== false).map(normalizeSourceDefinition);
}

function getTelegramSources(options = {}) {
  const includeDisabled = options.includeDisabled || false;

  if (includeDisabled) {
    return TELEGRAM_SOURCES.map(normalizeSourceDefinition);
  }

  return TELEGRAM_SOURCES.filter(source => source.enabled !== false).map(normalizeSourceDefinition);
}

function getAllConflictSources(options = {}) {
  return [
    ...getRssSources(options),
    ...getLiveHtmlSources(options),
    ...getTelegramSources(options),
    ...getApiSources(options)
  ];
}

export {
  RSS_SOURCES,
  LIVE_HTML_SOURCES,
  TELEGRAM_SOURCES,
  API_SOURCES,
  getRssSources,
  getLiveHtmlSources,
  getTelegramSources,
  getApiSources,
  getAllConflictSources
};
