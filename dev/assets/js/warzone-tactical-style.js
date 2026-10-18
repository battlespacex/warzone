// Public OpenFreeMap/OpenMapTiles cartography, not OSIRIS assets or endpoints.
export function readTacticalTheme() {
    const css = getComputedStyle(document.documentElement);
    const names = [
        "land-color", "ocean-color", "background-color", "country-border", "state-border",
        "coastline-color", "terrain-shadow", "terrain-highlight", "country-label", "city-label",
        "water-label", "road-color", "river-color", "grid-color", "aircraft-color", "naval-color",
        "satellite-color", "selected-color", "event-color",
    ];
    const theme = Object.fromEntries(names.map((name) => [name, css.getPropertyValue("--tactical-" + name).trim()]));
    const defaults = { "terrain-opacity": .45, "terrain-intensity": .4, "border-width": .7,
        "label-size": 12, "symbol-size": .75, "layer-opacity": .9, "grid-opacity": 0, "state-opacity": .45 };
    Object.entries(defaults).forEach(([name, fallback]) => {
        const value = parseFloat(css.getPropertyValue("--tactical-" + name));
        theme[name] = Number.isFinite(value) ? Math.max(0, value) : fallback;
    });
    return theme;
}
export function tacticalStyle(t) {
    const vector = (id, type, sourceLayer, paint, extra = {}) => ({
        id, type, source: "world", "source-layer": sourceLayer, paint, ...extra,
    });
    const label = (id, sourceLayer, color, filter, minzoom = 0) => vector(id, "symbol", sourceLayer, {
        "text-color": color, "text-halo-color": t["background-color"], "text-halo-width": 1,
    }, { minzoom, ...(filter ? { filter } : {}), layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"], ""],
        "text-font": ["Noto Sans Regular"], "text-size": t["label-size"],
        "text-max-width": 9, "text-padding": 10,
    } });
    return {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
            world: { type: "vector", url: "https://tiles.openfreemap.org/planet",
                attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
            elevation: { type: "raster-dem", tileSize: 256, maxzoom: 12, encoding: "terrarium",
                tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain: Mapzen / underlying data sources</a>' },
        },
        layers: [
            { id: "background", type: "background", paint: { "background-color": t["background-color"] } },
            { id: "land", type: "background", paint: { "background-color": t["land-color"] } },
            { id: "relief", type: "hillshade", source: "elevation", minzoom: 4,
                paint: { "hillshade-shadow-color": t["terrain-shadow"], "hillshade-highlight-color": t["terrain-highlight"],
                    "hillshade-accent-color": t["terrain-shadow"],
                    "hillshade-exaggeration": Math.min(1, t["terrain-opacity"] * t["terrain-intensity"]) } },
            vector("water", "fill", "water", { "fill-color": t["ocean-color"] }),
            vector("coastline", "line", "water", { "line-color": t["coastline-color"], "line-width": t["border-width"] }),
            vector("rivers", "line", "waterway", { "line-color": t["river-color"], "line-width": .7 }, { minzoom: 6 }),
            vector("roads", "line", "transportation", { "line-color": t["road-color"], "line-width": .6 }, {
                minzoom: 8, filter: ["in", "class", "motorway", "trunk", "primary"],
            }),
            vector("states", "line", "boundary", { "line-color": t["state-border"], "line-width": t["border-width"],
                "line-opacity": Math.min(1, t["state-opacity"]) }, { minzoom: 4, filter: [">", "admin_level", 2] }),
            vector("countries", "line", "boundary", { "line-color": t["country-border"], "line-width": t["border-width"] },
                { filter: ["==", "admin_level", 2] }),
            label("country-labels", "place", t["country-label"], ["==", "class", "country"]),
            label("city-labels", "place", t["city-label"], ["in", "class", "city", "town", "village"], 5),
            label("water-labels", "water_name", t["water-label"], null, 3),
            label("mountain-labels", "mountain_peak", t["city-label"], null, 9),
        ],
    };
}
export function syncTacticalTheme(map, theme) {
    // Paint/layout changes retain sources, tiles, feature IDs and camera state.
    tacticalStyle(theme).layers.forEach((layer) => {
        Object.entries(layer.paint || {}).forEach(([key, value]) => map.setPaintProperty(layer.id, key, value));
        Object.entries(layer.layout || {}).forEach(([key, value]) => map.setLayoutProperty(layer.id, key, value));
    });
    const color = ["match", ["get", "type"], "aircraft", theme["aircraft-color"], "naval", theme["naval-color"],
        "satellite", theme["satellite-color"], theme["event-color"]];
    map.setPaintProperty("track-dots", "circle-color", color);
    map.setPaintProperty("track-dots", "circle-opacity", Math.min(1, theme["layer-opacity"]));
    map.setPaintProperty("track-path", "line-color", theme["selected-color"]);
    map.setPaintProperty("intel-areas", "fill-color", theme["event-color"]);
    map.setPaintProperty("grid", "line-color", theme["grid-color"]);
    map.setPaintProperty("grid", "line-opacity", Math.min(1, theme["grid-opacity"]));
    map.setLayoutProperty("track-icons", "icon-size", theme["symbol-size"]);
    map.setPaintProperty("track-icons", "icon-opacity", Math.min(1, theme["layer-opacity"]));
    map.setPaintProperty("track-labels", "text-color", theme["country-label"]);
    map.setPaintProperty("track-labels", "text-halo-color", theme["background-color"]);
    map.setLayoutProperty("track-labels", "text-size", theme["label-size"]);
}
