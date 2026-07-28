module.exports = {
    index: {
        path: "/",
        title: "StratOps | Real-Time Multi-Domain Battlespace Intelligence",
        description: "StratOps by BattlespaceX unifies warzone OSINT, conflict intel and military tracking in a real-time 3D battlespace: air, land, sea, space and cyberspace.",
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
    },

    report: {
        path: "/reports/stratops-report",
        title: "StratOps Operational Report",
        description: "Secure StratOps operational intelligence report viewer.",
        robots: "noindex, nofollow",
        ogAlt: "StratOps operational intelligence report",
        breadcrumbs: [
            { name: "Home", item: "https://stratops.battlespacex.com/" },
            { name: "Reports", item: "https://stratops.battlespacex.com/reports/stratops-report" }
        ]
    }
};
