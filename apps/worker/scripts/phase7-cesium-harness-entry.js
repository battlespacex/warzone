// Bundled only by phase7-cesium-harness.cjs; never included in the app entries.
import * as Cesium from "cesium";
import {
  upsertLiveTrack, clearAllLiveTracks, clearAllLiveTrackRenderState,
  syncLiveTrackRenderPopulation, getLiveTrackDiagnostics,
  focusLiveTrack, clearLiveTrackSelection,
} from "../../../dev/assets/js/warzone-live-airforce.js";
import {
  upsertNavalVessel, clearNavalVessel, setNavalLayerVisible,
  getNavalDiagnostics, focusNavalVessel,
} from "../../../dev/assets/js/warzone-live-naval.js";
import { initWarzoneGlobe } from "../../../dev/assets/js/warzone-globe.js";

window.CESIUM_BASE_URL = "/assets/cesium/";
const viewer = new Cesium.Viewer("globe", {
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  navigationHelpButton: false,
  baseLayerPicker: false,
  sceneModePicker: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
});
window.__warzoneViewer = viewer;
viewer.__warzone = { requestRender: () => viewer.scene.requestRender() };
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(45, 28, 7_000_000) });
window.__phase7Harness = {
  Cesium, viewer, upsertLiveTrack, clearAllLiveTracks, clearAllLiveTrackRenderState,
  syncLiveTrackRenderPopulation, getLiveTrackDiagnostics,
  focusLiveTrack, clearLiveTrackSelection, upsertNavalVessel,
  clearNavalVessel, setNavalLayerVisible, getNavalDiagnostics, focusNavalVessel,
  initWarzoneGlobe,
};
