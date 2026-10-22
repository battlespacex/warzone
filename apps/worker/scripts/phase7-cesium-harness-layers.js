// Synthetic layer state for the private harness only. Production layer and
// entitlement modules are imported unchanged by the normal application build.
export * from "../../../dev/assets/js/warzone-layers.js?phase7-real";
export function isLayerEnabled(id) {
  if (id === "aircraft" || id === "naval") return window.__phase7SyntheticLayers?.[id] === true;
  return false;
}
