module.exports = {
    index: {
        path: "/",
        title: "StratOps | Live OSINT Conflict Monitoring Map | BattleSpaceX",
        description: "StratOps by BattleSpaceX is a live OSINT conflict monitoring interface with strike mapping, alerts, airspace awareness, cyber status, analytics, and theater-level situational context.",
        robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
        ogAlt: "StratOps by BattleSpaceX live conflict monitoring map and analytics dashboard",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/stratops/" }
        ],
        preload: [
            { href: "/assets/images/web/warzone-og-preview.jpg" }
        ]
    },

    "404": {
        path: "/404",
        title: "404 | StratOps",
        description: "The requested StratOps page could not be found.",
        robots: "noindex, nofollow",
        ogAlt: "StratOps page not found",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/stratops/" },
            { name: "404", item: "https://battlespacex.com/stratops/404" }
        ]
    }
};