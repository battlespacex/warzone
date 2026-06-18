const DEMO_SOURCE_LABEL = "GNSS Interference Monitor";
const AVIATION_DEMO_SOURCE_LABEL = "Aviation GNSS Interference Feed";
const DEFAULT_LIMIT = 240;

function isGnssDemoFallbackEnabled() {
    return String(process.env.GNSS_DEMO_FALLBACK_ENABLED || "").toLowerCase() === "true";
}

const GNSS_INTERFERENCE_DEMO_CELLS = [
    {
        id: "gnss-demo-eastern-med-1",
        cellId: "gnss-demo-eastern-med-1",
        lat: 34.42,
        lon: 33.64,
        severity: "medium",
        affectedPercent: 6.4,
        sampleCount: 148,
        confidence: "medium",
        country: "Cyprus",
        region: "Levant & Eastern Med",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T14:20:00.000Z",
        updatedAt: "2026-06-08T14:44:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-eastern-med-2",
        cellId: "gnss-demo-eastern-med-2",
        lat: 31.61,
        lon: 32.28,
        severity: "high",
        affectedPercent: 14.8,
        sampleCount: 226,
        confidence: "high",
        country: "Egypt",
        region: "Levant & Eastern Med",
        sourceLabel: AVIATION_DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T15:06:00.000Z",
        updatedAt: "2026-06-08T15:31:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-persian-gulf-1",
        cellId: "gnss-demo-persian-gulf-1",
        lat: 25.92,
        lon: 51.47,
        severity: "medium",
        affectedPercent: 7.2,
        sampleCount: 121,
        confidence: "medium",
        country: "Qatar",
        region: "Middle East & Gulf",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T14:58:00.000Z",
        updatedAt: "2026-06-08T15:24:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-persian-gulf-2",
        cellId: "gnss-demo-persian-gulf-2",
        lat: 29.56,
        lon: 48.12,
        severity: "low",
        affectedPercent: 1.8,
        sampleCount: 92,
        confidence: "medium",
        country: "Kuwait",
        region: "Middle East & Gulf",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T13:52:00.000Z",
        updatedAt: "2026-06-08T14:27:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-persian-gulf-3",
        cellId: "gnss-demo-persian-gulf-3",
        lat: 26.78,
        lon: 56.21,
        severity: "high",
        affectedPercent: 12.9,
        sampleCount: 204,
        confidence: "high",
        country: "Iran",
        region: "Middle East & Gulf",
        sourceLabel: AVIATION_DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T15:11:00.000Z",
        updatedAt: "2026-06-08T15:39:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-black-sea-1",
        cellId: "gnss-demo-black-sea-1",
        lat: 45.11,
        lon: 30.54,
        severity: "medium",
        affectedPercent: 5.7,
        sampleCount: 176,
        confidence: "high",
        country: "Romania",
        region: "Ukraine & Eastern Europe",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T14:09:00.000Z",
        updatedAt: "2026-06-08T15:03:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-black-sea-2",
        cellId: "gnss-demo-black-sea-2",
        lat: 46.79,
        lon: 36.88,
        severity: "high",
        affectedPercent: 18.3,
        sampleCount: 258,
        confidence: "high",
        country: "Ukraine",
        region: "Ukraine & Eastern Europe",
        sourceLabel: AVIATION_DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T15:02:00.000Z",
        updatedAt: "2026-06-08T15:35:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-baltic-1",
        cellId: "gnss-demo-baltic-1",
        lat: 56.21,
        lon: 20.34,
        severity: "low",
        affectedPercent: 1.3,
        sampleCount: 88,
        confidence: "low",
        country: "Latvia",
        region: "Europe",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T13:31:00.000Z",
        updatedAt: "2026-06-08T14:22:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-south-asia-1",
        cellId: "gnss-demo-south-asia-1",
        lat: 24.87,
        lon: 66.76,
        severity: "medium",
        affectedPercent: 4.2,
        sampleCount: 117,
        confidence: "medium",
        country: "Pakistan",
        region: "South Asia",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T12:48:00.000Z",
        updatedAt: "2026-06-08T14:06:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-east-asia-1",
        cellId: "gnss-demo-east-asia-1",
        lat: 25.49,
        lon: 121.82,
        severity: "medium",
        affectedPercent: 6.8,
        sampleCount: 144,
        confidence: "medium",
        country: "Taiwan",
        region: "East Asia & Pacific",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T11:56:00.000Z",
        updatedAt: "2026-06-08T13:48:00.000Z",
        isDemo: true,
    },
    {
        id: "gnss-demo-red-sea-1",
        cellId: "gnss-demo-red-sea-1",
        lat: 20.98,
        lon: 38.61,
        severity: "low",
        affectedPercent: 1.9,
        sampleCount: 74,
        confidence: "low",
        country: "Saudi Arabia",
        region: "Middle East & Gulf",
        sourceLabel: DEMO_SOURCE_LABEL,
        observedAt: "2026-06-08T10:42:00.000Z",
        updatedAt: "2026-06-08T12:11:00.000Z",
        isDemo: true,
    },
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeSeverity(value = "") {
    const severity = String(value || "").toLowerCase();
    if (["low", "medium", "high", "unknown"].includes(severity)) return severity;
    if (severity === "critical") return "high";
    return "unknown";
}

function normalizeConfidence(value = "") {
    const confidence = String(value || "").toLowerCase();
    if (["low", "medium", "high"].includes(confidence)) return confidence;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric >= 70) return "high";
        if (numeric >= 35) return "medium";
        return "low";
    }
    return "low";
}

