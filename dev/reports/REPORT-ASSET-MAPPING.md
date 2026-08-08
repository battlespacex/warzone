# StratOps report asset mapping

This package keeps the existing shared asset folders unchanged. The report template now uses **relative URLs** so the same HTML works when opened directly with `file://` and when served from the StratOps site with the same folder structure.

## Shared/static assets — unchanged

- `assets/images/web/...`
- `assets/fonts/...`

From `reports/template/reports-template.html`, shared images are referenced as `../../assets/images/web/...`.
From `reports/template/reports.css`, fonts are referenced as `../../assets/fonts/...`.

These are references only; the actual shared asset folders were not moved or renamed.

## Template assets

- HTML: `reports/template/reports-template.html`
- CSS: `reports/template/reports.css`
- CSS link from HTML: `./reports.css`

## Current sample report images

- Folder: `reports/images/report-2026-08-08-img/`
- From the template: `../images/report-2026-08-08-img/...`

## Future generated report structure

Recommended generated captures should be date/scope-specific, while static shared assets remain in `/assets`:

```text
reports/
  daily/
    global/
      2026-08-08/
        report.html
        report.pdf
        report.json
        manifest.json
        images/
          operational-overview.jpg
          theater-01.jpg
          incident-01.jpg
          hva-01-focus.jpg
          ...
```

The renderer should resolve generated-image URLs relative to the generated report or supply absolute HTTP URLs when rendering through the StratOps server. Do not copy permanent logos/fonts into each dated report.
