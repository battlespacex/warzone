import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReportDisplayFields,
  formatReportLocation,
  humanizeSourceName,
  stripFeedJunk,
} from "../../shared/reporting-display.js";

test("report display removes emoji, decorative symbols and Telegram promotion without losing facts", () => {
  const input = "\u26A1\uFE0F\u{1F310} Missile strike reported near Port Said @channel https://t.me/example #PortSaid tweet Rainbet.com crypto casino";
  const cleaned = stripFeedJunk(input);
  assert.equal(cleaned, "Missile strike reported near Port Said PortSaid");
  assert.doesNotMatch(cleaned, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.doesNotMatch(cleaned, /@|https?:|casino|tweet/i);
});

test("report display removes truncated markup and publisher boilerplate", () => {
  const cleaned = stripFeedJunk('Submitted by MEE staff on Fri, 08/07/2026 - 10:46 Military officials reported an attack. &lt;source srcset=&quot;');
  assert.equal(cleaned, "Military officials reported an attack.");
  assert.equal(stripFeedJunk("The post Example headline appeared first on FDD. Independent reporting follows."), "Independent reporting follows.");
  assert.equal(stripFeedJunk("Operational headline first appeared on UK Defence Journal. Additional context."), "Operational headline Additional context.");
});

test("report display extracts an existing English description while retaining language provenance", () => {
  const display = buildReportDisplayFields({
    title: "\u041C\u0456\u0441\u0446\u0435: \u041A\u043B\u0456\u0449\u0456\u0457\u0432\u043A\u0430",
    summary: "\u041E\u043F\u0438\u0441: \u041F\u043E\u0434\u0456\u044F. Description: An enemy drone recorded strike attempts near Klishchiivka. No independent confirmation was available. Source: WarArchive",
    source_name: "TG / Global_OSINT44",
    verification_state: "REPORTED",
    independent_source_family_count: 1,
    location_precision: "UNKNOWN",
  });
  assert.equal(display.report_display_eligible, true);
  assert.match(display.display_title, /enemy drone/i);
  assert.doesNotMatch(display.display_title, /[\u0400-\u04FF]/u);
  assert.equal(display.translation_status, "embedded_english_extracted");
  assert.equal(display.original_language, "mixed");
  assert.equal(display.display_source_name, "Global OSINT");
});

test("foreign-only content is preserved in data but omitted from English report selection", () => {
  const display = buildReportDisplayFields({
    title: "\u0421\u043E\u043E\u0431\u0449\u0430\u0435\u0442\u0441\u044F \u043E \u0432\u0437\u0440\u044B\u0432\u0435",
    summary: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0441\u0432\u0435\u0434\u0435\u043D\u0438\u0439 \u043D\u0435\u0442.",
  });
  assert.equal(display.report_display_eligible, false);
  assert.equal(display.display_title, null);
  assert.equal(display.translation_status, "unavailable");
});

test("source identifiers become professional source names", () => {
  assert.equal(humanizeSourceName("telegram:tg-global-osint44"), "Global OSINT");
  assert.equal(humanizeSourceName("TG / OSINTLive"), "OSINT Live");
  assert.equal(humanizeSourceName("TG / wfwitness"), "War Front Witness");
  assert.equal(humanizeSourceName("France 24 Live News"), "France 24 Live News");
  assert.equal(humanizeSourceName("FDD"), "Foundation for Defense of Democracies");
  assert.equal(humanizeSourceName("TG / CyberspecNews"), "Cyberspec News");
  assert.equal(humanizeSourceName("com-ua"), "Ukrainska Pravda");
});

test("regional and unknown locations are formatted without fabricated precision", () => {
  assert.deepEqual(formatReportLocation({
    location_precision: "REGIONAL",
    event_region: "Southern Lebanon",
    latitude: 33.2,
    longitude: 35.3,
  }), { display_location: "Southern Lebanon", location_detail: "Regional context" });
  assert.deepEqual(formatReportLocation({
    location_precision: "UNKNOWN",
    location_label: "July, Malawi",
    latitude: -13.2,
    longitude: 34.3,
  }), { display_location: null, location_detail: null });
});

test("report titles remove decorative dash leads and dangling feed-list clauses", () => {
  const display = buildReportDisplayFields({
    title: "— Video of airstrikes by Su-34 aircraft -- targets reported as:",
    summary: "Video of airstrikes by Su-34 aircraft targeting two UAV command posts.",
    source_name: "TG / CyberspecNews",
  });
  assert.equal(display.report_display_eligible, true);
  assert.equal(display.display_title, "Video of airstrikes by Su-34 aircraft");
});

test("report selection rejects attribution-only repost titles while retaining the source item", () => {
  const display = buildReportDisplayFields({
    title: "Nuno Felix",
    summary: "Nuno Felix RT @analyst: A long-form assessment of cyberattacks and drone threats.",
    source_name: "TG / OSINTLive",
  });
  assert.equal(display.report_display_eligible, false);
  assert.equal(display.display_title, null);
});
