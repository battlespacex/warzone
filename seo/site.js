const PROD_BASE = require('../apps/shared/stratops-domains.json').portalOrigin;

module.exports = {
    // This metadata belongs to the operational portal. Marketing has a separate build.
    // Webpack's --mode flag does not set process.env.NODE_ENV for this module.
    baseUrl: PROD_BASE,
    siteName: "StratOps | BattlespaceX",
    brandName: "StratOps",
    defaultOg: "/assets/images/web/stratops-og-preview.jpg",
    defaultLocale: "en_CA",
    defaultThemeColor: "#07111b",
    email: "bravo@battlespacex.com",
    sameAs: [
        "https://twitter.com/battlespacex",
        "https://www.facebook.com/battlespacex",
        "https://www.instagram.com/battlespacex",
        "https://www.threads.net/@battlespacex",
        "https://www.youtube.com/@battlespacex",
        "https://www.linkedin.com/company/battlespacex/"
    ]
};
