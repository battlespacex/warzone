module.exports = {
    index: {
        path: "/",
        title: "Warzone Live | BattleSpaceX",
        description: "Live incident map, strike clusters, latest updates, and open-source conflict tracking by BattleSpaceX.",
        ogAlt: "BattleSpaceX Warzone Live",
        breadcrumbs: [{ name: "Home", item: "https://battlespacex.com/warzone/" }],
        preload: [
            { href: "/warzone/assets/images/web/warzone-og-preview.jpg" }
        ]
    },

    report: {
        path: "/report",
        title: "Warzone Report | BattleSpaceX",
        description: "Situation report, event summary, and running totals for the monitored battlespace.",
        ogAlt: "BattleSpaceX Warzone Report",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/warzone/" },
            { name: "Report", item: "https://battlespacex.com/warzone/report" }
        ]
    },

    sources: {
        path: "/sources",
        title: "Sources | BattleSpaceX Warzone",
        description: "Source transparency, methodology notes, and public-source tracking references for Warzone.",
        ogAlt: "BattleSpaceX Warzone Sources",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/warzone/" },
            { name: "Sources", item: "https://battlespacex.com/warzone/sources" }
        ]
    },

    about: {
        path: "/about",
        title: "About | BattleSpaceX Warzone",
        description: "About the Warzone project, its purpose, limitations, and how BattleSpaceX presents live conflict data.",
        ogAlt: "About BattleSpaceX Warzone",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/warzone/" },
            { name: "About", item: "https://battlespacex.com/warzone/about" }
        ]
    },

    "404": {
        path: "/404",
        title: "404 | BattleSpaceX Warzone",
        description: "This page could not be found.",
        robots: "noindex, nofollow",
        ogAlt: "BattleSpaceX Warzone Not Found",
        breadcrumbs: [
            { name: "Home", item: "https://battlespacex.com/warzone/" },
            { name: "404", item: "https://battlespacex.com/warzone/404" }
        ]
    }
};