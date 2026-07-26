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
                name: site.brandName || "BattlespaceX",
                url: `${baseUrl}/`,
                email: site.email || "bravo@battlespacex.com",
                sameAs: Array.isArray(site.sameAs) ? site.sameAs : []
            },
            {
                "@type": "WebSite",
                "@id": `${baseUrl}/#website`,
                name: site.siteName || "StratOps | BattlespaceX",
                url: `${baseUrl}/`,
                publisher: { "@id": `${baseUrl}/#org` },
                inLanguage: "en-CA"
            },
            {
                "@type": "CollectionPage",
                "@id": `${pageUrl}#webpage`,
                url: pageUrl,
                name: page.title || site.siteName || "StratOps | BattlespaceX",
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
                caption: page.title || site.siteName || "StratOps | BattlespaceX",
                representativeOfPage: true
            },
            {
                "@type": "SoftwareApplication",
                "@id": `${baseUrl}/#app`,
                name: "StratOps",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                url: `${baseUrl}/`,
                publisher: { "@id": `${baseUrl}/#org` },
                description: "StratOps unifies curated OSINT, conflict intelligence and live military tracking in a 3D layered battlespace across air, land, sea, space and cyberspace."
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