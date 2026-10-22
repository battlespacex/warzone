// Candidate index for aircraft duplicate checks. The final match still uses
// the tracker's existing identity, subtype, position, heading and speed rules.
export function createAircraftIdentityIndex() {
    const buckets = new Map();
    const tokensByKey = new Map();
    const orderByKey = new Map();
    let nextOrder = 0;

    function deactivate(key) {
        const previous = tokensByKey.get(key);
        if (!previous) return;
        previous.forEach((token) => {
            const bucket = buckets.get(token);
            bucket?.delete(key);
            if (bucket?.size === 0) buckets.delete(token);
        });
        tokensByKey.delete(key);
    }

    return {
        set(key, tokens) {
            if (!key) return;
            const next = [...new Set(tokens.filter(Boolean))];
            const previous = tokensByKey.get(key);
            if (previous?.length === next.length && previous.every((token, index) => token === next[index])) return;
            deactivate(key);
            if (!orderByKey.has(key)) orderByKey.set(key, ++nextOrder);
            tokensByKey.set(key, next);
            next.forEach((token) => {
                let bucket = buckets.get(token);
                if (!bucket) buckets.set(token, bucket = new Set());
                bucket.add(key);
            });
        },
        deactivate,
        delete(key) {
            deactivate(key);
            orderByKey.delete(key);
        },
        candidates(tokens) {
            const keys = new Set();
            tokens.forEach((token) => buckets.get(token)?.forEach((key) => keys.add(key)));
            return [...keys].sort((a, b) => orderByKey.get(a) - orderByKey.get(b));
        },
    };
}
