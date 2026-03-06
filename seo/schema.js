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
                name: site.siteName || "BattleSpaceX Warzone",
                url: `${baseUrl}/`,
                publisher: { "@id": `${baseUrl}/#org` },
                inLanguage: "en-CA"
            },
            {
                "@type": "ImageObject",
                "@id": `${pageUrl}#primaryimage`,
                url: ogImageAbs,
                contentUrl: ogImageAbs,
                width: 1200,
                height: 630,
                caption: page.title || site.siteName || "BattleSpaceX Warzone",
                representativeOfPage: true
            },
            {
                "@type": "WebPage",
                "@id": `${pageUrl}#webpage`,
                url: pageUrl,
                name: page.title || site.siteName || "BattleSpaceX Warzone",
                description: page.description || "",
                isPartOf: { "@id": `${baseUrl}/#website` },
                publisher: { "@id": `${baseUrl}/#org` },
                primaryImageOfPage: { "@id": `${pageUrl}#primaryimage` },
                inLanguage: "en-CA"
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