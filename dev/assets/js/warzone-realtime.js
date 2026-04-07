// File Path: /assets/js/warzone-realtime.js
import { supabase } from "./supabase.js";
import { handleIncomingEvent } from "./essential.js";
import { showStickyAlert, hideStickyAlert } from "./warzone-sticky-alert.js";
import { api } from "./supabase.js";
export async function subscribeToLiveEvents() {
    return supabase
        .channel("events-live")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "events",
            },
            (payload) => {
                const eventType = String(payload.eventType || payload.event || "").toUpperCase();
                if (eventType === "DELETE") return;
                const row = payload.new || payload.old;
                if (!row) return;
                handleIncomingEvent(row);
            }
        )
        .subscribe();
}
export async function subscribeToActiveAlerts() {
    const { data, error } = await api.getActiveAlerts();
    if (error) {
        console.error("Active alerts fetch error:", error);
        return null;
    }
    (data || []).forEach(showStickyAlert);
    return supabase
        .channel("active-alerts-live")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "active_alerts",
            },
            (payload) => {
                const row = payload.new || payload.old;
                if (!row) return;
                if (row.status === "active") {
                    showStickyAlert(row);
                } else {
                    hideStickyAlert(row.alert_key);
                }
            }
        )
        .subscribe();
}
export function startActiveAlertsPollingFallback() {
    setInterval(async () => {
        const { data, error } = await api.getActiveAlerts();
        if (error) {
            console.error("Active alerts polling error:", error);
            return;
        }
        const activeKeys = new Set();
        (data || []).forEach((row) => {
            activeKeys.add(row.alert_key);
            showStickyAlert(row);
        });
        const root = document.getElementById("warzone-alert");
        if (root?.dataset?.alertKey && !activeKeys.has(root.dataset.alertKey)) {
            hideStickyAlert(root.dataset.alertKey);
        }
    }, 20000);
}
export function subscribeToSirenBroadcast() {
    return supabase
        .channel("warzone:sirens")
        .on("broadcast", { event: "siren" }, (payload) => {
            try {
                const data = payload?.payload;
                if (!data) return;

                const title = String(data.title || "").toUpperCase();
                const meta = String(data.meta || "");
                const level = String(data.level || "orange");
                const sound = data.sound !== false;

                if (!title) return;

                import("./warzone-siren-alert.js").then(({ showSirenAlert }) => {
                    showSirenAlert({ title, meta, level, sound });
                });
            } catch (err) {
                console.warn("[warzone-realtime] siren broadcast error:", err);
            }
        })
        .subscribe();
}
