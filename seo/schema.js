function buildJsonLd({ site, page, ogImageAbs }) {
    const baseUrl = String(site.baseUrl || "").replace(/\/+$/, "");
    const pagePath = page.path || "/";
    const pageUrl = `${baseUrl}${pagePath === "/" ? "/" : pagePath}`;
    const breadcrumbs = Array.isArray(page.breadcrumbs) ? page.breadcrumbs : [];

    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": `${baseUrl}/#org`,
                name: site.brandName || "BattleSpaceX",
                url: `${baseUrl}/`,
                email: site.email || "contact@battlespacex.com",
                sameAs: Array.isArray(site.sameAs) ? site.sameAs : []
            },
            {
                "@type": "WebSite",
                "@id": `${baseUrl}/#website`,
                name: site.siteName || "Stratops | BattleSpaceX",
                url: `${baseUrl}/`,
                publisher: { "@id": `${baseUrl}/#org` },
                inLanguage: "en-CA"
            },
            {
                "@type": "CollectionPage",
                "@id": `${pageUrl}#webpage`,
                url: pageUrl,
                name: page.title || site.siteName || "Stratops | BattleSpaceX",
                description: page.description || "",
                isPartOf: { "@id": `${baseUrl}/#website` },
                about: { "@id": `${baseUrl}/#org` },
                primaryImageOfPage: { "@id": `${pageUrl}#primaryimage` },
                inLanguage: "en-CA"
            },
            {
                "@type": "ImageObject",
                "@id": `${pageUrl}#primaryimage`,
                url: ogImageAbs,
                contentUrl: ogImageAbs,
                width: 1200,
                height: 630,
                caption: page.title || site.siteName || "Stratops | BattleSpaceX",
                representativeOfPage: true
            },
            {
                "@type": "SoftwareApplication",
                "@id": `${baseUrl}/#app`,
                name: "Stratops",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                url: `${baseUrl}/`,
                publisher: { "@id": `${baseUrl}/#org` },
                description: "Public-facing OSINT conflict monitoring interface with global map visualization, alerts, airspace status, cyber indicators, and analytics."
            },
            {
                "@type": "BreadcrumbList",
                "@id": `${pageUrl}#breadcrumbs`,
                itemListElement: breadcrumbs.map((b, idx) => ({
                    "@type": "ListItem",
                    position: idx + 1,
                    name: b.name,
                    item: b.item
                }))
            }
        ]
    };
}

module.exports = { buildJsonLd };