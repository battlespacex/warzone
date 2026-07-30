// StratOps frontend feature controls.
// Change a value from true to false to remove that feature from the UI and
// stop its matching startup path from running.
const DEFAULT_STRATOPS_FEATURES = {
    header: {
        sceneModeToggle: true,
        regionSelector: true,
        utcClock: true,
        defconBadge: true,
        login: true,
        support: true,
        captureShot: true,
        altitudeReadout: true,
    },

    dock: {
        layers: true,
        counter: true,
        escalation: true,
        aircraftTracker: true,
        navalTracker: true,
        intelWire: true,
        cyber: true,
        airspace: true,
        aoiScan: true,
        reports: true,
        fullscreen: true,
        about: true,
        mobileMenu: true,
    },

    mapLayers: {
        strikes: true,
        missiles: true,
        drones: true,
        airstrikes: true,
        aircraft: true,
        naval: true,
        militaryBases: true,
        radarRanges: true,
        radarSweepers: true,
        alerts: true,
        cyber: true,
        thermalFires: true,
        recon: true,
        seismic: true,
        hotspots: true,
        orbitalAssets: true,
        satelliteObservations: true,
        satelliteBasemap: true,
        raisedRegion: true,
        countryBorders: true,
        airspace: true,
        gnss: true,
    },

    widgets: {
        counter: true,
        layers: true,
        escalation: true,
        aircraftTracker: true,
        navalTracker: true,
        orbitalAssets: true,
        intelWire: true,
        cyber: true,
        airspace: true,
        aoiScan: true,
        gnssLegend: true,
    },

    tracking: {
        aircraft: true,
        naval: true,
        militaryTracks: true,
        militaryBases: true,
        publicAircraftFallback: true,
        aircraftRealtime: true,
        navalContextModels: true,
        focusedContextModels: true,
        highValueAssetDetection: true,
        strategicSatellites: true,
    },

    alerts: {
        stickyAlerts: true,
        sirenBroadcasts: true,
        audibleSirens: true,
        defconStatus: true,
        cyberStatus: true,
        airspaceStatus: true,
        performanceWarning: true,
    },

    reports: {
        operationalReports: true,
        reportGeneration: true,
        reportDownloads: true,
        reportViewer: true,
    },

    system: {
        intro: true,
        preEntryShowcase: true,
        authentication: true,
        billing: true,
        realtimeEvents: true,
        eventPolling: true,
        intelWireFeed: true,
        intelWireMedia: true,
        globe: true,
        regionSelection: true,
        aoiLens: true,
        captureShot: true,
        milSatOrbit: true,
        audio: true,
        adaptivePerformanceGuard: true,
        devPanel: true,
    },
};

const FEATURE_SELECTOR_MAP = {
    "header.sceneModeToggle": ".wz-globe-toggle",
    "header.regionSelector": "#wz-region-control, #wz-region-control-mobile, #wz-mobile-region-menu",
    "header.utcClock": "#wz-utc-clock",
    "header.defconBadge": "#wz-defcon-badge",
    "header.login": "#wz-nav-login-btn, [data-mobile-action=\"login\"]",
    "header.support": "#wz-support-open, [data-mobile-action=\"support\"]",
    "header.captureShot": "#dock-capture-shot, #wz-mobile-capture-shot",
    "header.altitudeReadout": "#wz-altitude-readout",

    "dock.layers": "[data-dock-widget=\"layers\"], [data-dock-proxy=\"layers\"]",
    "dock.counter": "[data-dock-widget=\"counter\"], [data-dock-proxy=\"counter\"]",
    "dock.escalation": "[data-dock-widget=\"escalation\"], [data-dock-proxy=\"escalation\"]",
    "dock.aircraftTracker": "[data-dock-widget=\"aircraft\"], [data-dock-proxy=\"aircraft\"]",
    "dock.navalTracker": "[data-dock-widget=\"naval\"], [data-dock-proxy=\"naval\"]",
    "dock.intelWire": "[data-dock-widget=\"feed\"], [data-dock-proxy=\"feed\"]",
    "dock.cyber": "[data-dock-widget=\"cyber\"], [data-dock-proxy=\"cyber\"]",
    "dock.airspace": "[data-dock-widget=\"airspace\"], [data-dock-proxy=\"airspace\"]",
    "dock.aoiScan": "#dock-aoi-lens, #wz-mobile-aoi-lens",
    "dock.reports": "#dock-reports, #wz-mobile-reports",
    "dock.fullscreen": "#dock-fullscreen",
    "dock.about": "#dock-about, [data-dock-proxy=\"about\"]",
    "dock.mobileMenu": "#wz-mobile-dock-menu-open, #wz-mobile-dock-menu, #wz-mobile-dock-backdrop",

    "reports.reportGeneration": "#wz-operational-reports-generate",
    "reports.reportViewer": "#wz-operational-report-viewer",

    "widgets.counter": "[data-widget-id=\"counter\"]",
    "widgets.layers": "#wz-map-layers-pane",
    "widgets.escalation": "[data-widget-id=\"escalation\"]",
    "widgets.aircraftTracker": "[data-widget-id=\"aircraft\"]",
    "widgets.navalTracker": "[data-widget-id=\"naval\"]",
    "widgets.orbitalAssets": "[data-widget-id=\"orbital\"]",
    "widgets.intelWire": "[data-widget-id=\"feed\"]",
    "widgets.cyber": "[data-widget-id=\"cyber\"]",
    "widgets.airspace": "[data-widget-id=\"airspace\"]",
    "widgets.aoiScan": "[data-widget-id=\"aoi\"]",
    "widgets.gnssLegend": "#wz-gnss-legend",
};

