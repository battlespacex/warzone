// Detach optional Cesium visualizers while retaining parsed records for reuse.
const attachments = new WeakMap();

export function setDataSourceActive(viewer, dataSource, active) {
    const collection = viewer?.dataSources;
    if (!collection || !dataSource || viewer.isDestroyed?.()) return;
    let state = attachments.get(dataSource);
    if (!state) {
        state = { active: false, pending: null };
        attachments.set(dataSource, state);
    }
    state.active = active === true;
    if (!state.active) {
        collection.remove(dataSource, false);
        return;
    }
    if (collection.contains(dataSource) || state.pending) return;
    // DataSourceCollection.add is asynchronous, including for an existing object.
    // One pending add prevents duplicate attachment during rapid OFF/ON cycles.
    state.pending = Promise.resolve(collection.add(dataSource))
        .then(() => {
            if (!state.active && !viewer.isDestroyed?.()) collection.remove(dataSource, false);
        })
        .catch((error) => console.warn("Optional data source attachment failed:", error))
        .finally(() => { state.pending = null; });
}
