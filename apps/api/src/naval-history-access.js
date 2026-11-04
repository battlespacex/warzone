const AUTH_VALIDATION_URL = "https://www.battlespacex.com/api/auth/validate";
const PREMIUM_PLANS = new Set(["advanced", "expert"]);
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function authorizeNavalHistory(req, {
    fetchImpl = fetch,
    getSupabaseClient,
    validationUrl = AUTH_VALIDATION_URL,
} = {}) {
    const cookie = String(req.headers?.cookie || "").trim();
    if (!cookie || !getSupabaseClient) return { allowed: false, status: 401 };
    let validated;
    try {
        const response = await fetchImpl(validationUrl, {
            method: "GET",
            headers: { Cookie: cookie, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
            redirect: "manual",
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return { allowed: false, status: 401 };
        validated = await response.json();
    } catch {
        return { allowed: false, status: 503 };
    }
    if (validated?.isAuthenticated !== true) return { allowed: false, status: 401 };
    const email = String(validated?.user?.email || validated?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return { allowed: false, status: 403 };
    }
    try {
        const table = String(process.env.STRATOPS_SUBSCRIPTIONS_TABLE || "stratops_subscriptions");
        const { data, error } = await getSupabaseClient().from(table)
            .select("plan, status")
            .eq("email", email)
            .maybeSingle();
        if (error) return { allowed: false, status: 503 };
        const allowed = PREMIUM_PLANS.has(String(data?.plan || "").toLowerCase()) &&
            ACTIVE_STATUSES.has(String(data?.status || "").toLowerCase());
        return { allowed, status: allowed ? 200 : 403 };
    } catch {
        return { allowed: false, status: 503 };
    }
}
