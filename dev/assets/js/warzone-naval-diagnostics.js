// Imported by the development entry only; no production route, bundle or polling timer.
let dialog;
window.__showWarzoneNavalDiagnostics = async () => {
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.className = "warzone-panel";
        const title = document.createElement("h2"); title.textContent = "Development AIS diagnostics";
        const output = document.createElement("pre");
        const refresh = document.createElement("button"); refresh.textContent = "Refresh"; refresh.className = "btn-secondary white";
        const close = document.createElement("button"); close.textContent = "Close"; close.className = "btn-primary";
        refresh.addEventListener("click", () => window.__showWarzoneNavalDiagnostics());
        close.addEventListener("click", () => dialog.close());
        dialog.append(title, output, refresh, close); document.body.appendChild(dialog);
    }
    if (!dialog.open) dialog.showModal();
    let worker;
    try {
        const response = await fetch("/__warzone/naval-diagnostics", { cache: "no-store" });
        if (!response.ok) throw new Error(`Worker diagnostics HTTP ${response.status}`);
        worker = await response.json();
    } catch (error) { worker = { unavailable: error.message, instruction: "Enable STRATOPS_DEV_DIAGNOSTICS=true on the local worker; no provider session is started by this view." }; }
    dialog.querySelector("pre").textContent = JSON.stringify({ worker, client_filters: window.__stratopsNavalFilterDiagnostics || null,
        client_renderer: window.__getStratOpsPerformanceDiagnostics?.()?.naval || null }, null, 2);
};
