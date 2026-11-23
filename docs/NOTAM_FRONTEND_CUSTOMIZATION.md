# NOTAM frontend customization

Edit the HTML blocks in **`dev/assets/js/warzone-notice-templates.js`** and the existing NOTAM CSS in **`dev/assets/css/warzone-components.css`**. You do not need to trace Cesium or capture code to edit the structure and labels below.

The repository has no webpack rule for importing HTML as text. This refactor uses the requested fallback: readable multiline HTML in one presentation module, bundled by the existing JavaScript pipeline. There are no separate `.html` files, new loaders, dependencies, or runtime template requests. Keep each block between its opening and closing backticks; avoid literal backticks or `${...}` inside the markup.

## Where to edit

| Interface | HTML block in `warzone-notice-templates.js` | Existing CSS selectors |
| --- | --- | --- |
| Floating Published Notice widget and shared popup header | `panel`, plus `collapse` | `#warzone-notice-panel`, `.wz-widget-milbase`, `.wz-widget-header`, `.wz-widget-title`, `.wz-widget-header-actions`, `.wz-widget-body` |
| Widget summary, filters, pagination, card container | `list` | `.wz-notice-summary`, `.wz-notice-controls`, `.wz-notice-cards` |
| Loading, unavailable and error message element | `state` | `#warzone-notice-panel .wz-widget-body p` |
| Compact map preview | `preview`, inside the shared `panel` | `#warzone-notice-popup.wz-notice-preview`, `.wz-notice-preview .wz-notice-summary`, `.wz-notice-actions` |
| Full details popup | `popup`, inside the shared `panel` | `#warzone-notice-popup.wz-notice-popup`, `.wz-widget-data-list`, `.wz-notice-actions` |
| Repeated source/provenance rows and original-source link | `row`, `source` | `.wz-widget-data-list li`, `.wz-widget-data-list strong`, `.wz-widget-data-list span` |
| Notice card | `card` | `.wz-notice-card`, `.wz-notice-card__head`, `.status-pill` |
| List Unfocus control restored after closing details | `unfocus` (also edit its counterpart in `list`) | `.wz-notice-controls .btn-primary` |
| TAKE SHOT overlay, selection, resize handle and toolbar | `capture` | `.wz-notice-capture`, `.wz-notice-capture__selection`, `.wz-notice-capture__resize`, `.wz-notice-capture__toolbar` |
| PNG branding and information layout | `export` | `.notam-export` and `.notam-export__*` |

`body` is the small heading/list skeleton used when switching preview and details in the same popup. Keep it consistent with the body skeleton in `panel`. The outer `<section>` in `preview`, `popup` and `list` is only a template holder: its children are inserted directly into `.wz-widget-body`, without an additional visible wrapper.

## Labels and information order

Change the text inside a button without changing its `data-action`. For example:

```html
<button type="button" class="btn-primary" data-action="more">Read full notice</button>
```

For labels that switch with state, edit the attributes too:

- Focus: `data-focus-label` and `data-unfocus-label` in `popup`.
- Military filter: `data-all-label` and `data-military-label` in `list`.
- DRAW/RESIZE: `data-draw-label` and `data-resize-label` in `capture`.
- Collapse accessibility labels: `data-expand-label` and `data-collapse-label` in `collapse`.
- Capture instructions: `data-draw-instructions` and `data-resize-instructions` on the live status span.
- Preview and export field captions: `data-label`.

Reorder whole `<li>...</li>` rows in `popup`. Edit their `<strong>` labels freely. Keep each `data-field` unchanged, including capitalization and spaces: JavaScript puts the corresponding value in that span. For example, move the entire `Altitude` row above `Schedule`. Hide a row with scoped CSS if it should not be displayed; do not remove a required field that the binding code populates.

The four preview spans can be reordered in their paragraph. Preserve the newlines between them: the existing preview CSS uses `white-space: pre-line`. Move export detail `<div>` elements within `.notam-export__details` to change their order, keeping their fields and `data-export-text` attributes.

Provider text is assigned through `textContent`, and image/link URLs through DOM properties. Never interpolate notice content into these HTML blocks or assign it to `innerHTML`. `data-field` and `data-action` values are stable binding hooks, not visible captions. Keep them unique within their template. Retain `data-slot` markers, IDs assigned by the controller, existing classes and icon spans (`stratops-ico-close-1`, `stratops-ico-top-1`).

