import { fetchJson } from "../../http.js";
import { observationsFromReadsb } from "./readsb.js";

export function createAirplanesLiveProvider({ enabled, baseUrl, fetchImpl } = {}) {
    const url = baseUrl || "https://api.airplanes.live/v2/mil";
    return {
        id: "airplanes_live",
        enabled,
        async fetchObservations() {
            const data = await fetchJson(url, {
                headers: { Accept: "application/json", "User-Agent": "stratops-warzone/1.0" },
            }, { fetchImpl });
            return observationsFromReadsb(data, { source: "airplanes_live", militaryHint: true });
        },
    };
}

