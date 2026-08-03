import zlib from "zlib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const TOP_Y = 736;
const LINE_HEIGHT = 13;
const WRAP_WIDE = 74;
const WRAP_META = 78;
const MAX_EMBED_IMAGE_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function escapePdfText(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0000-\u001f]/g, " ");
}

function decodeHtmlEntities(value = "") {
  let current = String(value || "");
  for (let index = 0; index < 3; index += 1) {
    const decoded = current
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function getMojibakeScore(value = "") {
  const text = String(value || "");
  const matches = text.match(/(?:\uFFFD|ï¿½|Ã.|Â.|â[\u0080-\u00bf]?|[\u0080-\u009f])/g);
  return matches ? matches.length : 0;
}

function repairMojibake(value = "") {
  let text = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    const currentScore = getMojibakeScore(text);
    if (!currentScore) break;
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (!repaired || getMojibakeScore(repaired) >= currentScore) break;
    text = repaired;
  }
  return text;
}

function removeCorruptTextFragments(value = "") {
  return repairMojibake(value)
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€\u009d/g, "\"")
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/ï¿½|\uFFFD/g, " ")
    .replace(/\b[ÃÂâ][^\s|,.;:)]+/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

function cleanReportText(value = "", fallback = "") {
  const text = removeCorruptTextFragments(decodeHtmlEntities(String(value || "")))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\bimg\b/gi, " ")
    .replace(/\b(?:width|height|alt|src|srcset|class|style|loading|fetchpriority|decoding|sizes|about|rel|target|id|href)=["'][^"']*["']/gi, " ")
    .replace(/\b(?:width|height|alt|src|srcset|class|style|loading|fetchpriority|decoding|sizes|about|rel|target|id|href)=\S+/gi, " ")
    .replace(/\battachment-[a-z0-9_-]+\b/gi, " ")
    .replace(/\bwp-[a-z0-9_-]+\b/gi, " ")
    .replace(/\bfloat(?:left|right)\b/gi, " ")
    .replace(/\(\s*max-width:[^)]+\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function wrapText(value = "", maxChars = 88) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current.length + 1 + word.length) <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function normalizeDateLabel(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toISOString().slice(0, 10);
}

function bufferText(value = "") {
  return Buffer.from(String(value || ""), "utf8");
}

function formatSatelliteMetaValue(value, fallback = "Unknown") {
  const cleaned = cleanReportText(value, "");
  return cleaned || fallback;
}

function formatSatelliteMetric(value, suffix = "", fallback = "Unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${numeric}${suffix}`;
}