## Export logos and supported CSS

Adjust the existing CSS variables and rules in `warzone-components.css`:

- StratOps: `--notam-export-top-logo-width`, `--notam-export-top-logo-height`, `--notam-export-top-logo-max-height`, `--notam-export-top-logo-top`, `--notam-export-top-logo-opacity`; `.notam-export__stratops-logo` controls horizontal centering.
- BattlespaceX: corresponding `--notam-export-bottom-logo-*` variables, including `right` and `bottom`.
- Timestamp: `.notam-export__timestamp` and `--notam-export-time-*`.
- Notice information: `.notam-export__intelligence`, `.notam-export__identifier`, `.notam-export__type`, `.notam-export__details`, `.notam-export__detail` and `--notam-export-info-*` variables.
- Source and geographic marker: `.notam-export__source`, `.notam-export__marker`.

The PNG still uses the existing Canvas compositor. It mounts the export template temporarily offscreen, waits for fonts/images, measures browser layout and computed styles, then draws the map, labels and logos. Image sources still come from the existing capture branding configuration; moving or resizing the template images does not change their source files.

Supported output includes measured positioning and dimensions, image containment, opacity, solid background/color, font family/size/weight/style, letter spacing, uppercase text, line wrapping, padding, and polygon clip paths. Container layout (including existing flex layout) determines measured child positions. Marker placement remains tied to the geographic anchor. Collision checks can move the timestamp or information block to keep them clear, or reject layouts that overlap or exceed the capture bounds.

This is not a general HTML-to-image engine. Do not assume gradients, shadows, arbitrary borders, filters, pseudo-elements, nested rich text or arbitrary SVG/clip paths will be painted. Each `data-export-text` element receives one plain text node; do not add nested markup inside it. Keep the direct `.notam-export__intelligence` child, both image identities and marker class because the existing compositor uses them. Additional export artwork or new data bindings need a targeted compositor/controller change.

## Behavior that remains in JavaScript

`warzone-notices.js` remains responsible for records, normalization, live status, summary formatting and counts, filter state, pagination, request scheduling, expiry, geometry, map picking, focus/unfocus, popup positioning, dragging and cleanup. The attachment's `warzone-notice-layers.js` name does not exist in this checkout; `initNoticeLayers()` is in `warzone-notices.js`.

`warzone-notice-capture.js` retains selection math, minimum dimensions, aspect ratios and pixel caps, pointer handling, camera input restoration, save picker/downloads, error reporting, Canvas measurement/composition and PNG encoding. Aspect option labels are editable in HTML; their values must remain `1:1`, `16:9`, `9:16`, `custom`, matching the existing validated ratio definitions. Numeric feedback and operational error messages remain generated from actual capture state.

Cards and source records are cloned per record because their number and values come from data. JavaScript still creates the Canvas surfaces and the SVG preview leader line because these are graphics tied to current geometry. The remaining `createElement` calls are not hidden widget layouts.

Do not change viewer initialization, camera lifecycle, layer state, authentication, polling, provider/quota configuration, or backend code for a visual customization. Scope CSS to NOTAM selectors; preserve global typography, shared icons and unrelated widgets.

## Verification

Run the targeted tests from the repository root:

```powershell
node --test --test-isolation=none apps/worker/test/geospatial-notice-lifecycle.test.js apps/worker/test/notam-export-composition.test.js apps/worker/test/notice-tactical-capture.test.js apps/worker/test/notices-dragging.test.js
npm run build
```

The refactor's automated checks cover lifecycle, single ownership, request coalescing, literal provider text, editable action labels, filters/pagination, popup restoration and edges, focus, drag, capture state restoration, all aspect ratios/minimums, save cancellation/errors and measured Canvas PNG branding. The test-only HTML adapter parses the actual templates using the repository's existing `htmlparser2`; it does not verify browser layout.

Before releasing a visual customization, check the real app: open/collapse/drag the widget; change filters and pages; open preview, MORE and full provenance; focus/unfocus; copy coordinates; return to the list; move the camera to popup edges; take shots at all four ratios; draw/move/resize/reset/cancel/save; inspect logos, wrapping and labels in the PNG. Also check entry/authentication transitions, existing layers and satellites, and that no viewer/loader/camera state is restarted. Browser validation of this refactor could not run in the restricted workspace: bundled Playwright Chromium is absent and installed Chrome launch returns `spawn EPERM`.
