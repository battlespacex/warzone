import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const chrome = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const css = fs.readFileSync(fileURLToPath(new URL("../../../dev/assets/css/mediaqueries.css", import.meta.url)), "utf8");

test("mobile widget collapse releases content and backdrop across phone and tablet sizes", async (t) => {
  if (!fs.existsSync(chrome)) return t.skip("Installed Chrome required");
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  t.after(() => browser.close());
  for (const width of [390, 430, 768, 820]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div class="wz-widget-backdrop" hidden></div><aside class="warzone-panel--floating warzone-widget is-collapsed"><div class="panel-container"><div class="panel-head"><button data-panel-collapse>Collapse</button><button class="wz-orbital-mobile-close">Close</button></div><div class="panel-content">Operational details</div></div></aside>`, { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(() => {
      const panel = document.querySelector("aside");
      const content = panel.querySelector(".panel-content");
      return {
        viewportWidth: window.innerWidth,
        backdrop: getComputedStyle(document.querySelector(".wz-widget-backdrop")).display,
        contentHeight: getComputedStyle(content).height,
        contentVisibility: getComputedStyle(content).visibility,
        collapseControl: getComputedStyle(panel.querySelector("[data-panel-collapse]")).display,
        closeControl: getComputedStyle(panel.querySelector(".wz-orbital-mobile-close")).display,
      };
    });
    assert.equal(result.viewportWidth, width);
    assert.equal(result.backdrop, "none", `${width}px backdrop`);
    assert.equal(result.contentHeight, "0px", `${width}px content`);
    assert.equal(result.contentVisibility, "hidden", `${width}px visibility`);
    assert.notEqual(result.collapseControl, "none", `${width}px collapse`);
    assert.notEqual(result.closeControl, "none", `${width}px close`);
    await page.close();
  }
});
