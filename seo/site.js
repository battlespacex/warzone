// seo/site.js

const isProd = process.env.NODE_ENV === "production";

// For production you want /warzone under battlespacex.com
const PROD_BASE = "https://battlespacex.com/warzone";

// Local dev
const DEV_BASE = "http://localhost:4173";

module.exports = {
    baseUrl: isProd ? PROD_BASE : DEV_BASE,
    defaultOg: "/assets/images/web/warzone-og-preview.jpg",
};