const LAYER_FEATURE_PATHS = {
    strikes: "mapLayers.strikes",
    missiles: "mapLayers.missiles",
    drones: "mapLayers.drones",
    airstrikes: "mapLayers.airstrikes",
    aircraft: "mapLayers.aircraft",
    airspace: "mapLayers.airspace",
    gnss: "mapLayers.gnss",
    naval: "mapLayers.naval",
    "military-bases": "mapLayers.militaryBases",
    ranges: "mapLayers.radarRanges",
    sweepers: "mapLayers.radarSweepers",
    alerts: "mapLayers.alerts",
    cyber: "mapLayers.cyber",
    thermal: "mapLayers.thermalFires",
    recon: "mapLayers.recon",
    seismic: "mapLayers.seismic",
    hotspots: "mapLayers.hotspots",
    "orbital-assets": "mapLayers.orbitalAssets",
    "satellite-imagery": "mapLayers.satelliteObservations",
    terrain: "mapLayers.satelliteBasemap",
    "region-plate": "mapLayers.raisedRegion",
    "country-borders": "mapLayers.countryBorders",
};

const WIDGET_FEATURE_PATHS = {
    counter: "widgets.counter",
    layers: "widgets.layers",
    escalation: "widgets.escalation",
    aircraft: "widgets.aircraftTracker",
    naval: "widgets.navalTracker",
    orbital: "widgets.orbitalAssets",
    feed: "widgets.intelWire",
    cyber: "widgets.cyber",
    airspace: "widgets.airspace",
    aoi: "widgets.aoiScan",
};

const DOCK_WIDGET_FEATURE_PATHS = {
    layers: "dock.layers",
    counter: "dock.counter",
    escalation: "dock.escalation",
    aircraft: "dock.aircraftTracker",
    naval: "dock.navalTracker",
    feed: "dock.intelWire",
    cyber: "dock.cyber",
    airspace: "dock.airspace",
    about: "dock.about",
};

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeFeatureDefaults(defaults, overrides) {
    const output = { ...defaults };
    Object.entries(overrides || {}).forEach(([key, value]) => {
        output[key] = isPlainObject(defaults[key]) && isPlainObject(value)
            ? mergeFeatureDefaults(defaults[key], value)
            : value;
    });
    return output;
}

function readPath(source, path) {
    return String(path || "")
        .split(".")
        .filter(Boolean)
        .reduce((cursor, part) => (cursor && Object.prototype.hasOwnProperty.call(cursor, part) ? cursor[part] : undefined), source);
}

const configuredFeatures = isPlainObject(window.STRATOPS_FEATURES)
    ? mergeFeatureDefaults(DEFAULT_STRATOPS_FEATURES, window.STRATOPS_FEATURES)
    : DEFAULT_STRATOPS_FEATURES;

window.STRATOPS_FEATURES = configuredFeatures;

export function isStratOpsFeatureEnabled(path, fallback = true) {
    const value = readPath(window.STRATOPS_FEATURES, path);
    return value === undefined ? Boolean(fallback) : value !== false;
}

export function getStratOpsLayerFeaturePath(layerId = "") {
    return LAYER_FEATURE_PATHS[String(layerId || "")] || "";
}

export function getStratOpsWidgetFeaturePath(widgetId = "") {
    return WIDGET_FEATURE_PATHS[String(widgetId || "")] || "";
}

export function getStratOpsDockWidgetFeaturePath(widgetId = "") {
    return DOCK_WIDGET_FEATURE_PATHS[String(widgetId || "")] || "";
}

export function applyStratOpsFeatureVisibility(root = document) {
    if (!root?.querySelectorAll) return;
    Object.entries(FEATURE_SELECTOR_MAP).forEach(([path, selector]) => {
        const enabled = isStratOpsFeatureEnabled(path);
        root.querySelectorAll(selector).forEach((node) => {
            if (enabled) {
                if (node.dataset.stratopsFeatureDisabledByConfig === path) {
                    node.hidden = false;
                    node.removeAttribute("aria-hidden");
                    delete node.dataset.stratopsFeatureDisabledByConfig;
                }
                return;
            }
            node.hidden = true;
            node.setAttribute("aria-hidden", "true");
            node.dataset.stratopsFeatureDisabledByConfig = path;
        });
    });
}

window.isStratOpsFeatureEnabled = isStratOpsFeatureEnabled;
window.applyStratOpsFeatureVisibility = applyStratOpsFeatureVisibility;
window.getStratOpsLayerFeaturePath = getStratOpsLayerFeaturePath;
window.getStratOpsWidgetFeaturePath = getStratOpsWidgetFeaturePath;
window.getStratOpsDockWidgetFeaturePath = getStratOpsDockWidgetFeaturePath;
