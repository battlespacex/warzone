import {
  buildReportDisplayFields,
  humanizeSourceList,
  stripFeedJunk,
} from "./reporting-display.js";

const REPORT_HTML_RENDER_VERSION = "stratops-html-v1";

const READY_STATUS = "READY";
const TRUSTED_POINT_PRECISIONS = new Set(["EXACT", "LOCAL"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value = "", fallback = "") {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cleanExcerpt(value = "", fallback = "", maxLength = 500) {
  const text = cleanText(value, fallback);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, Math.max(1, maxLength - 1)).replace(/\s+\S*$/, "").trim();
  return `${shortened || text.slice(0, maxLength - 1)}…`;
}

function chunk(items = [], size = 2) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function escapeHtml(value = "") {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, fallback = "0") {
  const number = finiteNumber(value);
  return number === null ? fallback : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number);
}

function formatDateTime(value, fallback = "Time unavailable") {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString().replace(".000Z", "Z");
}

function formatDateKey(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : cleanText(value).slice(0, 10);
}

function formatReportingPeriod(windowStart, windowEnd) {
  const start = formatDateKey(windowStart);
  const end = formatDateKey(windowEnd);
  return start && end ? `${start} TO ${end}` : start || end || "REPORTING PERIOD UNAVAILABLE";
}

function severityClass(value = "") {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z]+/g, "_");
  if (/(critical|intense|attention|disputed|high_impact)/.test(normalized)) return "critical";
  if (/(high|notable|elevated)/.test(normalized)) return "high";
  if (/(medium|moderate|observed|reported|plausible)/.test(normalized)) return "medium";
  if (/(low|normal|verified|confirmed|corroborated)/.test(normalized)) return "low";
  return "default";
}

function confidenceClass(value) {
  const number = typeof value === "string" ? Number.parseFloat(value) : finiteNumber(value);
  if (number !== null) {
    if (number >= 85) return "critical";
    if (number >= 70) return "high";
    if (number >= 45) return "medium";
    return "low";
  }
  return severityClass(value);
}