function getPublicSourceLabel(_row = {}) {
    return DEMO_SOURCE_LABEL;
}

function sanitizePolygon(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return null;
    const vertices = polygon
        .map((point) => {
            if (Array.isArray(point) && point.length >= 2) {
                const lon = Number(point[0]);
                const lat = Number(point[1]);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    return { lat, lon };
                }
            }
            if (point && typeof point === "object") {
                const lat = Number(point.lat);
                const lon = Number(point.lon);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    return { lat, lon };
                }
            }
            return null;
        })
        .filter(Boolean);
    return vertices.length >= 3 ? vertices : null;
}

export function toPublicGnssCell(row = {}) {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const affectedPercent = Number(row.affectedPercent ?? row.affected_percent);
    const sampleCount = Number(row.sampleCount ?? row.sample_count);
    const polygon = sanitizePolygon(row.polygon ?? row.cell_boundary);
    return {
        id: String(row.id || row.cellId || row.cell_id || row.grid_id || `${lat}:${lon}`),
        cellId: String(row.cellId || row.cell_id || row.grid_id || row.id || `${lat}:${lon}`),
        lat,
        lon,
        polygon,
        severity: normalizeSeverity(row.severity),
        affectedPercent: Number.isFinite(affectedPercent) ? clamp(affectedPercent, 0, 100) : 0,
        sampleCount: Number.isFinite(sampleCount) ? Math.max(0, Math.round(sampleCount)) : 0,
        confidence: normalizeConfidence(row.confidence),
        country: String(row.country || "Unknown / Unassigned"),
        region: String(row.region || "Global"),
        sourceLabel: getPublicSourceLabel(row),
        observedAt: String(row.observedAt || row.observed_at || row.updatedAt || row.updated_at || ""),
        updatedAt: String(row.updatedAt || row.updated_at || row.observedAt || row.observed_at || ""),
        isDemo: row.isDemo === true || row.is_demo === true,
    };
}

async function getGnssCellsFromStatusFeed({ supabase = null, limit = DEFAULT_LIMIT } = {}) {
    if (!supabase) return [];
    const boundedLimit = clamp(Math.floor(Number(limit) || DEFAULT_LIMIT), 12, 600);
    const { data, error } = await supabase
        .from("status_feed_items")
        .select("id, source_name, published_at, fetched_at, region, country, lat, lon, severity, category, confidence_score, is_status_relevant")
        .eq("is_status_relevant", true)
        .in("category", ["gps_jamming", "gps_spoofing", "gnss_interference"])
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("fetched_at", { ascending: false })
        .limit(boundedLimit);
    if (error || !Array.isArray(data)) return [];
    return data
        .map((row) => toPublicGnssCell({
            id: `status-${row.id}`,
            cell_id: `status-${row.id}`,
            lat: row.lat,
            lon: row.lon,
            severity: row.severity || "medium",
            affected_percent: 0,
            sample_count: Math.max(1, Math.round(Number(row.confidence_score || 0) / 25) || 1),
            confidence: Number(row.confidence_score || 0) >= 70 ? "high" : "medium",
            country: row.country,
            region: row.region,
            observed_at: row.published_at || row.fetched_at,
            updated_at: row.fetched_at || row.published_at,
            source_label: row.source_name || "GNSS Status Feed",
            is_demo: false,
        }))
        .filter(Boolean);
}

