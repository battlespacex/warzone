# Focus CTR radar

Edit the **Focus CTR radar only** block in `dev/assets/css/root.css`.
Air and Naval use the same renderer and shared style controls. Air uses the
shared radius/spacing defaults; Naval overrides those three values because its
existing CTR camera range is wider.

| CSS variable | Default | Unit |
| --- | ---: | --- |
| `--warzone-ctr-radar-inner-radius` | 150 | metres |
| `--warzone-ctr-radar-outer-radius` | 300 | metres |
| `--warzone-ctr-radar-ring-width` | 1.5 | pixels |
| `--warzone-ctr-radar-grid-width` | 1 | pixels |
| `--warzone-ctr-radar-grid-spacing` | 50 | metres per square |
| `--warzone-ctr-radar-ring-count` | 2 | rings, including inner and outer |
| `--warzone-ctr-radar-scale` | 1 | multiplier for radii and spacing |
| `--warzone-naval-ctr-radar-inner-radius` | 1500 | metres |
| `--warzone-naval-ctr-radar-outer-radius` | 3000 | metres |
| `--warzone-naval-ctr-radar-grid-spacing` | 500 | metres per square |

To override one tracker, replace `--warzone-ctr-radar-` with
`--warzone-aircraft-ctr-radar-` or `--warzone-naval-ctr-radar-` for any setting.
For example, `--warzone-naval-ctr-radar-grid-spacing: 400;` changes only naval squares.
Line widths are not multiplied by scale. Existing grid colors, alpha, major-line
styling and edge fade remain in the neighboring `--warzone-contour-grid-*` controls.

At least two rings are retained; additional rings are evenly spaced between
the inner and outer radii. Ring count is capped at eight and grid density at
64 intervals across the diameter to bound geometry cost. Inner radius is limited
to 95% of the outer radius. The older contour-grid radius controls still apply
to non-focused overlays.

The aircraft radar follows the focused aircraft's longitude, latitude **and
altitude**; the naval radar remains on the sea-level curved WGS84 surface.
This prevents an airborne target's radar from slipping below the screen when
the unchanged Focus camera looks toward the aircraft rather than sea level.
Movement updates the existing primitive's local geographic frame. A style or
profile change rebuilds the radar once on the next grid ensure/activation;
ordinary movement does not rebuild it. Reload after editing CSS defaults.

Camera ranges, model sizes, cyan Focus reticles, 3D mode and terrain contour
generation are independent and unchanged.
