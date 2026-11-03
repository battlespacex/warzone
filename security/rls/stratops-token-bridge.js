/**
 * Optional BattlespaceX cookie -> Supabase token bridge.
 * NOT wired into production. Requires a trusted server endpoint that issues
 * Supabase-verifiable, short-lived, approved-user JWTs.
 * Browser never signs JWTs or interprets unsigned claims as authorization.
 */
export function createStratOpsTokenBridge({ endpoint, fetchImpl = fetch, realtime = null } = {}) {
    if (!endpoint || typeof endpoint !== 'string') throw new Error('Token endpoint required');
    const tokenUrl = new URL(endpoint, 'https://www.battlespacex.com');
    if (tokenUrl.origin !== 'https://www.battlespacex.com') throw new Error('Untrusted token endpoint');
    let cachedToken = null;
    let expiresAt = 0;
    let inFlight = null;
    let generation = 0;

    async function requestToken() {
        const response = await fetchImpl(tokenUrl.href, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
        const data = await response.json();
        if (typeof data?.access_token !== 'string' || !data.access_token ||
            !Number.isFinite(data.expires_at) || data.expires_at * 1000 <= Date.now() + 15000) {
            throw new Error('Token exchange response invalid');
        }
        return { token: data.access_token, expiry: data.expires_at * 1000 };
    }

    async function getAccessToken() {
        if (cachedToken && expiresAt > Date.now() + 30000) return cachedToken;
        if (inFlight) return inFlight;
        const thisGeneration = generation;
        const pending = requestToken().then(({ token, expiry }) => {
            if (thisGeneration !== generation) return null;
            cachedToken = token;
            expiresAt = expiry;
            realtime?.setAuth?.(token);
            return token;
        }).catch(error => {
            if (thisGeneration === generation) {
                cachedToken = null;
                expiresAt = 0;
            }
            throw error;
        });
        inFlight = pending;
        try { return await pending; }
        finally { if (inFlight === pending) inFlight = null; }
    }

    function clear() {
        ++generation;
        cachedToken = null;
        expiresAt = 0;
        inFlight = null;
        // Caller MUST also remove protected Realtime channels on logout.
        realtime?.setAuth?.('');
    }

    return { getAccessToken, clear };
}
