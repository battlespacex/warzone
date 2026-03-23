// assets/js/warzone-theater-panel.js

import { getTheaterDefinitions } from "./warzone-theaters.js";

let containerEl = null;

export function initTheaterPanel() {
    containerEl = document.getElementById("wz-theater-panel");
    if (!containerEl) return;

    renderEmpty();
}

export function updateTheaterPanel(events = []) {
    if (!containerEl) return;

    const theaters = getTheaterDefinitions();

    const stats = theaters.map((t) => {
        let score = 0;

        for (const ev of events) {
            if (ev.theater?.id === t.id) {
                score += ev.theater.score || 1;
            }
        }

        return {
            id: t.id,
            label: t.label,
            score
        };
    });

    render(stats);
}

function renderEmpty() {
    containerEl.innerHTML = `<div class="wz-theater-empty">No active theaters</div>`;
}

function render(stats) {
    const sorted = stats
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

    if (!sorted.length) {
        renderEmpty();
        return;
    }

    containerEl.innerHTML = sorted.map(t => {
        const level = getRiskLevel(t.score);

        return `
            <div class="wz-theater-card" data-theater="${t.id}">
                <div class="wz-theater-title">${t.label}</div>
                <div class="wz-theater-meta">
                    <span class="wz-theater-risk ${level.class}">
                        ${level.label}
                    </span>
                    <span class="wz-theater-score">
                        ${Math.round(t.score)}
                    </span>
                </div>
            </div>
        `;
    }).join("");
}

function getRiskLevel(score) {
    if (score > 40) return { label: "Active Conflict", class: "is-high" };
    if (score > 20) return { label: "Tension", class: "is-mid" };
    return { label: "Monitoring", class: "is-low" };
}