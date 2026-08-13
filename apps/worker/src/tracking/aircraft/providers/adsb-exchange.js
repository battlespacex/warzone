import { fetchJson } from "../../http.js";
import { observationsFromReadsb } from "./readsb.js";

export function createAdsbExchangeProvider({ enabled, apiKey, baseUrl, fetchImpl } = {}) {
    const configured = Boolean(enabled && apiKey && baseUrl);
    return {
        id: "adsbx",
        enabled: configured,
        async fetchObservations() {
            const url = `${String(baseUrl).replace(/\/$/, "")}/mil`;
            const data = await fetchJson(url, {
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "gzip",
                    "User-Agent": "stratops-warzone/1.0",
                    "X-Api-Key": apiKey,
                },
            }, { fetchImpl });
            return observationsFromReadsb(data, { source: "adsbx", militaryHint: true });
        },
    };
}

