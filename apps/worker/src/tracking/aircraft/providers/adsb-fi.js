import { fetchJson } from "../../http.js";
import { observationsFromReadsb } from "./readsb.js";

// ADSB.fi public endpoint is NON-COMMERCIAL ONLY (see https://github.com/adsbfi/opendata).
// Disabled by default. Enable only after confirming the deployment use is licensed.
const DEFAULT_URL = "https://opendata.adsb.fi/api/v2/mil";
export function createAdsbFiProvider({ enabled = false, licenseApproved = false, baseUrl = DEFAULT_URL, fetchImpl } = {}) {
    const configured = enabled === true && licenseApproved === true;
    return {
        id: "adsb_fi",
        enabled: configured,
        disabledReason: configured ? undefined : enabled ? "LICENSE_APPROVAL_REQUIRED" : "DISABLED_BY_CONFIG",
        // Public limit: <= 1 request/second. Poll considerably less to minimize burden.
        minimumIntervalMs: 5 * 60_000,
        async fetchObservations() {
            const data = await fetchJson(baseUrl, {
                headers: { Accept: "application/json", "User-Agent": "StratOps/1.0" }
            }, { fetchImpl });
            if (!Array.isArray(data?.ac)) throw new Error("Unexpected ADSB.fi military response");
            const result = observationsFromReadsb(data, { source: "adsb_fi", militaryHint: true });
            return { ...result, diagnostics: { ...(result.diagnostics || {}),
                attribution: "adsb.fi", license: "non-commercial only" } };
        }
    };
}
