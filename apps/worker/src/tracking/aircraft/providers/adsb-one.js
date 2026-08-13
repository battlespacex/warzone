import { fetchJson } from "../../http.js";
import { observationsFromReadsb } from "./readsb.js";

export function createAdsbOneProvider({ enabled, baseUrl, fetchImpl } = {}) {
    const url = baseUrl || "https://api.adsb.one/v2/mil";
    return {
        id: "adsb_one",
        enabled,
        async fetchObservations() {
            const data = await fetchJson(url, {
                headers: { Accept: "application/json", "User-Agent": "stratops-warzone/1.0" },
            }, { fetchImpl });
            return observationsFromReadsb(data, { source: "adsb_one", militaryHint: true });
        },
    };
}
