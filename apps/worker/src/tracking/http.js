import fetch from "node-fetch";

export class ProviderRequestError extends Error {
    constructor(message, { status = null, retryAfterMs = null, code = null } = {}) {
        super(message);
        this.name = "ProviderRequestError";
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.code = code;
    }
}

function retryAfterMs(response) {
    const raw = response.headers.get("retry-after") || response.headers.get("x-rate-limit-retry-after-seconds");
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function fetchJson(url, options = {}, { timeoutMs = 25000, fetchImpl = fetch } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new ProviderRequestError(
                `HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
                { status: response.status, retryAfterMs: retryAfterMs(response) }
            );
        }
        return await response.json();
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new ProviderRequestError(`request timed out after ${timeoutMs}ms`, { code: "ETIMEDOUT" });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

