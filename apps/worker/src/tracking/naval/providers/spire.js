import { fetchJson } from "../../http.js";

const DEFAULT_URL = "https://api.spire.com/graphql";
const QUERY = `query StratOpsVessels($first: Int!) {
  vessels(first: $first) {
    nodes {
      id
      staticData { name imo mmsi callsign shipType flag }
      lastPositionUpdate { latitude longitude timestamp course heading speed navigationalStatus collectionType }
    }
  }
}`;

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function observedAt(value) {
    const parsed = Date.parse(value || "");
    return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

export function createSpireProvider({ enabled, token, baseUrl, fetchImpl } = {}) {
    const configured = Boolean(enabled && token);
    return {
        id: "spire",
        enabled: configured,
        async fetchObservations() {
            const data = await fetchJson(baseUrl || DEFAULT_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ query: QUERY, variables: { first: 1000 } }),
            }, { fetchImpl });
            if (Array.isArray(data?.errors) && data.errors.length) {
                throw new Error(`Spire GraphQL: ${data.errors[0]?.message || "query failed"}`);
            }
            return (data?.data?.vessels?.nodes || []).map((node) => {
                const staticData = node.staticData || {};
                const position = node.lastPositionUpdate || {};
                return {
                    domain: "naval",
                    source: "spire",
                    observed_at: observedAt(position.timestamp),
                    mmsi: String(staticData.mmsi || "").replace(/\D/g, ""),
                    imo: String(staticData.imo || "").replace(/\D/g, ""),
                    callsign: String(staticData.callsign || "").trim(),
                    vessel_name: String(staticData.name || "").trim(),
                    latitude: numberOrNull(position.latitude),
                    longitude: numberOrNull(position.longitude),
                    speed_kts: numberOrNull(position.speed),
                    heading_deg: numberOrNull(position.heading),
                    course_deg: numberOrNull(position.course),
                    ship_type: staticData.shipType ?? null,
                    country: String(staticData.flag || "").trim(),
                    military_hint: Number(staticData.shipType) === 35,
                };
            });
        },
    };
}