function buildReportLines(report = {}) {
  const body = report.body || report.report_body || {};
  const overview = body.operational_overview || {};
  const scope = report.scope_label || body.scope?.label || "Global";
  const period = body.reporting_period || {};
  const periodStart = period.start || period.startIso || report.period_start || "";
  const periodEnd = period.end || period.endIso || report.period_end || "";
  const summary = body.executive_summary || report.generated_summary || "No summary available.";
  const lines = [];

  lines.push({ text: "STRATOPS", size: 28, gap: 10 });
  lines.push({ text: `${String(report.report_type || "daily").toUpperCase()} OPERATIONAL INTELLIGENCE REPORT`, size: 16, gap: 6 });
  lines.push({ text: `Reporting Area: ${scope}`, size: 11 });
  lines.push({ text: `UTC Period: ${normalizeDateLabel(periodStart)} to ${normalizeDateLabel(periodEnd)}`, size: 11 });
  lines.push({ text: "Powered by BattlespaceX", size: 10, gap: 18 });

  lines.push({ text: "EXECUTIVE SUMMARY", size: 14, gap: 6 });
  wrapText(cleanReportText(summary, "No summary available."), WRAP_WIDE).forEach((text) => lines.push({ text, size: 10 }));
  lines.push({ text: "", size: 10, gap: 8 });

  lines.push({ text: "OPERATIONAL OVERVIEW", size: 14, gap: 6 });
  [
    ["Total Events", overview.event_total],
    ["Critical Events", overview.critical_events],
    ["High Severity Events", overview.high_events],
    ["Military Aircraft", overview.aircraft_total],
    ["Naval Assets", overview.naval_total],
    ["Airspace Restrictions", overview.airspace_total],
    ["Cyber Events", overview.cyber_total],
    ["GNSS Events", overview.gnss_total],
    ["Satellite Observation Records", overview.satellite_total],
    ["Escalation Index", overview.escalation_score],
  ].forEach(([label, value]) => lines.push({ text: `${label}: ${formatNumber(value)}`, size: 10 }));
  lines.push({ text: "", size: 10, gap: 8 });

  lines.push({ text: "MAJOR EVENTS", size: 14, gap: 6 });
  const majorEvents = Array.isArray(body.major_events) ? body.major_events : [];
  if (!majorEvents.length) {
    lines.push({ text: "No major events were available for this reporting period.", size: 10 });
  }
  majorEvents.slice(0, 12).forEach((event, index) => {
    lines.push({ text: `${index + 1}. ${cleanReportText(event.title, "Activity report")}`, size: 11 });
    wrapText([
      `Time: ${event.occurred_at || ""}`,
      `Location: ${cleanReportText(event.location_label, "Unknown")}`,
      `Category: ${cleanReportText(event.category, "unknown")}`,
      `Severity: ${cleanReportText(event.severity, "unknown")}`,
      `Confidence: ${event.confidence ?? 0}%`,
      `Sources: ${event.source_count ?? 1}`,
    ].join(" | "), WRAP_META).forEach((text) => lines.push({ text, size: 9 }));
    wrapText(cleanReportText(event.summary || "", ""), WRAP_WIDE).slice(0, 4).forEach((text) => lines.push({ text, size: 9 }));
    lines.push({ text: "", size: 9, gap: 4 });
  });

  const domainSummaries = body.domain_summaries || {};
  lines.push({ text: "DOMAIN SUMMARIES", size: 14, gap: 6 });
  Object.entries(domainSummaries).forEach(([domain, text]) => {
    lines.push({ text: String(domain).toUpperCase(), size: 11 });
    wrapText(cleanReportText(text || "No notable activity.", "No notable activity."), WRAP_WIDE).forEach((line) => lines.push({ text: line, size: 9 }));
  });
  lines.push({ text: "", size: 10, gap: 8 });

  const satellite = body.satellite_intelligence || {};
  lines.push({ text: "SATELLITE INTELLIGENCE", size: 14, gap: 6 });
  wrapText(cleanReportText(satellite.summary || "No satellite observation records were available for this report.", "No satellite observation records were available for this report."), WRAP_WIDE)
    .forEach((text) => lines.push({ text, size: 10 }));

  lines.push({ text: "", size: 10, gap: 8 });
  lines.push({ text: "SOURCES AND DISCLAIMER", size: 14, gap: 6 });
  wrapText("This report is generated from publicly available and open-source information. It is intended for situational awareness and analytical reference only. It is not an official warning system, classified intelligence product or emergency instruction service. Events may remain unverified, disputed or incomplete.", 88)
    .forEach((text) => lines.push({ text, size: 9 }));

  return lines;
}

function buildSatellitePageLines(report = {}) {
  const satellite = report?.body?.satellite_intelligence || report?.report_body?.satellite_intelligence || {};
  const rows = [
    { text: "SATELLITE PREVIEW", size: 18, gap: 10, y: 736 },
    { text: `Provider: ${formatSatelliteMetaValue(satellite.provider, "Copernicus")}`, size: 10, y: 706 },
    { text: `Collection: ${formatSatelliteMetaValue(satellite.collection, "Unknown")}`, size: 10, y: 692 },
    { text: `Acquisition: ${formatSatelliteMetaValue(satellite.acquisition_time, "Unknown")}`, size: 10, y: 678 },
    { text: `Resolution: ${formatSatelliteMetric(satellite.resolution_meters, " m")}`, size: 10, y: 664 },
    { text: `Cloud Cover: ${formatSatelliteMetric(satellite.cloud_cover, "%")}`, size: 10, y: 650 },
  ];
  const summary = wrapText(
    cleanReportText(
      satellite.summary || "Latest available Copernicus contextual preview included for analytical reference.",
      "Latest available Copernicus contextual preview included for analytical reference."
    ),
    WRAP_WIDE
  ).slice(0, 3);
  let y = 146;
  summary.forEach((text) => {
    rows.push({ text, size: 9, y });
    y -= 13;
  });
  rows.push({
    text: "Contextual satellite imagery is not live feed data and does not independently confirm damage, attribution or battle outcome.",
    size: 8,
    y: 92,
  });
  return rows;
}

function createPages(lines) {
  const pages = [];
  let page = [];
  let y = TOP_Y;
  for (const item of lines) {
    const gap = Number(item.gap || 0);
    const size = Number(item.size || 10);
    if (y < 64) {
      pages.push(page);
      page = [];
      y = TOP_Y;
    }
    page.push({ ...item, y });
    y -= Math.max(LINE_HEIGHT, size + 4) + gap;
  }
  if (page.length) pages.push(page);
  return pages;
}

