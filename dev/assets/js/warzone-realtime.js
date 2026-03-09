import { supabase } from "./supabase.js";
import { handleIncomingEvent } from "./essential.js";

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