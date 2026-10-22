/* eslint-disable no-console */
// Local-only Chrome benchmark for the existing StratOps Intel Wire UI.
// This follows the normal entry/region flow and never changes authentication.
const { chromium } = require("../node_modules/playwright");

const APP_URL = process.env.STRATOPS_URL || "http://127.0.0.1:4173/pages/index.html";

async function nextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readPerfState(page) {
  return page.evaluate(() => {
    const state = window.__intelWirePerfState || {};
    return {
      longTasks: [...(state.longTasks || [])],
      mutations: Number(state.mutations || 0),
      addedNodes: Number(state.addedNodes || 0),
      removedNodes: Number(state.removedNodes || 0),
      rafIntervals: [...(state.rafIntervals || [])],
      longAnimationFrames: [...(state.longAnimationFrames || [])],
    };
  });
}

async function resetPerfState(page) {
  await page.evaluate(() => {
    const state = window.__intelWirePerfState;
    if (!state) return;
    state.longTasks.length = 0;
    state.mutations = 0;
    state.addedNodes = 0;
    state.removedNodes = 0;
    state.rafIntervals.length = 0;
    state.longAnimationFrames.length = 0;
  });
}

function summarizeCpuProfile(profile) {
  if (!profile?.samples?.length || !profile?.timeDeltas?.length) return [];
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  profile.samples.forEach((nodeId, index) => {
    const node = nodes.get(nodeId);
    if (!node) return;
    const frame = node.callFrame || {};
    const key = `${frame.functionName || "(anonymous)"}|${frame.url || ""}|${Number(frame.lineNumber || 0) + 1}`;
    totals.set(key, (totals.get(key) || 0) + Number(profile.timeDeltas[index] || 0) / 1000);
  });
  return [...totals.entries()]
    .map(([key, selfMs]) => {
      const [functionName, url, line] = key.split("|");
      return { functionName, url, line: Number(line), selfMs: Number(selfMs.toFixed(1)) };
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 15);
}

async function measure(page, name, action, {
  waitForSettled = false,
  cdp = null,
  eventSelector = "",
  eventType = "click",
} = {}) {
  await resetPerfState(page);
  if (eventSelector) {
    await page.evaluate(({ selector, type }) => {
      const target = document.querySelector(selector);
      const state = window.__intelWirePerfState;
      state.inputPaint = null;
      target?.addEventListener(type, () => {
        const receivedAt = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          state.inputPaint = { receivedAt, paintedAt: performance.now() };
        }));
      }, { capture: true, once: true });
    }, { selector: eventSelector, type: eventType });
  }
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const startedAt = await page.evaluate(() => performance.now());
  await action();
  await nextPaint(page);
  const paintedAt = await page.evaluate(() => performance.now());
  if (waitForSettled) {
    await page.waitForFunction(() => {
      const content = document.querySelector('[data-widget-id="feed"] .panel-content');
      return !content?.classList.contains("is-loading");
    }, null, { timeout: 5000 });
    await nextPaint(page);
  }
  const settledAt = await page.evaluate(() => performance.now());
  const inputPaint = eventSelector
    ? await page.evaluate(() => window.__intelWirePerfState?.inputPaint || null)
    : null;
  const perf = await readPerfState(page);
  const profile = cdp ? await cdp.send("Profiler.stop") : null;
  return {
    name,
    nextPaintMs: Number((paintedAt - startedAt).toFixed(1)),
    settledMs: Number((settledAt - startedAt).toFixed(1)),
    eventToNextPaintMs: inputPaint
      ? Number((inputPaint.paintedAt - inputPaint.receivedAt).toFixed(1))
      : undefined,
    longTasks: perf.longTasks,
    maxLongTaskMs: perf.longTasks.length ? Math.max(...perf.longTasks.map((task) => task.duration)) : 0,
    mutations: perf.mutations,
    addedNodes: perf.addedNodes,
    removedNodes: perf.removedNodes,
    topCpu: profile ? summarizeCpuProfile(profile.profile) : undefined,
  };
}

