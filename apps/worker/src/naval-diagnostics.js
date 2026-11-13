export function canReadNavalDiagnostics(env, remoteAddress) {
    return env.NODE_ENV !== "production" && env.STRATOPS_DEV_DIAGNOSTICS === "true"
        && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

export function navalProviderDiagnostics(providers) {
    // Explicit fields only: never expose provider config, credentials, URLs or observations.
    const fields = ["connected", "subscription_confirmed", "compression_enabled", "frames", "messages_received",
        "position_messages", "valid_positions", "cached_contacts", "last_message_at", "reconnection_attempts", "next_reconnect_at"];
    return providers.map((provider) => {
        const detail = provider.getDiagnostics?.() || {};
        return { id: provider.id, enabled: provider.enabled, disabled_reason: provider.enabled ? null : provider.disabledReason,
            has_error: Boolean(detail.last_error),
            ...Object.fromEntries(fields.filter((key) => key in detail).map((key) => [key, detail[key]])) };
    });
}
