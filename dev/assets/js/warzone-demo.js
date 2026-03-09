// assets/js/warzone-demo.js
export function bindMissileDemoButton() {
    const btn = document.getElementById("run-missile-demo");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const globe = window.__warzoneViewer?.__warzone;
        if (!globe) return;

        // Missile 1
        globe.animateMissileTrack({
            id: `demo-m1-${Date.now()}`,
            category: "strike",
            severity: "critical",
            origin_lat: 34.3142,
            origin_lon: 47.0650,
            origin_label: "Kermanshah, Iran",
            impact_lat: 32.0853,
            impact_lon: 34.7818,
            impact_label: "Tel Aviv, Israel",
            location_label: "Tel Aviv, Israel",
            animation_duration_ms: 10000,
            persist_ms: 12000
        });

        // Missile 2
        setTimeout(() => {
            globe.animateMissileTrack({
                id: `demo-m2-${Date.now()}`,
                category: "strike",
                severity: "high",
                origin_lat: 31.7683,
                origin_lon: 35.2137,
                origin_label: "Jerusalem, Israel",
                impact_lat: 25.2048,
                impact_lon: 55.2708,
                impact_label: "Dubai, UAE",
                location_label: "Dubai, UAE",
                animation_duration_ms: 9000,
                persist_ms: 11000
            });
        }, 1800);

        // Missile 3
        setTimeout(() => {
            globe.animateMissileTrack({
                id: `demo-m3-${Date.now()}`,
                category: "strike",
                severity: "medium",
                origin_lat: 29.3759,
                origin_lon: 47.9774,
                origin_label: "Kuwait City, Kuwait",
                impact_lat: 35.6892,
                impact_lon: 51.3890,
                impact_label: "Tehran, Iran",
                location_label: "Tehran, Iran",
                animation_duration_ms: 8500,
                persist_ms: 10000
            });
        }, 3400);
    });
}