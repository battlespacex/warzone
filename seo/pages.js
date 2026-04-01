module.exports = {
    index: {
        path: "/",
        title: "StratOps | Real-Time Multi-Domain Battlespace Intelligence | BattlespaceX",
        description: "StratOps, powered by Battlespacex, is a real-time, multi-domain situational intelligence visualization platform that leverages OSINT to transform aggregated telemetry and event signals into a live, 3D layered battlespace across air, land, sea, space, and cyberspace.",
        robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
        ogAlt: "StratOps live multi-domain battlespace intelligence platform by BattlespaceX",
        breadcrumbs: [
            { name: "Home", item: "https://stratops.battlespacex.com/" }
        ],
        preload: [
            { href: "/assets/images/web/stratops-og-preview.jpg" }
        ]
    },

    "404": {
        path: "/404",
        title: "404 | StratOps",
        description: "The requested StratOps page could not be found.",
        robots: "noindex, nofollow",
        ogAlt: "StratOps page not found",
        breadcrumbs: [
            { name: "Home", item: "https://stratops.battlespacex.com/" },
            { name: "404", item: "https://stratops.battlespacex.com/404" }
        ]
    }
};