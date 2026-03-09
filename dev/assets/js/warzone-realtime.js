import { supabase } from "./supabase.js";
import { handleIncomingEvent } from "./essential.js";
import { showStickyAlert, hideStickyAlert } from "./warzone-sticky-alert.js";

export async function subscribeToLiveEvents() {
    return supabase
        .channel("events-live")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "events",
            },
            (payload) => {
                handleIncomingEvent(payload.new);
            }
        )
        .subscribe();
}

export async function subscribeToActiveAlerts() {
    const { data, error } = await supabase
        .from("active_alerts")
        .select("*")
        .eq("status", "active")
        .order("updated_at", { ascending: false });

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