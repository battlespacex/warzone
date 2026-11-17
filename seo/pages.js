module.exports = {
    index: {
        path: "/",
        title: "StratOps | Real-Time Multi-Domain Battlespace Intelligence",
        description: "StratOps by BattlespaceX unifies warzone OSINT, conflict intel and military tracking in a real-time 3D battlespace: air, land, sea, space and cyberspace.",
        robots: "noindex, nofollow",
        ogAlt: "StratOps live multi-domain battlespace intelligence platform by BattlespaceX",
        breadcrumbs: [
            { name: "Home", item: "https://app.stratops.space/" }
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
            { name: "Home", item: "https://app.stratops.space/" },
            { name: "404", item: "https://app.stratops.space/404" }
        ]
    },

    report: {
        path: "/reports/stratops-report",
        title: "StratOps Operational Report",
        description: "Secure StratOps operational intelligence report viewer.",
        robots: "noindex, nofollow",
        ogAlt: "StratOps operational intelligence report",
        breadcrumbs: [
            { name: "Home", item: "https://app.stratops.space/" },
            { name: "Reports", item: "https://app.stratops.space/reports/stratops-report" }
        ]
    }
};