export async function getPublicGnssInterferenceCells({ supabase = null, limit = DEFAULT_LIMIT } = {}) {
    const boundedLimit = clamp(Math.floor(Number(limit) || DEFAULT_LIMIT), 12, 600);
    const demoFallback = GNSS_INTERFERENCE_DEMO_CELLS
        .map((row) => toPublicGnssCell(row))
        .filter(Boolean)
        .slice(0, boundedLimit);
    const demoFallbackEnabled = isGnssDemoFallbackEnabled();

    if (!supabase) {
        if (demoFallbackEnabled) {
            return {
                cells: demoFallback,
                demoMode: true,
                updatedAt: demoFallback[0]?.updatedAt || null,
                sourceMode: "demo",
                liveAvailable: false,
                tableAvailable: false,
                message: "GNSS demo fallback is enabled because no live backend source is configured.",
            };
        }
        return {
            cells: [],
            demoMode: false,
            updatedAt: null,
            sourceMode: "unavailable",
            liveAvailable: false,
            tableAvailable: false,
            message: "GNSS live data is not configured.",
        };
    }

    try {
        const { data, error } = await supabase
            .from("gnss_interference_cells")
            .select("id, cell_id, grid_id, lat, lon, polygon, cell_boundary, severity, affected_percent, sample_count, confidence, country, region, observed_at, updated_at, is_demo, is_public, is_active")
            .neq("severity", "unknown")
            .order("updated_at", { ascending: false, nullsFirst: false })
            .limit(boundedLimit);

        if (!error && Array.isArray(data)) {
            const publicRows = data
                .filter((row) => row?.is_public !== false && row?.is_active !== false)
                .map((row) => toPublicGnssCell(row))
                .filter(Boolean);

            if (publicRows.length) {
                return {
                    cells: publicRows,
                    demoMode: publicRows.every((row) => row.isDemo === true),
                    updatedAt: publicRows[0]?.updatedAt || null,
                    sourceMode: publicRows.every((row) => row.isDemo === true) ? "demo" : "live",
                    liveAvailable: true,
                    tableAvailable: true,
                    message: "",
                };
            }
            const statusCells = await getGnssCellsFromStatusFeed({ supabase, limit: boundedLimit });
            if (statusCells.length) {
                return {
                    cells: statusCells,
                    demoMode: false,
                    updatedAt: statusCells[0]?.updatedAt || null,
                    sourceMode: "status_feed",
                    liveAvailable: true,
                    tableAvailable: true,
                    message: "GNSS cells are derived from vetted status feed rows because the dedicated GNSS grid has no active cells.",
                };
            }
            return {
                cells: [],
                demoMode: false,
                updatedAt: data[0]?.updated_at || null,
                sourceMode: "live",
                liveAvailable: true,
                tableAvailable: true,
                message: "No active GNSS interference cells are available right now.",
            };
        }

        if (error) {
            const message = String(error.message || "");
            const tableMissing =
                message.includes("gnss_interference_cells") &&
                message.toLowerCase().includes("schema cache");
            if (demoFallbackEnabled) {
                return {
                    cells: demoFallback,
                    demoMode: true,
                    updatedAt: demoFallback[0]?.updatedAt || null,
                    sourceMode: "demo",
                    liveAvailable: false,
                    tableAvailable: !tableMissing,
                    message: "GNSS demo fallback is enabled because live GNSS table data is unavailable.",
                };
            }
            const statusCells = await getGnssCellsFromStatusFeed({ supabase, limit: boundedLimit });
            if (statusCells.length) {
                return {
                    cells: statusCells,
                    demoMode: false,
                    updatedAt: statusCells[0]?.updatedAt || null,
                    sourceMode: "status_feed",
                    liveAvailable: true,
                    tableAvailable: !tableMissing,
                    message: tableMissing
                        ? "GNSS dedicated table is not deployed; showing vetted status-feed GNSS rows."
                        : "GNSS dedicated cells are unavailable; showing vetted status-feed GNSS rows.",
                };
            }
            return {
                cells: [],
                demoMode: false,
                updatedAt: null,
                sourceMode: "unavailable",
                liveAvailable: false,
                tableAvailable: !tableMissing,
                message: tableMissing
                    ? "GNSS live backend table is not deployed yet."
                    : "GNSS live data is temporarily unavailable.",
            };
        }
    } catch {
        if (demoFallbackEnabled) {
            return {
                cells: demoFallback,
                demoMode: true,
                updatedAt: demoFallback[0]?.updatedAt || null,
                sourceMode: "demo",
                liveAvailable: false,
                tableAvailable: false,
                message: "GNSS demo fallback is enabled because live GNSS data could not be loaded.",
            };
        }
    }

    return {
        cells: [],
        demoMode: false,
        updatedAt: null,
        sourceMode: "unavailable",
        liveAvailable: false,
        tableAvailable: false,
        message: "GNSS live data is unavailable.",
    };
}