async function enterStratOps(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("#wz-pre-entry-enter").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#wz-pre-entry-enter").click();
  await page.locator("#intro-disclaimer-check").check();
  await page.locator("#wz-intro-accept").click();
  await page.locator(".wz-region-btn").first().click();
  await page.locator("#wz-region-confirm").click();
  await page.waitForFunction(() => !document.body.classList.contains("is-pre-entry"), null, { timeout: 30000 });
  await page.locator("[data-dock-widget=feed]").waitFor({ state: "visible", timeout: 30000 });
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-precise-memory-info"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const cdp = process.env.PROFILE === "1" ? await page.context().newCDPSession(page) : null;
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await enterStratOps(page);
  await page.evaluate(() => {
    const state = window.__intelWirePerfState = {
      longTasks: [], mutations: 0, addedNodes: 0, removedNodes: 0, rafIntervals: [], longAnimationFrames: [],
    };
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => state.longTasks.push({
          startTime: Number(entry.startTime.toFixed(1)),
          duration: Number(entry.duration.toFixed(1)),
        }));
      });
      observer.observe({ entryTypes: ["longtask"] });
      state.longTaskObserver = observer;
    } catch { }
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => state.longAnimationFrames.push({
          startTime: Number(entry.startTime.toFixed(1)),
          duration: Number(entry.duration.toFixed(1)),
          blockingDuration: Number((entry.blockingDuration || 0).toFixed(1)),
          renderStart: Number((entry.renderStart || 0).toFixed(1)),
          styleAndLayoutStart: Number((entry.styleAndLayoutStart || 0).toFixed(1)),
          scripts: Array.from(entry.scripts || []).slice(0, 5).map((script) => ({
            duration: Number((script.duration || 0).toFixed(1)),
            invoker: script.invoker || "",
            sourceURL: script.sourceURL || "",
          })),
        }));
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
      state.longAnimationFrameObserver = observer;
    } catch { }
    const feed = document.getElementById("live-feed-list");
    if (feed) {
      const observer = new MutationObserver((records) => {
        state.mutations += records.length;
        records.forEach((record) => {
          state.addedNodes += record.addedNodes.length;
          state.removedNodes += record.removedNodes.length;
        });
      });
      observer.observe(feed, { childList: true, subtree: true, characterData: true, attributes: true });
      state.mutationObserver = observer;
    }
  });

  const results = [];
  const widget = page.locator('[data-widget-id="feed"]');
  if (await widget.evaluate((node) => node.classList.contains("wz-is-hidden"))) {
    results.push(await measure(page, "open", () => page.locator("[data-dock-widget=feed]").click(), {
      cdp, eventSelector: "[data-dock-widget=feed]",
    }));
  }
  await page.waitForFunction(() => document.querySelectorAll("#live-feed-list .wz-feed-item").length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  results.push(await measure(page, "country-dropdown-click", () => page.locator("#wz-feed-filter-country").click(), {
    eventSelector: "#wz-feed-filter-country",
  }));
  await page.keyboard.press("Escape");
  const countryValue = await page.locator("#wz-feed-filter-country option").evaluateAll((options) => (
    options.find((option) => option.value !== "all")?.value || "all"
  ));
  results.push(await measure(page, "country-filter", () => page.locator("#wz-feed-filter-country").selectOption(countryValue), {
    waitForSettled: true, eventSelector: "#wz-feed-filter-country", eventType: "change",
  }));
  results.push(await measure(page, "time-dropdown-click", () => page.locator("#wz-feed-filter-time").click(), {
    eventSelector: "#wz-feed-filter-time",
  }));
  await page.keyboard.press("Escape");
  results.push(await measure(page, "time-filter", () => page.locator("#wz-feed-filter-time").selectOption("30d"), {
    waitForSettled: true, eventSelector: "#wz-feed-filter-time", eventType: "change",
  }));

  // Restore unfiltered data before scroll/load-more measurements.
  await page.locator("#wz-feed-filter-country").selectOption("all");
  await page.waitForFunction(() => !document.querySelector('[data-widget-id="feed"] .panel-content')?.classList.contains("is-loading"));
  await page.locator("#wz-feed-filter-time").selectOption("all");
  await page.waitForFunction(() => !document.querySelector('[data-widget-id="feed"] .panel-content')?.classList.contains("is-loading"));
  await page.waitForTimeout(250);

  await resetPerfState(page);
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const scrollBox = page.locator('[data-widget-id="feed"] .panel-content');
  const box = await scrollBox.boundingBox();
  await page.evaluate(() => {
    const state = window.__intelWirePerfState;
    let previous = performance.now();
    let frames = 0;
    const sample = (now) => {
      state.rafIntervals.push(Number((now - previous).toFixed(1)));
      previous = now;
      frames += 1;
      if (frames < 90) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(40);
    }
  }
  await page.waitForTimeout(1300);
  const scrollPerf = await readPerfState(page);
  const scrollProfile = cdp ? await cdp.send("Profiler.stop") : null;
  const scrollIntervals = scrollPerf.rafIntervals.slice(1);
  results.push({
    name: "scroll",
    frames: scrollIntervals.length,
    averageFrameMs: scrollIntervals.length ? Number((scrollIntervals.reduce((sum, value) => sum + value, 0) / scrollIntervals.length).toFixed(1)) : 0,
    maxFrameMs: scrollIntervals.length ? Math.max(...scrollIntervals) : 0,
    framesOver50Ms: scrollIntervals.filter((value) => value > 50).length,
    longTasks: scrollPerf.longTasks,
    longAnimationFrames: scrollPerf.longAnimationFrames,
    mutations: scrollPerf.mutations,
    topCpu: scrollProfile ? summarizeCpuProfile(scrollProfile.profile) : undefined,
  });

  if (await page.locator("#live-feed-load-more").isVisible()) {
    results.push(await measure(page, "load-more", () => page.locator("#live-feed-load-more").click(), {
      waitForSettled: true, cdp, eventSelector: "#live-feed-load-more",
    }));
  }
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    results.push(await measure(page, `close-${cycle}`, () => widget.locator("[data-widget-close]").click(), {
      eventSelector: '[data-widget-id="feed"] [data-widget-close]',
    }));
    results.push(await measure(page, `reopen-${cycle}`, () => page.locator("[data-dock-widget=feed]").click(), {
      eventSelector: "[data-dock-widget=feed]",
    }));
  }

  const summary = await page.evaluate(() => ({
    cards: document.querySelectorAll("#live-feed-list .wz-feed-item").length,
    totalText: document.getElementById("live-feed-count")?.textContent || "",
    countryOptions: document.querySelectorAll("#wz-feed-filter-country option").length,
    feedDomNodes: document.querySelectorAll('[data-widget-id="feed"] *').length,
    pageDomNodes: document.querySelectorAll("body *").length,
    images: document.querySelectorAll("#live-feed-list img").length,
    videos: document.querySelectorAll("#live-feed-list video, #live-feed-list iframe").length,
    memory: performance.memory ? {
      usedJSHeapMB: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)),
      totalJSHeapMB: Number((performance.memory.totalJSHeapSize / 1048576).toFixed(1)),
    } : null,
  }));
  console.log(JSON.stringify({ url: APP_URL, results, summary, consoleErrors: consoleErrors.slice(0, 20) }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
