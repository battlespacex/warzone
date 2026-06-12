// apps/worker/src/status-sources.js
// StratOps status-layer source registry.
// Purpose: production-safe ingestion for cyber + airspace + infrastructure
// disruption signals using only clearly allowed public APIs/RSS feeds.
//
// Important:
// - Do not enable sources that require scraping hidden/private endpoints.
// - Cloudflare Radar, IODA, GPSJam, and aviation/NOTAM candidates remain disabled
//   until explicit public endpoint contracts are approved for this worker.
// - Cloudflare Radar should use documented API access, not radar.cloudflare.com scraping.

const STATUS_SOURCES = [
  {
    id: "ooni-incidents-api",
    name: "OONI Incidents API",
    type: "api",
    adapter: "ooni_incidents",
    category: "internet_outage",
    region_scope: "global",
    url: "https://api.ooni.io/api/v1/incidents/search?limit=25",
    attribution_url: "https://ooni.org/",
    enabled: true
  },
  {
    id: "ooni-rss",
    name: "OONI Blog RSS",
    type: "rss",
    adapter: "rss",
    category: "cyber_disruption",
    region_scope: "global",
    url: "https://ooni.org/index.xml",
    enabled: true
  },
  {
    id: "the-record-rss",
    name: "The Record",
    type: "rss",
    adapter: "rss",
    category: "cyber_disruption",
    region_scope: "global",
    url: "https://therecord.media/feed",
    enabled: true
  },
  {
    id: "bleepingcomputer-rss",
    name: "BleepingComputer",
    type: "rss",
    adapter: "rss",
    category: "cyber_disruption",
    region_scope: "global",
    url: "https://www.bleepingcomputer.com/feed/",
    enabled: true
  },
  {
    id: "securityweek-rss",
    name: "SecurityWeek",
    type: "rss",
    adapter: "rss",
    category: "cyber_disruption",
    region_scope: "global",
    url: "https://www.securityweek.com/feed/",
    enabled: true
  },
  {
    id: "thehackernews-rss",
    name: "The Hacker News",
    type: "rss",
    adapter: "rss",
    category: "cyber_disruption",
    region_scope: "global",
    url: "https://thehackernews.com/feeds/posts/default?alt=rss",
    enabled: true
  },
  {
    id: "twz-status-fallback",
    name: "The War Zone",
    type: "rss",
    adapter: "rss",
    category: "aviation_disruption",
    region_scope: "global",
    url: "https://www.twz.com/feed",
    enabled: true
  },
  {
    id: "defense-news-global-status-fallback",
    name: "Defense News Global",
    type: "rss",
    adapter: "rss",
    category: "airspace_restriction",
    region_scope: "global",
    url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/",
    enabled: true
  },

  // Candidate only: official service exists, but production use should wait for
  // explicit public endpoint approval and/or API key handling.
  {
    id: "cloudflare-radar-candidate",
    name: "Cloudflare Radar",
    type: "api",
    adapter: "cloudflare_radar_stub",
    category: "internet_outage",
    region_scope: "global",
    url: "https://radar.cloudflare.com/",
    docs_url: "https://developers.cloudflare.com/radar/",
    enabled: false,
    requires_env: ["CLOUDFLARE_RADAR_API_KEY"],
    note: "Use documented Cloudflare Radar API with token/API contract; do not scrape the public dashboard because it can return browser-challenge HTML."
  },
  {
    id: "ioda-caida-candidate",
    name: "IODA / CAIDA",
    type: "api",
    adapter: "ioda_stub",
    category: "internet_outage",
    region_scope: "global",
    url: "https://api.ioda.inetintel.cc.gatech.edu/v2/",
    docs_url: "https://api.ioda.inetintel.cc.gatech.edu/v2/",
    enabled: false,
    note: "API root and datasources endpoint tested reachable. Outage alerts require parameters; enable after implementing a parameterized adapter."
  },
  {
    id: "gpsjam-candidate",
    name: "GPSJam.org",
    type: "candidate",
    adapter: "gpsjam_stub",
    category: "gps_jamming",
    region_scope: "global",
    url: "https://gpsjam.org/",
    enabled: false,
    note: "Enable only if public API/download access or permission is available."
  },
  {
    id: "aviation-status-candidate",
    name: "Official Aviation / NOTAM Candidate",
    type: "candidate",
    adapter: "aviation_stub",
    category: "airspace_restriction",
    region_scope: "global",
    url: "https://www.faa.gov/air_traffic/publications/us_restrictions",
    enabled: false,
    note: "Do not scrape paid/private flight tracking or unofficial NOTAM mirrors."
  }
];

function getStatusSources() {
  return STATUS_SOURCES.slice();
}

function getEnabledStatusSources() {
  return STATUS_SOURCES.filter((source) => source.enabled === true);
}

function getStatusSourcesByType(type = "") {
  const key = String(type || "").trim().toLowerCase();
  return STATUS_SOURCES.filter((source) => String(source.type || "").toLowerCase() === key);
}

export {
  STATUS_SOURCES,
  getStatusSources,
  getEnabledStatusSources,
  getStatusSourcesByType
};
