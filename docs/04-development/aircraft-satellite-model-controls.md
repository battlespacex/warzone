# Aircraft mappings and operational satellite model controls

Implemented locally on 27 November 2026. No deployment, production data changes, dependency installation, model downloads, model edits, commits or pushes.

## Implementation and modified files

| File | Functions/changes |
|---|---|
| `apps/shared/aircraft-trainer-exclusions.js` | `isExcludedTrainerAircraftText`: formatting normalization, requested platform variants and contextual alias exclusions. Existing trainer/operational exceptions retained. |
| `dev/assets/js/warzone-live-airforce.js` | Aircraft asset registry, exact mapping rules, `buildExactAircraftModelHaystack`, `resolveExactAircraftModelAssetKey`, `resolveLiveTrackModelCode`, `resolveFocusedAircraftFallbackModelCode`. |
| `dev/assets/js/warzone-satellite-models.js` | ISS/CSS profiles and precise identification; cached `getOperationalSatelliteModelStyle` and explicit invalidation. Startup model list unchanged. |
| `dev/assets/js/warzone-mil-sats.js` | Operational orientation/graphics readers, model creation/update/focus bindings, coalesced style refresh on resize/orientation/root-style/stylesheet changes, pending refresh cancellation on layer cleanup. |
| `dev/assets/css/root.css` | Global and independent station controls at the base root and all five existing media queries. Existing aircraft/naval properties and breakpoint definitions retained. |
| `apps/worker/test/model-controls-request.test.mjs` | New exclusion, mapping, station, CSS cache/unit/override and breakpoint regressions. |
| `apps/worker/test/orbital-performance.test.js` | Bind the new style-reader dependency in the existing source-extraction harness. Retain timing, reuse and lifecycle assertions. |
| `apps/worker/test/aircraft-model-selection.test.mjs` | Repair missing harness bindings, assert the newly requested fallback and retain exact mappings during transient delivery errors. |
| This report | Configuration, audit and validation record. |

Unrelated existing marketing, NOTAM and CSS worktree edits were preserved. Newly supplied assets remain unmodified: `Heli-NH90.glb`, `Sat-ISS.glb`, `Sat-CSS.glb`.

## Aircraft filtering and mappings

The shared filter already feeds worker normalization, browser ingestion, map eligibility and aircraft rendering. Extending it preserves consistent eligibility before model assignment and avoids a second filtering/counting system.

- Exclude T-44A/T-44AS, C-12V, F-5N, T-41/Mescalero, DG-1000S/TG-16, and PC-6/B2-H4. Matching is case-insensitive, normalizes unusual hyphens/spacing and uses boundaries.
- PEGASUS/HURON/PAT322 require Beech/King Air context. An explicitly supplied other C-12 variant is retained. FMMCA requires Pilatus context and does not exclude identified PC-12/PC-24 aircraft. TIGER needs Northrop/F-5 context and does not exclude identified F-5A/B/E/F or Airbus Tiger helicopters. Bare ambiguous callsigns are not universal exclusion tokens.
- Preserve existing trainer exceptions such as operational FA-50 unless training is explicit. KC-46 Pegasus and lookalike numeric types are not excluded by the new rules.

| Identification | Visual model |
|---|---|
| E-7A/Wedgetail; 737-700 with AEW&C/AWACS metadata | `AWACS-E7.glb` |
| IL-62 | `Tanker-A330-MRTT.glb` — intentional substitution |
| HRON type; HRON/GAF512 callsigns without a conflicting positive type | `Drone-MQ9.glb` — intentional assignment |
| UH-72; NH90 | `Heli-NH90.glb` — UH-72 is an intentional substitution |
| Otherwise unidentified eligible aircraft | `ISR-Gulfstream.glb` |

Dedicated mappings precede the final fallback. Callsign assignments do not replace F-16, B737 or other positively supplied conflicting types. The visual choice never changes aircraft identity, classification or telemetry. Eligibility is still decided by the existing ingestion/tracker rules, not by the fallback.

The complete aircraft model directory was compared with registry filenames: all available aircraft GLBs are registered, including NH90. No other unmatched asset required a speculative mapping. Existing reliable mappings were retained.

