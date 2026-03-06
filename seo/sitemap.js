const fs = require("fs");
const path = require("path");
const SITE = require("./site");
const pages = require("./pages");

const baseUrl = String(SITE.baseUrl || "").replace(/\/+$/, "");
const productionDir = path.resolve(__dirname, "../production");

const urls = Object.values(pages)
    .filter((p) => p && p.robots !== "noindex, nofollow")
    .map((p) => `${baseUrl}${p.path === "/" ? "/" : p.path}`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
        .map(
            (u) => `  <url>
    <loc>${u}</loc>
  </url>`
        )
        .join("\n")}
</urlset>`;

fs.mkdirSync(productionDir, { recursive: true });
fs.writeFileSync(path.join(productionDir, "sitemap.xml"), xml, "utf8");
console.log("sitemap.xml generated");