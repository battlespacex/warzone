const isProd = process.env.NODE_ENV === "production";

const PROD_BASE = "https://stratops.battlespacex.com";
const DEV_BASE = "http://localhost:4173";

module.exports = {
    baseUrl: isProd ? PROD_BASE : DEV_BASE,
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