function basenameFromPath(value = "") {
  const parts = cleanText(value).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function safePublicImageUrl(value = "") {
  const url = cleanText(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function normalizeCaptureResult(result = {}, localImageNames = new Set()) {
  const status = cleanText(result.status).toUpperCase();
  const filename = basenameFromPath(result.s3_key || result.local_path);
  const hasLocal = status === READY_STATUS && filename && localImageNames.has(filename);
  const publicUrl = status === READY_STATUS ? safePublicImageUrl(result.s3_url) : "";
  return {
    capture_id: cleanText(result.capture_id),
    capture_type: cleanText(result.capture_type).toUpperCase(),
    status,
    event_id: cleanText(result.event_id) || null,
    cluster_id: cleanText(result.cluster_id) || null,
    asset_id: cleanText(result.asset_id) || null,
    filename: filename || null,
    src: hasLocal ? `images/${filename}` : publicUrl || null,
    width: finiteNumber(result.width),
    height: finiteNumber(result.height),
    generated_at: cleanText(result.generated_at) || null,
    failure_reason: status === "FAILED" ? cleanText(result.failure_reason, "Capture unavailable") : null,
    semantic_quality: asObject(result.semantic_quality),
  };
}

function buildExecutiveSummary(content = {}, snapshotData = {}) {
  const executive = asObject(content.executive_summary);
  const parts = [];
  const activity = cleanText(executive.activity_level).toLowerCase();
  if (activity) parts.push(`Recorded operational activity was ${activity} during the UTC reporting window.`);
  const theaters = asArray(executive.leading_theaters).filter((item) => cleanText(item?.theater)
    && !/^(?:unspecified(?: theater)?|unknown(?: theater)?|unassigned|global|europe|asia)$/i.test(cleanText(item.theater)));
  if (theaters.length) {
    parts.push(`Leading theaters were ${theaters.slice(0, 3).map((item) => `${cleanText(item.theater)} (${formatNumber(item.event_count)} items)`).join(", ")}.`);
  }
  const domains = asArray(executive.strongest_domains).filter((item) => cleanText(item?.domain));
  if (domains.length) parts.push(`The strongest recorded domains were ${domains.slice(0, 4).map((item) => `${cleanText(item.domain)} (${formatNumber(item.count)})`).join(", ")}.`);
  const developmentCount = asArray(executive.major_development_ids).length;
  if (developmentCount) parts.push(`${developmentCount} major development${developmentCount === 1 ? "" : "s"} met deterministic relevance criteria.`);
  const assetCount = asArray(executive.notable_asset_ids).length;
  if (assetCount) parts.push(`${assetCount} context-qualified high-value asset${assetCount === 1 ? " was" : "s were"} selected for assessment.`);
  const escalationCount = asArray(executive.escalation_signals).length;
  const disruptionCount = asArray(executive.notable_disruptions).length;
  if (escalationCount || disruptionCount) parts.push(`${escalationCount} escalation signal${escalationCount === 1 ? "" : "s"} and ${disruptionCount} disruption indicator${disruptionCount === 1 ? "" : "s"} were retained.`);
  const comparison = asObject(executive.comparison_to_previous_day);
  if (comparison.available === true && finiteNumber(comparison.operational_event_change) !== null) {
    const delta = finiteNumber(comparison.operational_event_change);
    parts.push(`Operational incidents changed by ${delta >= 0 ? "+" : ""}${delta} versus the preceding snapshot.`);
  }
  if (!parts.length) {
    const total = finiteNumber(snapshotData.overall_activity?.total_report_items) || 0;
    parts.push(`${total} report item${total === 1 ? " was" : "s were"} available for the reporting window.`);
  }
  return parts.join(" ");
}

function normalizeHeadlineStats(content = {}, snapshotData = {}) {
  const supplied = asArray(content.headline_stats).slice(0, 6).map((item) => ({
    id: cleanText(item?.id),
    label: cleanText(item?.label, "Report metric"),
    value: finiteNumber(item?.value) ?? cleanText(item?.value, "Unavailable"),
    supporting_text: cleanText(item?.supporting_text, "No supporting detail available"),
    state: cleanText(item?.state, "DEFAULT"),
  }));
  const overall = asObject(snapshotData.overall_activity);
  const fallback = [
    ["operational_incidents", "Operational incidents", overall.operational_event_total, "Normalized operational incidents"],
    ["high_critical", "High / critical", 0, "No high-severity total available"],
    ["corroborated", "Corroborated+", 0, "No corroboration total available"],
    ["active_clusters", "Active clusters", asArray(snapshotData.cluster_summaries).length, "Spatial operational groupings"],
    ["qualified_hva", "Qualified HVA", 0, "Context-qualified strategic assets"],
    ["source_families", "Independent sources", snapshotData.source_consensus?.independent_source_family_count, "Independent source families"],
  ];
  for (const [id, label, value, supportingText] of fallback) {
    if (supplied.length >= 6) break;
    if (supplied.some((item) => item.id === id)) continue;
    supplied.push({ id, label, value: finiteNumber(value) ?? 0, supporting_text: supportingText, state: "DEFAULT" });
  }
  return supplied.slice(0, 6);
}

function normalizeTheaters(content = {}) {
  return asArray(content.theater_sections).map((theater) => ({
    theater_id: cleanText(theater?.theater_id),
    theater: cleanText(theater?.theater, "Unspecified theater"),
    activity_level: cleanText(theater?.activity_level, "Observed"),
    event_count: finiteNumber(theater?.event_count) || 0,
    critical_count: finiteNumber(theater?.critical_count) || 0,
    high_count: finiteNumber(theater?.high_count) || 0,
    corroborated_count: finiteNumber(theater?.corroborated_count) || 0,
    dominant_domains: asArray(theater?.dominant_domains).slice(0, 5).map((entry) => ({ domain: cleanText(entry?.domain, "MIXED"), count: finiteNumber(entry?.count) || 0 })),
    major_development_count: asArray(theater?.major_development_ids).length,
    major_cluster_count: asArray(theater?.major_cluster_ids).length,
    qualified_hva_count: asArray(theater?.qualified_hva_ids).length,
    trend: cleanText(theater?.trend?.direction || theater?.trend, "not established"),
    latest_activity: cleanText(theater?.latest_significant_activity) || null,
    themes: asArray(theater?.key_operational_themes).slice(0, 6).map((theme) => ({ theme: cleanText(theme?.theme, "MIXED"), weight: finiteNumber(theme?.weight) || 0 })),
    briefing_summary: cleanExcerpt(theater?.briefing_summary, "", 360) || null,
  })).filter((theater) => !/^(?:unspecified(?: theater)?|unknown(?: theater)?|unassigned)$/i.test(theater.theater)
    && (theater.event_count >= 3
    || theater.critical_count + theater.high_count > 0
    || theater.major_development_count > 0
    || theater.major_cluster_count > 0
    || theater.qualified_hva_count > 0))
    .sort((left, right) => (right.critical_count * 12 + right.high_count * 7 + right.major_development_count * 5 + right.major_cluster_count * 4 + right.event_count)
      - (left.critical_count * 12 + left.high_count * 7 + left.major_development_count * 5 + left.major_cluster_count * 4 + left.event_count)
      || left.theater.localeCompare(right.theater));
}

function normalizeJudgments(content = {}) {
  return asArray(content.key_judgments).map((item) => ({
    id: cleanText(item?.id),
    judgment: cleanExcerpt(item?.judgment, "No judgment text available", 360),
    confidence: cleanText(item?.confidence, "UNSPECIFIED"),
    theater: cleanText(item?.theater) || null,
    domain: cleanText(item?.domain) || null,
    evidence_summary: cleanExcerpt(item?.evidence_summary, "", 220) || null,
    reasoning_basis: cleanText(item?.reasoning_basis).replace(/_/g, " ") || null,
  })).filter((item) => item.judgment && !/\b(?:concentrated in|within)\s+(?:unspecified(?: theater)?|unknown(?: theater)?|unassigned|europe|asia|global)\b/i.test(item.judgment));
}

function normalizeWatchIndicators(content = {}) {
  return asArray(content.watch_indicators).map((item) => ({
    id: cleanText(item?.id),
    indicator: cleanExcerpt(item?.indicator, "Watch indicator", 180),
    current_state: cleanExcerpt(item?.current_state, "State unavailable", 220),
    location: typeof item?.location === "string" ? cleanText(item.location) : null,
    theater: cleanText(item?.theater) || null,
    domain: cleanText(item?.domain) || null,
    confidence: cleanText(item?.confidence, "UNSPECIFIED"),
    why_it_matters: cleanExcerpt(item?.why_it_matters, "", 260) || null,
    watch_window: cleanText(item?.watch_window, "24-72H"),
  }));
}

function normalizeDevelopment(item = {}, images = []) {
  const display = buildReportDisplayFields(item);
  const precision = cleanText(item.location_precision || item.location?.precision, "UNKNOWN").toUpperCase();
  const latitude = finiteNumber(item.latitude ?? item.location?.latitude);
  const longitude = finiteNumber(item.longitude ?? item.location?.longitude);
  const locationParts = [item.event_place || item.location?.place, item.event_city || item.location?.city, item.event_region || item.location?.region, item.event_country || item.location?.country]
    .map((value) => cleanText(value)).filter(Boolean);
  const image = images.find((entry) => entry.status === READY_STATUS && entry.src && entry.event_id && entry.event_id === cleanText(item.event_id));
  return {
    report_item_id: cleanText(item.report_item_id),
    event_id: cleanText(item.event_id) || null,
    title: cleanExcerpt(display.display_title || item.display_title, "Operational development", 220),
    summary: cleanExcerpt(display.display_summary || item.display_summary, "No concise English summary was available.", 650),
    occurred_at: cleanText(item.occurred_at) || null,
    location_label: display.display_location || (precision === "UNKNOWN" ? null : ([...new Set(locationParts)].join(", ") || null)),
    location_detail: display.location_detail,
    coordinates: TRUSTED_POINT_PRECISIONS.has(precision) && latitude !== null && longitude !== null ? { latitude, longitude } : null,
    location_precision: precision,
    severity: cleanText(item.severity, "unknown").toLowerCase(),
    confidence: finiteNumber(item.confidence),
    verification_state: cleanText(item.verification_state, "REPORTED").toUpperCase(),
    domain: cleanText(item.domain || item.category, "MIXED").toUpperCase(),
    category: cleanText(item.category) || null,
    raw_report_count: finiteNumber(item.raw_report_count) || 0,
    independent_source_family_count: finiteNumber(item.independent_source_family_count) || 0,
    source_families: humanizeSourceList([
      item.display_source_name,
      item.source_name,
      ...asArray(item.source_provenance).map((entry) => entry?.source_name),
      ...asArray(item.source_family_summary || item.independent_source_families),
    ]).slice(0, 8),
    official_confirmation: item.official_confirmation === true,
    direct_evidence: item.direct_evidence === true,
    disputed: item.disputed === true || cleanText(item.verification_state).toUpperCase() === "DISPUTED",
    image: image || null,
  };
}

function normalizeAsset(asset = {}, images = []) {
  const assetId = cleanText(asset.asset_id);
  const image = images.find((entry) => entry.status === READY_STATUS && entry.src && entry.asset_id === assetId
    && ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT", "NAVAL_FOCUS"].includes(entry.capture_type));
  const altitude = finiteNumber(asset.altitude_ft);
  const rawSpeed = finiteNumber(asset.speed_kts);
  const inconsistentAirborneSpeed = cleanText(asset.track_type).toLowerCase() === "aircraft"
    && altitude !== null && altitude >= 5000 && rawSpeed !== null && rawSpeed < 30;
  const rawHeading = finiteNumber(asset.heading_deg);
  const squawk = /^[0-7]{4}$/.test(cleanText(asset.squawk)) ? cleanText(asset.squawk) : null;
  return {
    asset_id: assetId,
    track_type: cleanText(asset.track_type, "unknown"),
    callsign: stripFeedJunk(asset.callsign) || null,
    name: stripFeedJunk(asset.name) || null,
    type: stripFeedJunk(asset.type) || "Unknown type",
    variant: stripFeedJunk(asset.variant) || null,
    role: cleanText(asset.role, "UNSPECIFIED").replace(/_/g, " "),
    operator: stripFeedJunk(asset.operator) || null,
    country: stripFeedJunk(asset.country) || null,
    latitude: finiteNumber(asset.latitude),
    longitude: finiteNumber(asset.longitude),
    altitude_ft: altitude,
    speed_kts: inconsistentAirborneSpeed ? null : rawSpeed,
    heading_deg: rawHeading !== null && rawHeading >= 0 && rawHeading < 360 ? rawHeading : null,
    squawk,
    first_observed: cleanText(asset.first_observed) || null,
    last_observed: cleanText(asset.last_observed) || null,
    status: /^(active|tracked|airborne|underway|stationary)$/i.test(cleanText(asset.status)) ? cleanText(asset.status) : null,
    confidence: finiteNumber(asset.confidence),
    theater: cleanText(asset.theater) || null,
    operational_significance: cleanExcerpt(asset.operational_significance, "Qualified by the StratOps high-value asset model.", 300),
    qualification_reasons: asArray(asset.report_selection_reasons || asset.qualification_reasons).map((value) => cleanText(value).replace(/_/g, " ")).filter(Boolean),
    telemetry_note: inconsistentAirborneSpeed ? "Inconsistent airborne speed omitted from display." : null,
    image: image || null,
  };
}

function buildReportRenderModel(snapshot = {}, { localImageNames = new Set() } = {}) {
  const snapshotData = asObject(snapshot.snapshot_data);
  const content = asObject(snapshotData.report_content);
  const manifest = asObject(snapshot.report_manifest);
  const captureSource = asArray(manifest.capture_results).length ? manifest.capture_results : content.capture_results;
  const captures = asArray(captureSource).map((entry) => normalizeCaptureResult(entry, localImageNames));
  const developments = asArray(content.major_developments || content.event_cards)
    .filter((item) => item?.report_display_eligible !== false)
    .map((item) => normalizeDevelopment(item, captures));
  const broaderById = new Map(asArray(snapshotData.selections?.broader_intelligence).map((item) => [cleanText(item.intelligence_id), item]));
  const selectedWire = asArray(content.intelligence_wire_synthesis?.selected_intelligence_ids)
    .map((id) => broaderById.get(cleanText(id))).filter(Boolean).slice(0, 8).flatMap((item) => {
      const display = buildReportDisplayFields(item);
      if (!display.report_display_eligible) return [];
      return [{
        intelligence_id: cleanText(item.intelligence_id),
        source_name: display.display_source_name,
        source_class: cleanText(item.source_class, "OPEN SOURCE").replace(/_/g, " "),
        title: cleanExcerpt(display.display_title, "Intelligence item", 180),
        summary: cleanExcerpt(display.display_summary, "No concise English summary was available.", 360),
        verification_state: cleanText(item.verification_state, "REPORTED").toUpperCase(),
      }];
    });
  const consensus = asArray(content.source_consensus?.development_matrix).map((item) => {
    const development = developments.find((entry) => entry.report_item_id === cleanText(item.development_id) || entry.event_id === cleanText(item.event_id));
    return {
      development_id: cleanText(item.development_id),
      title: development?.title || "Selected development",
      raw_reports: finiteNumber(item.raw_reports) || 0,
      independent_families: finiteNumber(item.independent_families) || 0,
      verification_state: cleanText(item.verification_state, "REPORTED").toUpperCase(),
      official_confirmation: item.official_confirmation === true,
      direct_evidence: item.direct_evidence === true,
      dispute_status: cleanText(item.dispute_status, "NOT_DISPUTED").toUpperCase(),
      source_classes: asArray(item.source_classes).map((value) => cleanText(value).replace(/_/g, " ")).filter(Boolean),
    };
  });
  const reportAssets = Array.isArray(content.high_value_assets?.selected_for_report)
    ? content.high_value_assets.selected_for_report
    : content.high_value_assets?.all_qualified;
  const allAssets = asArray(reportAssets).map((asset) => normalizeAsset(asset, captures));
  const scope = asObject(snapshotData.scope);
  const windowStart = cleanText(snapshot.window_start || snapshotData.window?.start);
  const windowEnd = cleanText(snapshot.window_end || snapshotData.window?.end);
  return {
    render_version: REPORT_HTML_RENDER_VERSION,
    report_id: cleanText(manifest.report_id || snapshot.snapshot_key),
    snapshot_key: cleanText(snapshot.snapshot_key || snapshotData.snapshot_key),
    snapshot_version: finiteNumber(snapshot.snapshot_version || snapshotData.snapshot_schema_version) || 1,
    report_date: cleanText(snapshot.snapshot_date || snapshotData.report_date),
    window: { start: windowStart, end: windowEnd, timezone: "UTC" },
    period: formatReportingPeriod(windowStart, windowEnd),
    scope: {
      type: cleanText(snapshot.scope_type || scope.type, "global"),
      key: cleanText(snapshot.scope_key || scope.key, "global"),
      value: cleanText(snapshot.scope_value || scope.value) || null,
      label: cleanText(snapshot.scope_label || scope.label, "Global Activity"),
    },
    executive_summary: buildExecutiveSummary(content, snapshotData),
    headline_stats: normalizeHeadlineStats(content, snapshotData),
    theaters: normalizeTheaters(content),
    key_judgments: normalizeJudgments(content),
    watch_indicators: normalizeWatchIndicators(content),
    developments,
    high_value_assets: allAssets,
    imagery: captures.filter((entry) => entry.status === READY_STATUS && entry.src),
    capture_results: captures,
    intelligence_wire: selectedWire,
    source_consensus: consensus,
    source_consensus_summary: {
      raw_report_count: finiteNumber(snapshotData.source_consensus?.raw_report_count) || 0,
      independent_source_family_count: finiteNumber(snapshotData.source_consensus?.independent_source_family_count) || 0,
      official_confirmation_count: finiteNumber(snapshotData.source_consensus?.official_confirmation_count) || 0,
      direct_evidence_count: finiteNumber(snapshotData.source_consensus?.direct_evidence_count) || 0,
      disputed_count: finiteNumber(snapshotData.source_consensus?.disputed_count) || 0,
      verification_distribution: asObject(snapshotData.aggregates?.by_verification_state),
      source_class_distribution: asObject(snapshotData.aggregates?.by_source_class),
    },
    cross_domain_assessment: asArray(content.cross_domain_assessment).map((item) => ({
      id: cleanText(item?.id),
      related_domains: asArray(item?.related_domains).map((value) => cleanText(value)).filter(Boolean),
      temporal_relationship: cleanText(item?.temporal_relationship) || null,
      geographic_relationship: cleanText(item?.geographic_relationship) || null,
      confidence: cleanText(item?.confidence, "UNSPECIFIED"),
      assessment_note: cleanText(item?.assessment_note, "No causal relationship is inferred."),
    })),
    outlook: asArray(content.outlook).map((item) => ({
      id: cleanText(item?.id),
      theater: cleanText(item?.theater) || null,
      domain: cleanText(item?.domain) || null,
      assessment: cleanText(item?.assessment, "No supported outlook assessment was available."),
      confidence: cleanText(item?.confidence, "UNSPECIFIED"),
      time_horizon: cleanText(item?.time_horizon, "24-72H"),
      conditions_to_watch: asArray(item?.conditions_to_watch).map((value) => cleanText(value)).filter(Boolean),
    })),
    methodology: {
      ...asObject(content.methodology_metrics),
      report_item_total: finiteNumber(content.methodology_metrics?.report_item_total) || 0,
      operational_event_total: finiteNumber(content.methodology_metrics?.operational_event_total) || 0,
      broader_intelligence_total: finiteNumber(content.methodology_metrics?.broader_intelligence_total) || 0,
      independent_source_family_count: finiteNumber(content.methodology_metrics?.independent_source_family_count) || 0,
      qualified_hva_total: finiteNumber(content.methodology_metrics?.qualified_hva_total) || 0,
      selected_hva_total: finiteNumber(content.methodology_metrics?.selected_hva_total) || allAssets.length,
    },
  };
}

function renderCapsule(label, value, kind = "severity") {
  const className = kind === "confidence" ? confidenceClass(value) : severityClass(value);
  const prefix = cleanText(label) ? `${escapeHtml(label)}: ` : "";
  return `<span class="capsule-box ${kind}-${className}">${prefix}${escapeHtml(value)}</span>`;
}

function renderImage(image, alt, className = "report-image-block") {
  if (!image?.src) return "";
  return `<figure class="${className}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(alt)}"></figure>`;
}

function renderTheaters(theaters) {
  if (!theaters.length) return "";
  return theaters.map((theater) => `<div class="pagination-block pagination-card-unit pagination-card-unit--half report-theater-grid report-theater-grid--unit">${[theater].map((theater) => {
    const domains = theater.dominant_domains.map((item) => `${item.domain} (${item.count})`).join(", ") || "No dominant domain established";
    const latest = theater.latest_activity ? ` Latest selected activity: ${formatDateTime(theater.latest_activity)}.` : "";
    const summary = theater.briefing_summary || `Activity was led by ${domains}. Trend: ${theater.trend}.${latest}`;
    return `<article class="report-theater-card report-theater-card--${severityClass(theater.activity_level)}"><div class="report-theater-card__top"><div><small>ACTIVE THEATER</small><h2>${escapeHtml(theater.theater)}</h2></div>${renderCapsule("", theater.activity_level)}</div><p>${escapeHtml(summary)}</p><div class="report-theater-stats"><span><b>${formatNumber(theater.event_count)}</b> items</span><span><b>${formatNumber(theater.major_development_count)}</b> developments</span><span><b>${formatNumber(theater.major_cluster_count)}</b> clusters</span><span><b>${formatNumber(theater.qualified_hva_count)}</b> HVA</span></div></article>`;
  }).join("")}</div>`).join("");
}

function renderJudgmentsAndWatch(model) {
  const judgments = model.key_judgments.length ? model.key_judgments : [{ confidence: "UNAVAILABLE", judgment: "No evidence-backed key judgment met selection criteria for this period." }];
  const watch = model.watch_indicators.length ? model.watch_indicators : [{ confidence: "UNAVAILABLE", indicator: "No specific watch indicator met selection criteria for this period.", current_state: "No qualifying trigger was recorded.", watch_window: "24-72H" }];
  const blocks = [];
  const length = Math.max(judgments.length, watch.length);
  for (let index = 0; index < length; index += 1) {
    const judgment = judgments[index];
    if (judgment) blocks.push(`<div class="pagination-block pagination-card-unit pagination-card-unit--half"><article class="report-text-panel report-judgment-card"><small>KEY JUDGMENT ${String(index + 1).padStart(2, "0")}</small><div class="report-judgment">${renderCapsule("", judgment.confidence)}<p>${escapeHtml(judgment.judgment)}${judgment.evidence_summary ? ` <small>${escapeHtml(judgment.evidence_summary)}</small>` : ""}</p></div></article></div>`);
    const item = watch[index];
    if (item) blocks.push(`<div class="pagination-block pagination-card-unit pagination-card-unit--half"><article class="report-news-card report-watch-item"><small>WATCH INDICATOR ${String(index + 1).padStart(2, "0")}</small><div class="event-capsule-container">${renderCapsule("", item.confidence)}</div><h3>${escapeHtml(item.indicator)}</h3><p>${escapeHtml(item.current_state)}</p>${item.why_it_matters ? `<small>WHY IT MATTERS</small><p>${escapeHtml(item.why_it_matters)}</p>` : ""}<dl class="report-data-list report-data-list--compact"><div><dt>Window</dt><dd>${escapeHtml(item.watch_window)}</dd></div>${item.domain ? `<div><dt>Domain</dt><dd>${escapeHtml(item.domain.replace(/_/g, " "))}</dd></div>` : ""}${item.theater || item.location ? `<div><dt>Area</dt><dd>${escapeHtml(item.theater || item.location)}</dd></div>` : ""}</dl></article></div>`);
  }
  return `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>KEY JUDGMENTS &amp; WATCH INDICATORS</h1></div>${blocks.join("")}`;
}

function renderDevelopments(developments) {
  if (!developments.length) return `<div class="pagination-block"><article class="report-text-panel"><p>No major operational development met deterministic selection criteria for this period.</p></article></div>`;
  return developments.map((item, index) => {
    const locationDetail = [item.location_label, item.location_detail].filter(Boolean).join(" | ");
    const image = item.image ? `<div class="event-image"><img src="${escapeHtml(item.image.src)}" alt="Operational context for ${escapeHtml(item.title)}"></div>` : "";
    const sourceTags = item.source_families.length ? `<div class="report-source-tags">${item.source_families.map((source) => `<span>${escapeHtml(source)}</span>`).join("")}</div>` : "";
    const evidence = [
      `${item.raw_report_count} raw report${item.raw_report_count === 1 ? "" : "s"}`,
      `${item.independent_source_family_count} independent famil${item.independent_source_family_count === 1 ? "y" : "ies"}`,
      item.official_confirmation ? "official confirmation" : "no official confirmation recorded",
      item.direct_evidence ? "direct evidence recorded" : null,
      item.disputed ? "disputed" : null,
    ].filter(Boolean).join(" | ");
    const meta = [`Time: ${formatDateTime(item.occurred_at)}`, locationDetail ? `Location: ${locationDetail}` : null, `Domain: ${item.domain}`].filter(Boolean).join(" | ");
    const content = `<div class="event-content"><p class="event-meta">${escapeHtml(meta)}</p><div class="event-capsule-container">${renderCapsule("Severity", item.severity)}${renderCapsule("Confidence", item.confidence === null ? "unavailable" : `${item.confidence}%`, "confidence")}${renderCapsule("Verification", item.verification_state)}</div><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(evidence)}</small>${sourceTags}</div>`;
    const layout = image ? `<div class="event-grid">${image}${content}</div>` : content;
    const compact = !image && `${item.title} ${item.summary} ${evidence}`.length <= 520;
    return `<div class="pagination-block pagination-card-unit ${compact ? "pagination-card-unit--half" : "pagination-card-unit--full"}"><article class="event-card event-card--feature${compact ? " event-card--compact" : ""}"><h3 class="event-title">${index + 1}. ${escapeHtml(item.title)}</h3>${layout}</article></div>`;
  }).join("");
}

function renderAssetDetails(asset) {
  const rows = [];
  rows.push(["Type", [asset.type, asset.variant].filter(Boolean).join(" / ")]);
  rows.push(["Role", asset.role]);
  if (asset.latitude !== null && asset.longitude !== null) rows.push(["Coordinates", `${asset.latitude.toFixed(4)} / ${asset.longitude.toFixed(4)}`]);
  if (asset.altitude_ft !== null) rows.push(["Altitude", `${formatNumber(asset.altitude_ft)} ft`]);
  if (asset.speed_kts !== null) rows.push(["Speed", `${formatNumber(asset.speed_kts)} kt`]);
  if (asset.heading_deg !== null) rows.push(["Heading", `${formatNumber(asset.heading_deg)} deg`]);
  if (asset.squawk) rows.push(["Squawk", asset.squawk]);
  if (asset.operator) rows.push(["Operator", asset.operator]);
  if (asset.country) rows.push(["Country", asset.country]);
  if (asset.theater) rows.push(["Theater", asset.theater]);
  if (asset.first_observed) rows.push(["First observed", formatDateTime(asset.first_observed)]);
  if (asset.last_observed) rows.push(["Last observed", formatDateTime(asset.last_observed)]);
  if (asset.status) rows.push(["Status", asset.status]);
  return rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderHva(assets) {
  const heading = `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>HIGH-VALUE ASSET INTELLIGENCE</h1></div>`;
  const intro = `<div class="pagination-block"><p class="report-section-intro">Only assets meeting StratOps priority and operational-context criteria are included. Routine traffic is excluded.</p></div>`;
  if (!assets.length) return `${heading}${intro}<div class="pagination-block"><article class="report-text-panel"><p>No qualified high-value asset met the Phase 2 selection criteria for this reporting window.</p></article></div>`;
  return `${heading}${intro}${assets.map((asset) => `<div class="pagination-block pagination-card-unit pagination-card-unit--half report-hva-grid report-hva-grid--unit">${[asset].map((asset) => {
    const title = [[asset.name || asset.type, asset.callsign].filter(Boolean).join(" - "), asset.asset_id].find(Boolean);
    const image = asset.image ? renderImage(asset.image, `High-value asset ${title}`) : "";
    const reasons = asset.qualification_reasons.length ? `<div class="report-source-tags">${asset.qualification_reasons.slice(0, 5).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>` : "";
    return `<article class="report-hva-card${asset.track_type === "naval" ? " report-hva-card--naval" : ""}">${image}<div class="report-hva-card__body"><div class="event-capsule-container">${renderCapsule("Priority", asset.confidence === null ? "qualified" : `${asset.confidence}%`, "confidence")}${renderCapsule("Role", asset.role)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(asset.operational_significance)}</p><dl class="report-data-list report-data-list--compact">${renderAssetDetails(asset)}</dl>${reasons}</div></article>`;
  }).join("")}</div>`).join("")}`;
}

function imageCaption(image) {
  return cleanText(image.capture_type, "Operational context").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderOperationalImagery(model) {
  const hvaCaptureIds = new Set(model.high_value_assets.map((asset) => asset.image?.capture_id).filter(Boolean));
  const images = model.imagery.filter((image) => !hvaCaptureIds.has(image.capture_id)
    && !["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D"].includes(image.capture_type));
  if (!images.length) return "";
  const blocks = [];
  for (let index = 0; index < images.length; index += 1) {
    const group = images.slice(index, index + 1);
    blocks.push(`<div class="pagination-block"><div class="report-image-grid report-image-grid--feature report-image-grid--single">${group.map((image) => `<figure class="report-image-block"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(imageCaption(image))}"><figcaption>${escapeHtml(imageCaption(image))}</figcaption></figure>`).join("")}</div></div>`);
  }
  return `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>OPERATIONAL IMAGERY</h1></div>${blocks.join("")}`;
}

function renderSourceSynthesis(model) {
  const summary = model.source_consensus_summary;
  const verificationSummary = Object.entries(summary.verification_distribution).map(([state, count]) => `${state.replace(/_/g, " ")}: ${count}`).join(", ") || "not available";
  const sourceClassSummary = Object.entries(summary.source_class_distribution).map(([sourceClass, count]) => `${sourceClass.replace(/_/g, " ")}: ${count}`).join(", ") || "not available";
  const table = model.source_consensus.length
    ? chunk(model.source_consensus.slice(0, 10), 6).map((group) => `<div class="pagination-block"><div class="report-consensus-table"><div class="report-consensus-table__head"><span>Development</span><span>Reports</span><span>Families</span><span>State</span></div>${group.map((item) => `<div><span>${escapeHtml(item.title)}</span><span>${formatNumber(item.raw_reports)}</span><span>${formatNumber(item.independent_families)}</span><span>${escapeHtml(item.dispute_status === "DISPUTED" ? "DISPUTED" : item.verification_state)}</span></div>`).join("")}</div></div>`).join("")
    : "";
  const wire = model.intelligence_wire.length
    ? model.intelligence_wire.map((item) => `<div class="pagination-block pagination-card-unit ${`${item.title} ${item.summary}`.length > 500 ? "pagination-card-unit--full" : "pagination-card-unit--half"} report-wire-list report-wire-list--unit"><article><span class="report-source-mark">${escapeHtml(item.source_class)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(item.source_name)} | ${escapeHtml(item.verification_state)}</small></article></div>`).join("")
    : `<div class="pagination-block"><article class="report-text-panel"><p>No broader intelligence item met selection criteria for this period.</p></article></div>`;
  const metrics = `<div class="pagination-block"><article class="report-text-panel"><p>${formatNumber(summary.raw_report_count)} raw reports were grouped into ${formatNumber(summary.independent_source_family_count)} independent source families. ${formatNumber(summary.official_confirmation_count)} items recorded official confirmation; ${formatNumber(summary.direct_evidence_count)} recorded direct evidence; ${formatNumber(summary.disputed_count)} were disputed. Verification states: ${escapeHtml(verificationSummary)}. Source-class mix: ${escapeHtml(sourceClassSummary)}.</p></article></div>`;
  return `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>INTELLIGENCE WIRE &amp; SOURCE SYNTHESIS</h1></div>${metrics}${table}${wire}`;
}

function renderCrossDomain(model) {
  if (!model.cross_domain_assessment.length) return "";
  return `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>CROSS-DOMAIN ASSESSMENT</h1></div>${chunk(model.cross_domain_assessment, 3).map((group) => `<div class="pagination-block"><div class="report-card-grid report-card-grid--3 domain-compact">${group.map((item) => `<article class="report-domain-card"><span class="report-domain-icon">${escapeHtml(item.related_domains.map((domain) => domain[0]).join("+").slice(0, 3) || "X")}</span><h3>${escapeHtml(item.related_domains.map((domain) => domain.replace(/_/g, " ")).join(" + ") || "MIXED")}</h3><strong>${escapeHtml(item.confidence)}</strong><p>${escapeHtml([item.assessment_note, item.geographic_relationship, item.temporal_relationship].filter(Boolean).join(" "))}</p></article>`).join("")}</div></div>`).join("")}`;
}

function renderOutlook(model) {
  if (!model.outlook.length) return "";
  return `<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>24-72 HOUR INTELLIGENCE OUTLOOK</h1></div>${model.outlook.map((item) => `<div class="pagination-block"><article class="report-forecast-card report-forecast-card--${severityClass(item.confidence)}"><small>${escapeHtml(item.time_horizon)}</small><strong>${escapeHtml(item.confidence)}</strong><h3>${escapeHtml([item.theater, item.domain].filter(Boolean).join(" / ") || "MULTI-DOMAIN")}</h3><p>${escapeHtml(item.assessment)}</p>${item.conditions_to_watch.length ? `<div class="report-source-tags">${item.conditions_to_watch.map((condition) => `<span>${escapeHtml(condition)}</span>`).join("")}</div>` : ""}</article></div>`).join("")}`;
}

function renderMethodology(model) {
  const methodology = model.methodology;
  const precision = Object.entries(asObject(methodology.location_precision_distribution)).map(([key, value]) => `${key}: ${value}`).join(", ") || "not available";
  const verification = Object.entries(asObject(methodology.verification_distribution)).map(([key, value]) => `${key}: ${value}`).join(", ") || "not available";
  return `<div class="pagination-block"><article class="report-text-panel"><h2>SOURCE METHODOLOGY</h2><p>StratOps considered ${formatNumber(methodology.report_item_total)} report items: ${formatNumber(methodology.operational_event_total)} operational incidents and ${formatNumber(methodology.broader_intelligence_total)} broader intelligence items, grouped into ${formatNumber(methodology.independent_source_family_count)} independent source families. Raw report counts remain separate from independent corroboration. Location precision was preserved without fabricating point coordinates. Distribution: ${escapeHtml(precision)}. Verification states: ${escapeHtml(verification)}. Reporting window: ${escapeHtml(model.period)} UTC.</p></article></div>`;
}

function renderReportSource(model) {
  const overview = model.imagery.find((image) => ["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D"].includes(image.capture_type));
  const overviewBlock = overview ? `<div class="pagination-block"><figure class="report-image-block report-image-block--wide report-image-block--feature"><img src="${escapeHtml(overview.src)}" alt="StratOps operational overview"><figcaption>Operational picture generated for this reporting window.</figcaption></figure></div>` : "";
  return `<div class="pagination-block report-page-intro"><h1>EXECUTIVE INTELLIGENCE SUMMARY</h1><p>${escapeHtml(model.executive_summary)}</p></div>
<div class="pagination-block"><div class="report-card-grid report-card-grid--6 compact-stats">${model.headline_stats.map((stat) => `<article class="report-stat-card report-stat-card--${severityClass(stat.state)}"><small>${escapeHtml(stat.label)}</small><strong>${escapeHtml(stat.value)}</strong><p>${escapeHtml(stat.supporting_text)}</p></article>`).join("")}</div></div>
${renderTheaters(model.theaters)}${overviewBlock}${renderJudgmentsAndWatch(model)}
<div class="pagination-block pagination-heading" data-keep-with-next="true"><h1>TOP INTELLIGENCE DEVELOPMENTS</h1></div>${renderDevelopments(model.developments)}
${renderHva(model.high_value_assets)}${renderOperationalImagery(model)}${renderSourceSynthesis(model)}${renderCrossDomain(model)}${renderOutlook(model)}${renderMethodology(model)}
<div class="pagination-block disclaimer-section"><h2>SOURCES AND DISCLAIMER</h2><p>Generated from publicly available and open-source information for situational awareness and analytical reference only. Not an official warning system, classified intelligence product or emergency instruction service. Events may remain unverified, disputed or incomplete.</p></div>`;
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Report template contract missing: ${label}`);
  return source.replace(pattern, replacement);
}

function renderReportHtml({ templateHtml, templateCss, model } = {}) {
  let html = String(templateHtml || "");
  const css = String(templateCss || "").replace(/\.\.\/\.\.\/assets\//g, "/assets/");
  if (!html || !css) throw new Error("Report template HTML and CSS are required");
  html = html.replace(/\.\.\/\.\.\/assets\//g, "/assets/");
  html = replaceRequired(html, /<title>[\s\S]*?<\/title>/, `<title>StratOps Operational Intelligence Report - ${escapeHtml(model.report_date)}</title>`, "document title");
  html = replaceRequired(html, /<link href="\.\/reports\.css" rel="stylesheet">/, `<style data-report-template-css>\n${css}\n</style>`, "stylesheet link");
  html = replaceRequired(html, /<body[^>]*>/, `<body data-report-template="stratops-operational-intelligence" data-report-image-base="images" data-report-render-version="${escapeHtml(model.render_version)}">`, "body");
  html = replaceRequired(html, /(<span class="date-strip__text">)[\s\S]*?(<\/span>)/, `$1\n              ${escapeHtml(model.period)}\n            $2`, "cover period");
  const source = `<div class="report-source" data-period="${escapeHtml(model.period)}" data-scope="${escapeHtml(model.scope.label.toUpperCase())}" id="report-source">\n${renderReportSource(model)}\n    </div>`;
  html = replaceRequired(html, /    <div class="report-source"[\s\S]*?\n  <\/main>/, `    ${source}\n  </main>`, "report source");
  return html;
}

export {
  REPORT_HTML_RENDER_VERSION,
  buildReportRenderModel,
  escapeHtml,
  formatReportingPeriod,
  renderReportHtml,
};