## Stations and operational rendering

NORAD 25544 selects `Sat-ISS.glb`; 48274 selects `Sat-CSS.glb`. Recognized NORAD identity takes precedence over names. Exact normalized station aliases are used only when no catalog ID is supplied. Historical Tiangong 1/2, module/visiting-craft names and records with conflicting IDs do not select a complete station model through loose substring matching.

The military catalog already contained the two explicit civilian exceptions. Its filtering/source policy was not broadened or rewritten. Existing stable record IDs, entity reuse, propagation, selection and focus paths are retained. Models remain assigned during updates and deselection. Decorative startup satellites continue using their separate model list and legacy styling readers.

## Complete CSS control structure

Each prefix below has the same nine suffixes, producing **27 distinct custom properties**:

| Scope | Prefix |
|---|---|
| Global operational satellites | `--warzone-live-satellite-model-` |
| ISS override | `--warzone-live-satellite-iss-model-` |
| Tiangong/CSS override | `--warzone-live-satellite-css-model-` |

| Suffix | Meaning / initial configuration |
|---|---|
| `scale` | Normal model scale; inherits existing `--warzone-satellite-model-scale`. |
| `scale-min` | Lower scale bound, initially zero to preserve the previous absence of a positive lower clamp. |
| `scale-max` | Scale bound/Cesium maximumScale; inherits existing orbital maximum. |
| `min-pixel-size` | Normal minimumPixelSize; inherits the existing orbital minimum. |
| `focused-size` | Focused scale; initially follows global operational scale. |
| `focused-min-pixel-size` | Focused minimumPixelSize; inherits existing selected orbital minimum. |
| `heading` | Visual heading in degrees, initialized from existing satellite heading. |
| `pitch` | Visual pitch in degrees, initialized from existing rotate-Y. |
| `roll` | Visual roll in degrees, initialized from existing rotate-X. |

Independent station declarations inherit global operational properties by default. Valid station overrides win, then global properties, then existing JavaScript defaults. Numbers, pixel suffixes for pixel settings and degree suffixes for angles are parsed with finite-value validation; malformed values fall back rather than propagating NaN. CSS expressions beyond the resolved numeric/px/deg forms are not evaluated by JavaScript.

The complete structure exists in the default root and these unchanged media queries:

- Up to 767px.
- 768–1920px.
- 1921–2560px.
- 2561–3839px.
- 3840px and above.

Changes apply to existing model graphics without recreating entities or reloading GLBs. Style reads are cached by model profile/focus state; resize, orientation changes and CSS edits invalidate the cache and coalesce updates into one frame. The existing operational orientation cache remains. Pending style frames are canceled on layer cleanup. Rotation is applied through the existing ENU/heading-pitch-roll math and never changes orbital coordinates.

## Validation and limits

- 64 targeted tests passed across aircraft mappings and exclusions, operational satellite performance, 300-record construction, propagation/sample reuse, station ON/OFF lifecycle, focus math, responsive graphics refresh, cancellation, military identification, model delivery and neighboring tracker/layer lifecycle tests.
- The original aircraft model-selection test reproduced three failures against unchanged HEAD: missing harness bindings and an outdated expectation that transient asset delivery failures erase known mappings. Those harness/expectation issues were corrected; explicit Gulfstream fallback expectations now reflect this request.
- The three supplied assets are embedded-buffer GLB 2.0 files, respectively 23,728 / 50,176 / 28,988 bytes. All three Meshopt buffer views in each asset decoded successfully using the existing decoder; no regeneration or recompression occurred.
- Complete built-model integrity checks passed for 67 GLB assets. JavaScript syntax and diff whitespace checks passed.
- Build uses the existing isolated-output workspace `.generated/air-patrol-validation/workspace` so existing deployment output is not overwritten. Application and marketing output are both checked with `npm run build`; existing size warnings remain.

Actual Chrome/WebGL appearance, interactive viewport resizing, per-model visual proportions and live-feed availability are not measured by Node tests. No browser FPS, GPU-memory or production behavior claim is made. An intentional substitute remains a visual representation, not a verified identification of that airframe.
