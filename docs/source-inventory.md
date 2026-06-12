# StratOps Source Inventory

Generated: 2026-06-06T23:00:39.540Z

## Summary

- Total configured sources: 98
- Enabled sources: 81
- Working enabled sources: 81
- Failing enabled sources: 0
- Disabled sources: 17
- Conflict registry sources: 86
- Status registry sources: 12
- By type: rss 93, api 3, candidate 2
- Enabled by type: rss 80, api 1

## Latest Smoke Test

- Conflict feed: 73/73 enabled sources working; 0 failed; 2738 raw items; 513 filtered items.
- Status feed: 8/8 enabled sources working; 0 failed; 524 raw items.

## Failing Enabled Sources

_None._

## Disabled Broken / Replacement Needed

| Registry | Name | Type | URL | Reason |
| --- | --- | --- | --- | --- |
| conflict | Army Recognition Land Defense | rss | https://armyrecognition.com/news/army-news/feed/rss | Disabled after local smoke test: RSS parser failed on invalid entity character. |
| conflict | Army Recognition Naval Defense | rss | https://armyrecognition.com/news/navy-news/feed/rss | Disabled after local smoke test: feed was not recognized as RSS. |
| conflict | Army Recognition Aerospace Defense | rss | https://armyrecognition.com/news/aerospace-news/feed/rss | Disabled after local smoke test: RSS parser failed on invalid entity character. |
| conflict | Indian Defence Research Wing | rss | https://idrw.org/feed/ | Disabled after local smoke test: feed returned HTTP 404. |
| conflict | Janes Defence News | rss | https://www.janes.com/defence/rss | Disabled after local test: provided RSS URL returned HTTP 404. |
| conflict | Military Times Mobile RSS | rss | https://www.militarytimes.com/m/rss/ | Disabled after local test: URL returned HTML instead of an RSS feed. |

## Disabled Candidates / Needs Approval Or Adapter

| Registry | Name | Type | URL | Next Action |
| --- | --- | --- | --- | --- |
| conflict | Space Systems Command | rss | https://www.ssc.spaceforce.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1352&Category=21940 | Test parser quality and noise before enabling. |
| conflict | Defense One | rss | https://www.defenseone.com/rss/all/ | Test parser quality and noise before enabling. |
| conflict | RealClearDefense | rss | https://www.realcleardefense.com/rss | Test parser quality and noise before enabling. |
| conflict | Military Watch Magazine | rss | https://militarywatchmagazine.com/feed/ | Test parser quality and noise before enabling. |
| conflict | EurAsian Times | rss | https://www.eurasiantimes.com/feed/ | Test parser quality and noise before enabling. |
| conflict | Middle East Monitor | rss | https://www.middleeastmonitor.com/feed/ | Test parser quality and noise before enabling. |
| conflict | Al-Monitor | rss | https://www.al-monitor.com/rss | Test parser quality and noise before enabling. |
| status | Cloudflare Radar | api | https://radar.cloudflare.com/ | Requires Cloudflare Radar API token/contract and documented API adapter; do not scrape dashboard. |
| status | IODA / CAIDA | api | https://api.ioda.inetintel.cc.gatech.edu/v2/ | Implement parameterized IODA outage adapter, then enable. |
| status | GPSJam.org | candidate | https://gpsjam.org/ | Need public API/download permission before enabling. |
| status | Official Aviation / NOTAM Candidate | candidate | https://www.faa.gov/air_traffic/publications/us_restrictions | Need official/public NOTAM or airspace restriction endpoint before enabling. |

## Notes For Growth Toward 200 Sources

- Prefer RSS/API feeds with stable XML/JSON and clear public usage terms.
- Keep procurement and arms-sales sources in Intel Wire unless an item has a strict operational-event signal.
- Do not use comments feeds as news sources. The Middle East Monitor Disqus feed works technically but contains comments, not articles.
- Cloudflare Radar should be integrated through documented API access, not by scraping radar.cloudflare.com.
- IODA has a reachable API root; outage endpoints need parameterized adapter work before enabling.

The Excel-friendly full sheet is: docs/source-inventory.csv