function objectBlock(id, body) {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function getLineColor(line = {}) {
  const text = String(line.text || "").trim();
  const size = Number(line.size || 10);
  if (!text) return "0.90 0.94 0.98";
  if (size >= 14) return "0.16 0.96 0.90";
  if (size >= 11) return "0.98 0.99 1";
  return "0.72 0.78 0.86";
}

function getLineFont(line = {}) {
  const size = Number(line.size || 10);
  return size >= 11 ? "/F2" : "/F1";
}

function buildPageChromeCommands() {
  return [
    "q",
    "0.012 0.027 0.047 rg",
    `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`,
    "0.035 0.070 0.115 rg",
    `0 ${PAGE_HEIGHT - 86} ${PAGE_WIDTH} 86 re f`,
    "0.16 0.96 0.90 RG",
    "1.2 w",
    `${MARGIN_X} ${PAGE_HEIGHT - 94} m ${PAGE_WIDTH - MARGIN_X} ${PAGE_HEIGHT - 94} l S`,
    "0.20 0.32 0.46 RG",
    "0.6 w",
    `${MARGIN_X} 54 m ${PAGE_WIDTH - MARGIN_X} 54 l S`,
    "0.16 0.96 0.90 rg",
    `${PAGE_WIDTH - MARGIN_X - 52} ${PAGE_HEIGHT - 62} 52 6 re f`,
    "Q",
  ];
}

function buildTextCommands(pageLines, pageNumber, pageCount) {
  const commands = [];
  commands.push("BT");
  pageLines.forEach((line) => {
    const size = Number(line.size || 10);
    commands.push(`${getLineColor(line)} rg`);
    commands.push(`${getLineFont(line)} ${size} Tf`);
    commands.push(`${MARGIN_X} ${Number(line.y || TOP_Y)} Td`);
    commands.push(`(${escapePdfText(line.text || "")}) Tj`);
    commands.push(`${-MARGIN_X} ${-Number(line.y || TOP_Y)} Td`);
  });
  commands.push("0.62 0.68 0.76 rg");
  commands.push("/F1 8 Tf");
  commands.push(`${MARGIN_X} 32 Td`);
  commands.push(`(StratOps Operational Briefings | Page ${pageNumber} of ${pageCount}) Tj`);
  commands.push("ET");
  return commands;
}

function buildContentStream(pageLines, pageNumber, pageCount) {
  return [
    ...buildPageChromeCommands(),
    ...buildTextCommands(pageLines, pageNumber, pageCount),
  ].join("\n");
}

function readPngChunk(buffer, offset) {
  const length = buffer.readUInt32BE(offset);
  const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
  const start = offset + 8;
  const end = start + length;
  return {
    length,
    type,
    data: buffer.subarray(start, end),
    nextOffset: end + 4,
  };
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function unfilterPngScanlines(inflated, width, height, bytesPerPixel) {
  const rowSize = width * bytesPerPixel;
  const expectedLength = (rowSize + 1) * height;
  if (inflated.length < expectedLength) {
    throw new Error("PNG scanline payload is truncated");
  }
  const output = Buffer.alloc(rowSize * height);
  let inputOffset = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filterType = inflated[inputOffset];
    inputOffset += 1;
    const rowStart = rowIndex * rowSize;
    switch (filterType) {
      case 0:
        inflated.copy(output, rowStart, inputOffset, inputOffset + rowSize);
        break;
      case 1:
        for (let column = 0; column < rowSize; column += 1) {
          const left = column >= bytesPerPixel ? output[rowStart + column - bytesPerPixel] : 0;
          output[rowStart + column] = (inflated[inputOffset + column] + left) & 0xff;
        }
        break;
      case 2:
        for (let column = 0; column < rowSize; column += 1) {
          const up = rowIndex > 0 ? output[rowStart - rowSize + column] : 0;
          output[rowStart + column] = (inflated[inputOffset + column] + up) & 0xff;
        }
        break;
      case 3:
        for (let column = 0; column < rowSize; column += 1) {
          const left = column >= bytesPerPixel ? output[rowStart + column - bytesPerPixel] : 0;
          const up = rowIndex > 0 ? output[rowStart - rowSize + column] : 0;
          output[rowStart + column] = (inflated[inputOffset + column] + Math.floor((left + up) / 2)) & 0xff;
        }
        break;
      case 4:
        for (let column = 0; column < rowSize; column += 1) {
          const left = column >= bytesPerPixel ? output[rowStart + column - bytesPerPixel] : 0;
          const up = rowIndex > 0 ? output[rowStart - rowSize + column] : 0;
          const upLeft = rowIndex > 0 && column >= bytesPerPixel ? output[rowStart - rowSize + column - bytesPerPixel] : 0;
          output[rowStart + column] = (inflated[inputOffset + column] + paethPredictor(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`Unsupported PNG filter type ${filterType}`);
    }
    inputOffset += rowSize;
  }
  return output;
}

function buildPngImageAsset(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 48 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  const idatChunks = [];
  while (offset + 12 <= buffer.length) {
    const chunk = readPngChunk(buffer, offset);
    offset = chunk.nextOffset;
    if (chunk.type === "IHDR") {
      width = chunk.data.readUInt32BE(0);
      height = chunk.data.readUInt32BE(4);
      bitDepth = chunk.data[8];
      colorType = chunk.data[9];
      interlaceMethod = chunk.data[12];
    } else if (chunk.type === "IDAT") {
      idatChunks.push(chunk.data);
    } else if (chunk.type === "IEND") {
      break;
    }
  }
  if (!width || !height || !idatChunks.length) return null;
  if (bitDepth !== 8 || interlaceMethod !== 0) return null;

  const channelMap = new Map([
    [0, { channels: 1, colorSpace: "/DeviceGray", alpha: false }],
    [2, { channels: 3, colorSpace: "/DeviceRGB", alpha: false }],
    [4, { channels: 2, colorSpace: "/DeviceGray", alpha: true }],
    [6, { channels: 4, colorSpace: "/DeviceRGB", alpha: true }],
  ]);
  const mode = channelMap.get(colorType);
  if (!mode) return null;

  const bytesPerPixel = mode.channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const unfiltered = unfilterPngScanlines(inflated, width, height, bytesPerPixel);

  let imageBytes = unfiltered;
  let alphaBytes = null;
  if (mode.alpha) {
    const pixelCount = width * height;
    const hasRgb = mode.channels === 4;
    imageBytes = Buffer.alloc(pixelCount * (hasRgb ? 3 : 1));
    alphaBytes = Buffer.alloc(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
      if (hasRgb) {
        const sourceOffset = index * 4;
        const targetOffset = index * 3;
        imageBytes[targetOffset] = unfiltered[sourceOffset];
        imageBytes[targetOffset + 1] = unfiltered[sourceOffset + 1];
        imageBytes[targetOffset + 2] = unfiltered[sourceOffset + 2];
        alphaBytes[index] = unfiltered[sourceOffset + 3];
      } else {
        const sourceOffset = index * 2;
        imageBytes[index] = unfiltered[sourceOffset];
        alphaBytes[index] = unfiltered[sourceOffset + 1];
      }
    }
  }

  return {
    width,
    height,
    colorSpace: mode.colorSpace,
    bitsPerComponent: 8,
    filter: "/FlateDecode",
    data: zlib.deflateSync(imageBytes),
    smaskData: alphaBytes ? zlib.deflateSync(alphaBytes) : null,
  };
}

function buildJpegImageAsset(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    );
    if (isStartOfFrame) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      const components = buffer[offset + 7];
      if (!width || !height) return null;
      return {
        width,
        height,
        colorSpace: components === 1 ? "/DeviceGray" : "/DeviceRGB",
        bitsPerComponent: 8,
        filter: "/DCTDecode",
        data: buffer,
        smaskData: null,
      };
    }
    offset += segmentLength;
  }
  return null;
}

