# StratOps Platform Capabilities

## Platform Overview

StratOps is an interactive operational visualization platform for monitoring global and regional security activity. It combines a Cesium-based 3D globe, operational event layers, live asset tracking, floating intelligence panels, regional controls, and report viewing into a single battlespace interface.

The platform is designed for OSINT-informed situational awareness, partner briefings, and rapid review of operational activity. It is not an official warning network, emergency notification system, classified intelligence product, or independent verification authority.

## Multi-Domain Operational Visualization

StratOps presents multiple operational domains on one map surface, including strikes, missiles, drones, air-delivered activity, aircraft telemetry, naval activity, known military bases, radar or threat ranges, cyber signals, airspace status, GNSS interference, thermal or fire-related events, reconnaissance indicators, seismic or explosion signals, activity hotspots, public orbital asset estimates, satellite observations, country borders, and selected-region focus overlays.

Layer availability and accuracy depend on the underlying data available to the platform. Some layers are visual or contextual overlays rather than confirmed operational detections.

## OSINT and Event Intelligence

The event view normalizes incoming open-source and partner-accessible operational records into map-ready events. Events can be filtered by region and layer type, rendered as map markers, summarized in operational panels, and shown in timeline and Intel Wire views.

Intel Wire is a separate feed surface for slower contextual intelligence and media-rich items. It is intended to complement live map events without mixing general news or procurement-style content into live operational markers.

## Live Aircraft Tracking

StratOps includes a live aircraft tracker with map symbols, selected-asset focus, aircraft labels, heading information, recent aircraft history, current-region filtering, country and aircraft-type filters, readable uppercase widget cards, and focused 3D model rendering for selected assets.

This capability is conditional on aircraft data availability and source reliability. Aircraft positions, headings, callsigns, and metadata should be treated as operational telemetry for context, not as an authoritative air picture.

## Naval Tracking

The naval tracker displays naval contacts and vessel-linked signals with map symbols, labels, current-region filtering, country and vessel-type filters, readable uppercase widget cards, focused asset interaction, and 3D context rendering for selected or nearby naval assets.

Naval visibility is conditional on available data and classification quality. Vessel type, role, and identity labels may be inferred or incomplete.

## Orbital Assets

StratOps includes a premium Orbital Assets layer for public military-associated and dual-use satellite tracking. The layer retrieves CelesTrak public GP orbital elements through the StratOps API, caches the result, and uses satellite.js in the browser to propagate estimated satellite positions.

This is not live satellite detection. It presents public orbital estimates, predicted positions, public associations, mission categories, and confidence labels. The focused view can show a selected satellite model, recent and predicted orbit path, sub-satellite ground track, nadir line, and a theoretical line-of-sight footprint. The footprint is geometric context only and is not labeled as sensor range or surveillance coverage.

## Military Bases and Strategic Assets

StratOps can display known military bases and strategic installation locations as an optional map layer. The military track system also supports operational military event rendering for selected asset categories.

This layer is contextual and may include static reference data. It should not be interpreted as a live base-status confirmation.

## Satellite Observations and Imagery

StratOps includes a satellite observations layer and satellite context display for available imagery-linked items. The current implementation treats satellite observations as contextual review material tied to events or feed items.

Satellite availability is limited and data-dependent. Satellite context does not prove damage, attribution, or live activity unless independently confirmed by the underlying source.

## Alerts, Airspace, Cyber, GNSS, and Infrastructure Signals

The platform supports alert and siren surfaces, sticky alert display, DEFCON-style status presentation, airspace status panels, cyber status panels, GNSS interference visualization, thermal/fire events, infrastructure disruption signals, and operational warning layers.

These indicators are normalized for situational awareness. They may be incomplete, delayed, source-dependent, or unavailable when supporting endpoints or live data are offline.

## Regions, Lenses, Filters, Layers, and AOI Controls

StratOps supports regional monitoring controls, current-region filtering, layer toggles, widget controls, scope filters, AOI scan controls, and selected-region visual emphasis. The interface includes both desktop dock controls and mobile menu controls for major panels and actions.

Some controls are UI-only overlays; others start data loading, entity creation, or live tracking pipelines when enabled.

## 3D Cesium Visualization and Asset Interaction

The core map is a Cesium globe with satellite basemap support, 2D/3D scene controls, animated event markers, focus reticles, camera-centered asset focus, selected asset controls, raised region overlays, contours, threat ranges, sweepers, and performance-aware rendering behavior.

The platform prioritizes an immersive 3D operational view while retaining optional 2D scene support where available.

## Widgets, Panels, Search, Focus, Replay, and Timeline

Implemented interface panels include theater intelligence, map layers, Intel Wire, escalation, cyber status, airspace status, aircraft tracker, naval tracker, AOI scan, GNSS legend, and event timeline-style lists. Users can open, close, move, collapse, and filter several panels.

Asset focus supports selected aircraft and naval contacts. Historical/replay-style behavior is present through recent event and aircraft history handling, subject to available cached data.

## Reports, Summaries, and Exports

StratOps includes an operational briefings modal, report listing, daily report generation request, PDF report viewer, and report opening/downloading flow. Reports are intended to present cached or generated operational summaries in a shareable format.

Report generation and availability are backend-dependent. A report may not appear if the report endpoint, cached file, or download token is unavailable.

## Authentication and Access Controls

The interface includes StratOps sign-in, intro/terms acceptance flows, authenticated-state handling, premium layer gating, and support/billing entry points. Current premium gates include aircraft tracking, naval tracking, military bases, GNSS jamming, radar/threat ranges, radar sweepers, cyber operations, airspace status, Orbital Assets, and Satellite Observations.

Authentication behavior depends on the configured deployment environment and supporting API availability.

## Main Practical Use Cases

- Rapid regional monitoring of open-source operational events.
- Shared map review for aircraft, naval, airspace, GNSS, cyber, and strike activity.
- Visual partner briefings using focused assets, layers, AOI tools, and report output.
- Public orbital review for military-associated and dual-use satellites using CelesTrak GP elements.
- Contextual review of event-linked satellite observations and Intel Wire items.
- Operational dashboarding for teams that need a consolidated map and panel interface.

## Platform Disclaimer

StratOps presents OSINT-informed monitoring data and contextual operational visualization. It is not an official military, government, emergency, or classified intelligence system. Data may be incomplete, delayed, inferred, duplicated, or wrong. Users should verify critical findings through authoritative channels before making operational, safety, legal, or policy decisions.
