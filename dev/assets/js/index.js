import "../css/style.css";
import { initBoot } from "./essential.js";
import { supabase } from "./supabase.js";

initBoot();

async function loadEvents() {
    const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("occurred_at", { ascending: false });

    if (error) {
        console.error("Error loading events:", error);
        return;
    }

    console.log("Events from Supabase:", data);
}

loadEvents();

supabase
    .channel("events-live")
    .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        payload => {
            console.log("New event:", payload.new);
            location.reload();
        }
    )
    .subscribe();