async function fetchSatelliteImageAsset(report = {}) {
  const satellite = report?.body?.satellite_intelligence || report?.report_body?.satellite_intelligence || {};
  const imageUrl = String(satellite.preview_image_url || "").trim();
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  try {
    const response = await fetch(imageUrl, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout?.(12000),
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length || buffer.length > MAX_EMBED_IMAGE_BYTES) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const imageAsset = contentType.includes("png")
      ? buildPngImageAsset(buffer)
      : (contentType.includes("jpeg") || contentType.includes("jpg")
          ? buildJpegImageAsset(buffer)
          : (buildPngImageAsset(buffer) || buildJpegImageAsset(buffer)));
    return imageAsset || null;
  } catch {
    return null;
  }
}

function buildObjectBuffer(id, body) {
  return Buffer.concat([
    bufferText(`${id} 0 obj\n`),
    Buffer.isBuffer(body) ? body : bufferText(body),
    bufferText("\nendobj\n"),
  ]);
}

function buildStreamObjectBuffer(id, header, streamBuffer) {
  return Buffer.concat([
    bufferText(`${id} 0 obj\n${header}\nstream\n`),
    streamBuffer,
    bufferText("\nendstream\nendobj\n"),
  ]);
}

function buildImageObjectBuffer(id, image, smaskObjectId = null) {
  const parts = [
    "<< /Type /XObject /Subtype /Image",
    `/Width ${image.width}`,
    `/Height ${image.height}`,
    `/ColorSpace ${image.colorSpace}`,
    `/BitsPerComponent ${image.bitsPerComponent}`,
    `/Filter ${image.filter}`,
    `/Length ${image.data.length}`,
  ];
  if (smaskObjectId) parts.push(`/SMask ${smaskObjectId} 0 R`);
  return buildStreamObjectBuffer(id, `${parts.join(" ")} >>`, image.data);
}

