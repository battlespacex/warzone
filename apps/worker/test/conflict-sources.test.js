import test from "node:test";
import assert from "node:assert/strict";
import { getLiveHtmlSources, getRssSources, getTelegramSources } from "../src/conflict-sources.js";

test("conflict source registry includes requested NYT and regional France 24 feeds", () => {
  const sources = getRssSources();
  const byId = new Map(sources.map((source) => [source.id, source]));

  const expectedIds = [
    "france24-middle-east",
    "france24-africa",
    "france24-americas",
    "france24-asia-pacific",
    "nyt-world",
    "nyt-us",
    "nyt-africa",
    "nyt-americas",
    "nyt-asia-pacific",
    "nyt-middle-east",
  ];

  expectedIds.forEach((id) => {
    assert.ok(byId.has(id), `missing source ${id}`);
    const source = byId.get(id);
    assert.equal(source.type, "rss");
    assert.equal(source.parser, "rss");
    assert.ok(/^https?:\/\//i.test(source.url || ""));
    assert.ok(Number(source.request_interval_ms) > 0);
    assert.ok(Number(source.retry_backoff_ms) >= 0);
  });
});

test("existing requested conflict sources expose source policy metadata", () => {
  const sources = getRssSources({ includeDisabled: true });
  const france24 = sources.find((source) => source.id === "france24-en");
  const mee = sources.find((source) => source.id === "middle-east-eye");

  assert.equal(france24?.base_url, "https://www.france24.com/");
  assert.equal(france24?.attribution, "France 24 RSS");
  assert.equal(mee?.base_url, "https://www.middleeasteye.net/");
  assert.equal(mee?.attribution, "Middle East Eye RSS");
  assert.ok(Number(france24?.minimumScore) > 0);
  assert.ok(Number(mee?.minimumScore) > 0);
  assert.equal(france24?.enabled, false);
  assert.match(france24?.disabled_reason || "", /HTML.*index/i);
});

test("live html and telegram source registries include requested additions", () => {
  const liveSources = getLiveHtmlSources();
  const telegramSources = getTelegramSources();

  const meeLive = liveSources.find((source) => source.id === "middle-east-eye-live");
  const intelSlava = telegramSources.find((source) => source.id === "intelslava");

  assert.ok(meeLive, "missing middle-east-eye-live source");
  assert.equal(meeLive.type, "html");
  assert.equal(meeLive.parser, "live-html");
  assert.ok(Number(meeLive.minimumScore) > 0);
  assert.match(meeLive.url || "", /^https?:\/\//i);

  assert.ok(intelSlava, "missing intelslava source");
  assert.equal(intelSlava.type, "telegram");
  assert.equal(intelSlava.parser, "telegram-preview");
  assert.ok(Number(intelSlava.minimumScore) > 0);
  assert.match(intelSlava.url || "", /^https?:\/\//i);
});