function buildSatelliteImagePageContent(image, pageNumber, pageCount, report = {}) {
  const maxWidth = PAGE_WIDTH - (MARGIN_X * 2);
  const maxHeight = 440;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const drawX = Math.round((PAGE_WIDTH - drawWidth) / 2);
  const drawY = 180;
  const imageCommands = [
    "q",
    "0.16 0.96 0.90 RG",
    "1 w",
    `${drawX - 6} ${drawY - 6} ${drawWidth + 12} ${drawHeight + 12} re S`,
    `${drawWidth} 0 0 ${drawHeight} ${drawX} ${drawY} cm`,
    "/Im1 Do",
    "Q"
  ];
  return bufferText([
    ...buildPageChromeCommands(),
    ...imageCommands,
    ...buildTextCommands(buildSatellitePageLines(report), pageNumber, pageCount),
  ].join("\n"));
}

async function createReportPdfBuffer(report = {}) {
  const lines = buildReportLines(report);
  const pages = createPages(lines).map((pageLines) => ({ type: "text", pageLines }));
  const satelliteImage = await fetchSatelliteImageAsset(report);
  if (satelliteImage) pages.push({ type: "satellite", image: satelliteImage });

  const objects = [];
  let nextObjectId = 5;
  const pageIds = [];
  const imagePageSpecs = [];

  pages.forEach((page) => {
    const pageId = nextObjectId;
    nextObjectId += 1;
    const contentId = nextObjectId;
    nextObjectId += 1;
    let imageId = null;
    let smaskId = null;
    if (page.type === "satellite") {
      imageId = nextObjectId;
      nextObjectId += 1;
      if (page.image?.smaskData) {
        smaskId = nextObjectId;
        nextObjectId += 1;
      }
    }
    pageIds.push(pageId);
    imagePageSpecs.push({ ...page, pageId, contentId, imageId, smaskId });
  });

  objects.push(buildObjectBuffer(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(buildObjectBuffer(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`));
  objects.push(buildObjectBuffer(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  objects.push(buildObjectBuffer(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"));

  imagePageSpecs.forEach((page, index) => {
    if (page.type === "satellite") {
      const contentBuffer = buildSatelliteImagePageContent(page.image, index + 1, imagePageSpecs.length, report);
      objects.push(buildObjectBuffer(
        page.pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 ${page.imageId} 0 R >> >> /Contents ${page.contentId} 0 R >>`
      ));
      objects.push(buildStreamObjectBuffer(page.contentId, `<< /Length ${contentBuffer.length} >>`, contentBuffer));
      objects.push(buildImageObjectBuffer(page.imageId, page.image, page.smaskId));
      if (page.smaskId) {
        objects.push(buildImageObjectBuffer(page.smaskId, {
          width: page.image.width,
          height: page.image.height,
          colorSpace: "/DeviceGray",
          bitsPerComponent: 8,
          filter: "/FlateDecode",
          data: page.image.smaskData,
        }));
      }
      return;
    }

    const content = buildContentStream(page.pageLines, index + 1, imagePageSpecs.length);
    objects.push(buildObjectBuffer(
      page.pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${page.contentId} 0 R >>`
    ));
    objects.push(buildStreamObjectBuffer(page.contentId, `<< /Length ${Buffer.byteLength(content, "utf8")} >>`, bufferText(content)));
  });

  const header = bufferText("%PDF-1.4\n");
  const offsets = [0];
  let totalLength = header.length;
  objects.forEach((object) => {
    offsets.push(totalLength);
    totalLength += object.length;
  });
  const xrefOffset = totalLength;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (let i = 1; i <= objects.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat([header, ...objects, bufferText(xrefLines.join(""))]);
}

export {
  createReportPdfBuffer,
  normalizeDateLabel,
};
