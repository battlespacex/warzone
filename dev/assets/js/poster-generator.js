import "../css/root.css";

// =====================================================
// POSTER CURATED FONT CONFIGURATION
// Edit only these lists to control the Title and Description font dropdowns.
// =====================================================
const POSTER_FONTS = Object.freeze({
  title: Object.freeze([
    { label: "BattlespaceX Heading", family: "PosterBattlespaceXHeading", url: "/assets/fonts/custom/bx-heading.woff2" },
    { label: "Blinker ExtraBold", family: "PosterBlinkerExtraBold", url: "/assets/fonts/Blinker/Blinker-ExtraBold.ttf" },
    { label: "Chakra Petch Bold", family: "PosterChakraPetchBold", url: "/assets/fonts/Chakra_Petch/ChakraPetch-Bold.ttf" }
  ]),
  description: Object.freeze([
    { label: "BattlespaceX Heading", family: "PosterBattlespaceXHeading", url: "/assets/fonts/custom/bx-heading.woff2" },
    { label: "Blinker ExtraBold", family: "PosterBlinkerExtraBold", url: "/assets/fonts/Blinker/Blinker-ExtraBold.ttf" },
    { label: "Chakra Petch Bold", family: "PosterChakraPetchBold", url: "/assets/fonts/Chakra_Petch/ChakraPetch-Bold.ttf" }
  ])
});

// =====================================================
// POSTER FIXED IMAGE CREDIT CONFIGURATION
// Credit typography is developer-controlled; users edit only text and width.
// =====================================================
const POSTER_CREDIT_STYLE = Object.freeze({
  fontFamily: "PosterChakraPetchBold",
  fontUrl: "/assets/fonts/Chakra_Petch/ChakraPetch-Bold.ttf",
  fontSize: 22,
  color: "#ffffff",
  textAlign: "left",
  lineHeight: 110,
  letterSpacing: 0,
  uppercase: false,
  shadow: true,
  stroke: false
});

// =====================================================
// POSTER FIXED OVERLAY CONFIGURATION
// x/y are offsets from the centered asset. width/height and scale are fixed.
// Add future Overlay 2 / 3 / 4 entries here; the dropdown is generated from it.
// =====================================================
const POSTER_OVERLAYS = Object.freeze({
  none: Object.freeze({ label: "None", asset: null, x: 0, y: 0, width: null, height: null, scale: 1 }),
  "tactical-grid": Object.freeze({
    label: "Tactical grid",
    asset: "/assets/images/poster/tactical-grid.png",
    x: 0,
    y: 0,
    width: 1080,
    height: 1350,
    scale: 1
  }),
  scanlines: Object.freeze({
    label: "Scanlines",
    asset: "/assets/images/poster/scanlines.png",
    x: 0,
    y: 0,
    width: 1080,
    height: 1350,
    scale: 1
  }),
  "corner-frame": Object.freeze({
    label: "Corner frame",
    asset: "/assets/images/poster/corner-frame.png",
    x: 0,
    y: 0,
    width: 1080,
    height: 1350,
    scale: 1
  })
});

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("posterCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  const assets = {
    logos: {
      battlespacex: "/assets/images/poster/battlespacex-logo.png",
      stratops: "/assets/images/poster/stratops-logo.png"
    },
    qr: {
      battlespacex: "/assets/images/poster/battlespacex-qr.png",
      stratops: "/assets/images/poster/stratops-qr.png"
    }
  };

  const images = {
    background: null,
    logo: null,
    qr: null,
    overlay: null
  };

  let draggingBackground = false;
  let draggingText = false;
  let selectedText = null;
  let isExporting = false;
  let fontsReadyPromise = Promise.resolve();
  let brandAssetsReadyPromise = Promise.resolve();
  let overlayReadyPromise = Promise.resolve();
  let dragStart = { x: 0, y: 0, imageX: 0, imageY: 0, textX: 0, textY: 0 };
  let renderQueued = false;
  const textBounds = { title: null, description: null, credit: null };
  const SAFE_AREA = { left: 55, right: 1025, top: 215, bottom: 1295 };

  const POSTER_SIZES = {
    feed: { width: 1080, height: 1350, label: "1080 × 1350", name: "Instagram Portrait" },
    reel: { width: 1080, height: 1920, label: "1080 × 1920", name: "Instagram Reel / Story" }
  };

  const fontStack = (family) => `"${family}", sans-serif`;
  const defaultFontValue = (target) => fontStack(POSTER_FONTS[target][0].family);

  function refreshSafeArea() {
    SAFE_AREA.left = 55;
    SAFE_AREA.right = canvas.width - 55;
    SAFE_AREA.top = 215;
    SAFE_AREA.bottom = canvas.height - 55;
  }

  function applyPosterSize(sizeKey, scaleExistingPositions = true) {
    const preset = POSTER_SIZES[sizeKey] || POSTER_SIZES.feed;
    const oldHeight = canvas.height || preset.height;
    const ratio = preset.height / oldHeight;

    canvas.width = preset.width;
    canvas.height = preset.height;

    if (scaleExistingPositions && oldHeight !== preset.height) {
      state.titleY = Number(state.titleY) * ratio;
      state.descriptionY = Number(state.descriptionY) * ratio;
      state.creditY = Number(state.creditY) * ratio;
    }

    refreshSafeArea();

    state.qrY = canvas.height - state.qrSize - 75;
    state.websiteX = canvas.width - 65;
    state.websiteY = canvas.height - 55;

    const readout = $("canvasSizeReadout");
    if (readout) readout.textContent = preset.label;
    const headerLabel = $("headerSizeLabel");
    if (headerLabel) headerLabel.textContent = `${preset.label} social poster`;

    clampTextBlock("title");
    clampTextBlock("description");
    clampTextBlock("credit");
    updateImageAxisControls();
    requestRender();
  }

  const state = {
    posterSize: "feed",
    brandPreset: "",
    logo: "battlespacex",
    logoPosition: "left",
    website: "www.battlespacex.com",
    qr: "battlespacex",
    enableDescription: false,
    enableCredit: false,
    showGuides: true,

    backgroundDataUrl: "",
    fitMode: "cover",
    imageZoom: 100,
    imageX: 0,
    imageY: 0,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    darkOverlay: 15,

    overlay: "none",
    overlayOpacity: 40,

    titleText: "KUWAIT UNVEILS\nNEEDLEFISH NAVAL DRONES\nTO BOLSTER MARITIME\nSECURITY",
    titleFont: defaultFontValue("title"),
    titleSize: 92,
    titleLineHeight: 92,
    titleSpacing: 1,
    titleWidth: 900,
    titleX: 540,
    titleY: 760,
    titleAlign: "center",
    titleColor: "#ffffff",
    titleUppercase: true,

    descriptionText: "KUWAIT UNVEILS NEEDLEFISH NAVAL DRONES TO BOLSTER MARITIME SECURITY",
    descriptionFont: defaultFontValue("description"),
    descriptionSize: 48,
    descriptionLineHeight: 96,
    descriptionSpacing: 0,
    descriptionWidth: 520,
    descriptionX: 770,
    descriptionY: 990,
    descriptionAlign: "center",
    descriptionColor: "#ffffff",
    descriptionUppercase: true,

    creditText: "Credit: USAF",
    creditWidth: 420,
    creditX: 75,
    creditY: 1085,

    logoSize: 230,
    logoX: 70,
    logoY: 60,
    qrSize: 130,
    qrX: 70,
    qrY: 1145,
    websiteSize: 26,
    websiteX: 1015,
    websiteY: 1295,
    websiteAlign: "right",

    exportFormat: "png",
    jpgQuality: 95
  };

  const initialState = JSON.parse(JSON.stringify(state));

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function initializeFontOptions() {
    ["title", "description"].forEach((target) => {
      const select = $(`${target}Font`);
      select.replaceChildren();
      POSTER_FONTS[target].forEach((font) => {
        const option = document.createElement("option");
        option.value = fontStack(font.family);
        option.textContent = font.label;
        select.appendChild(option);
      });
    });
  }

  function initializeOverlayOptions() {
    const select = $("overlaySelect");
    select.replaceChildren();
    Object.entries(POSTER_OVERLAYS).forEach(([value, overlay]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = overlay.label;
      select.appendChild(option);
    });
  }

  function normalizeFontValue(target, value) {
    const allowed = POSTER_FONTS[target].map((font) => fontStack(font.family));
    return allowed.includes(value) ? value : allowed[0];
  }

  async function loadConfiguredFonts() {
    const status = $("fontLibraryStatus");
    const fonts = new Map();
    [...POSTER_FONTS.title, ...POSTER_FONTS.description].forEach((font) => {
      fonts.set(font.family, font);
    });
    if (!fonts.has(POSTER_CREDIT_STYLE.fontFamily)) {
      fonts.set(POSTER_CREDIT_STYLE.fontFamily, {
        label: "Image Credit",
        family: POSTER_CREDIT_STYLE.fontFamily,
        url: POSTER_CREDIT_STYLE.fontUrl
      });
    }

    if (!fonts.size) {
      if (status) status.textContent = "No approved poster fonts are configured.";
      return;
    }

    let loadedCount = 0;
    const failed = [];

    for (const item of fonts.values()) {
      try {
        const face = new FontFace(item.family, `url("${item.url}")`);
        await face.load();
        document.fonts.add(face);
        loadedCount++;
      } catch (error) {
        failed.push(item.label);
        console.error(`Could not load font "${item.label}" from ${item.url}`, error);
      }
    }

    if (!status) return;

    if (failed.length) {
      status.classList.add("has-error");
      status.textContent =
        `${loadedCount} approved font(s) loaded. Could not load: ${failed.join(", ")}. ` +
        `Check the exact URL, filename capitalization and font CORS settings.`;
    } else {
      status.classList.remove("has-error");
      status.textContent = `${loadedCount} approved poster font(s) loaded.`;
    }

    requestRender();
  }

  async function loadBrandAssets() {
    try {
      images.logo = state.logo === "none" ? null : await loadImage(assets.logos[state.logo]);
      images.qr = state.qr === "none" ? null : await loadImage(assets.qr[state.qr]);
    } catch (error) {
      console.warn("Could not load a built-in asset:", error);
    }
    requestRender();
  }

  async function loadOverlayAsset() {
    const overlay = POSTER_OVERLAYS[state.overlay] || POSTER_OVERLAYS.none;
    state.overlay = POSTER_OVERLAYS[state.overlay] ? state.overlay : "none";
    if (!overlay.asset) {
      images.overlay = null;
      requestRender();
      return;
    }
    try {
      images.overlay = await loadImage(overlay.asset);
    } catch (error) {
      console.warn("Could not load overlay:", error);
      images.overlay = null;
    }
    requestRender();
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function getImageLayout(img, zoomPercent, fitMode) {
    const cw = canvas.width;
    const ch = canvas.height;
    const baseScale = fitMode === "contain"
      ? Math.min(cw / img.width, ch / img.height)
      : Math.max(cw / img.width, ch / img.height);
    const scale = baseScale * (zoomPercent / 100);
    return {
      w: img.width * scale,
      h: img.height * scale
    };
  }

  function getBackgroundPositionBounds() {
    if (!images.background) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, allowX: false, allowY: false };
    }
    const layout = getImageLayout(images.background, Number(state.imageZoom), state.fitMode);
    const overflowX = Math.max(0, layout.w - canvas.width);
    const overflowY = Math.max(0, layout.h - canvas.height);
    const minX = Math.ceil(-overflowX / 2);
    const maxX = Math.floor(overflowX / 2);
    const minY = Math.ceil(-overflowY / 2);
    const maxY = Math.floor(overflowY / 2);
    return {
      minX,
      maxX,
      minY,
      maxY,
      allowX: minX < maxX,
      allowY: minY < maxY
    };
  }

  function clampBackgroundPosition(nextX = state.imageX, nextY = state.imageY) {
    const bounds = getBackgroundPositionBounds();
    const xControl = $("imageX");
    const yControl = $("imageY");

    state.imageX = Math.max(bounds.minX, Math.min(bounds.maxX, Number(nextX) || 0));
    state.imageY = Math.max(bounds.minY, Math.min(bounds.maxY, Number(nextY) || 0));

    xControl.min = String(bounds.minX);
    xControl.max = String(bounds.maxX);
    yControl.min = String(bounds.minY);
    yControl.max = String(bounds.maxY);
    xControl.value = String(state.imageX);
    yControl.value = String(state.imageY);
    xControl.disabled = !bounds.allowX;
    yControl.disabled = !bounds.allowY;
    xControl.closest("label")?.classList.toggle("control-disabled", !bounds.allowX);
    yControl.closest("label")?.classList.toggle("control-disabled", !bounds.allowY);
    updateOutputs();
    return bounds;
  }

  function updateImageAxisControls() {
    return clampBackgroundPosition();
  }

  function drawCoverImage(img, offsetX, offsetY, zoomPercent, fitMode) {
    const layout = getImageLayout(img, zoomPercent, fitMode);
    const x = (canvas.width - layout.w) / 2 + offsetX;
    const y = (canvas.height - layout.h) / 2 + offsetY;
    ctx.drawImage(img, x, y, layout.w, layout.h);
  }

  function splitWordsPreserveNewlines(text) {
    const paragraphs = String(text).replace(/\r/g, "").split("\n");
    return paragraphs.map(p => p.trim().split(/\s+/).filter(Boolean));
  }

  function measureSpacedText(text, spacing) {
    if (!text) return 0;
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      width += ctx.measureText(text[i]).width;
      if (i < text.length - 1) width += spacing;
    }
    return width;
  }

  function wrapText(text, maxWidth, spacing) {
    const paragraphs = splitWordsPreserveNewlines(text);
    const lines = [];
    paragraphs.forEach((words, paragraphIndex) => {
      if (!words.length) {
        lines.push("");
        return;
      }
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = current + " " + words[i];
        if (measureSpacedText(test, spacing) <= maxWidth) {
          current = test;
        } else {
          lines.push(current);
          current = words[i];
        }
      }
      lines.push(current);
      if (paragraphIndex < paragraphs.length - 1 && !words.length) lines.push("");
    });
    return lines;
  }

  function drawSpacedLine(text, x, y, spacing, align, fill, stroke) {
    const width = measureSpacedText(text, spacing);
    let startX = x;
    if (align === "center") startX -= width / 2;
    if (align === "right") startX -= width;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (stroke) ctx.strokeText(char, startX, y);
      if (fill) ctx.fillText(char, startX, y);
      startX += ctx.measureText(char).width + spacing;
    }
  }

  function getTextStyle(prefix) {
    if (prefix === "credit") {
      return {
        fontValue: fontStack(POSTER_CREDIT_STYLE.fontFamily),
        size: POSTER_CREDIT_STYLE.fontSize,
        lineHeight: POSTER_CREDIT_STYLE.lineHeight,
        spacing: POSTER_CREDIT_STYLE.letterSpacing,
        align: POSTER_CREDIT_STYLE.textAlign,
        color: POSTER_CREDIT_STYLE.color,
        uppercase: POSTER_CREDIT_STYLE.uppercase,
        shadow: POSTER_CREDIT_STYLE.shadow,
        stroke: POSTER_CREDIT_STYLE.stroke
      };
    }

    return {
      fontValue: state[prefix + "Font"],
      size: Number(state[prefix + "Size"]),
      lineHeight: Number(state[prefix + "LineHeight"]),
      spacing: Number(state[prefix + "Spacing"]),
      align: state[prefix + "Align"],
      color: state[prefix + "Color"],
      uppercase: Boolean(state[prefix + "Uppercase"]),
      shadow: false,
      stroke: false
    };
  }

  function getTextBlockMetrics(prefix) {
    const style = getTextStyle(prefix);
    let text = state[prefix + "Text"] || "";
    if (style.uppercase) text = text.toUpperCase();

    const fontValue = style.fontValue;
    const size = style.size;
    const lineHeight = size * (style.lineHeight / 100);
    const spacing = style.spacing;
    const maxSafeWidth = SAFE_AREA.right - SAFE_AREA.left;
    const width = Math.min(Number(state[prefix + "Width"]), maxSafeWidth);
    const x = Number(state[prefix + "X"]);
    const y = Number(state[prefix + "Y"]);
    const align = style.align;

    ctx.save();
    ctx.font = `900 ${size}px ${fontValue}`;
    const lines = wrapText(text, width, spacing);
    const measuredWidths = lines.map(line => measureSpacedText(line, spacing));
    const actualWidth = Math.max(1, ...measuredWidths);
    const height = Math.max(size, lines.length * lineHeight);

    let left = x;
    if (align === "center") left = x - actualWidth / 2;
    if (align === "right") left = x - actualWidth;

    ctx.restore();
    return {
      text, fontValue, size, lineHeight, spacing, width, x, y, align,
      color: style.color, shadow: style.shadow, stroke: style.stroke,
      lines, measuredWidths, actualWidth, height,
      left, right: left + actualWidth, top: y, bottom: y + height
    };
  }

  function clampTextBlock(prefix) {
    if (prefix === "description" && !state.enableDescription) return;
    if (prefix === "credit" && !state.enableCredit) return;
    let metrics = getTextBlockMetrics(prefix);
    let x = Number(state[prefix + "X"]);
    let y = Number(state[prefix + "Y"]);

    if (metrics.left < SAFE_AREA.left) x += SAFE_AREA.left - metrics.left;
    if (metrics.right > SAFE_AREA.right) x -= metrics.right - SAFE_AREA.right;
    if (metrics.top < SAFE_AREA.top) y = SAFE_AREA.top;
    if (metrics.bottom > SAFE_AREA.bottom) y -= metrics.bottom - SAFE_AREA.bottom;

    state[prefix + "X"] = Math.round(x);
    state[prefix + "Y"] = Math.round(y);
    const xInput = $(prefix + "X");
    const yInput = $(prefix + "Y");
    if (xInput) xInput.value = state[prefix + "X"];
    if (yInput) yInput.value = state[prefix + "Y"];
    updateOutputs();
  }

  function drawTextSelection(prefix, metrics) {
    if (isExporting || selectedText !== prefix) return;
    const pad = 12;
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#20d9df";
    ctx.fillStyle = "rgba(32,217,223,.08)";
    ctx.fillRect(metrics.left - pad, metrics.top - pad, metrics.actualWidth + pad * 2, metrics.height + pad * 2);
    ctx.strokeRect(metrics.left - pad, metrics.top - pad, metrics.actualWidth + pad * 2, metrics.height + pad * 2);
    ctx.setLineDash([]);
    const handle = 10;
    const points = [
      [metrics.left - pad, metrics.top - pad],
      [metrics.right + pad, metrics.top - pad],
      [metrics.left - pad, metrics.bottom + pad],
      [metrics.right + pad, metrics.bottom + pad]
    ];
    points.forEach(([px, py]) => ctx.fillRect(px - handle / 2, py - handle / 2, handle, handle));
    ctx.restore();
  }

  function drawTextBlock(prefix) {
    clampTextBlock(prefix);
    const metrics = getTextBlockMetrics(prefix);
    textBounds[prefix] = metrics;

    ctx.save();
    ctx.beginPath();
    ctx.rect(SAFE_AREA.left, SAFE_AREA.top, SAFE_AREA.right - SAFE_AREA.left, SAFE_AREA.bottom - SAFE_AREA.top);
    ctx.clip();

    ctx.font = `900 ${metrics.size}px ${metrics.fontValue}`;
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.fillStyle = metrics.color;

    if (metrics.shadow) {
      ctx.shadowColor = "rgba(0,0,0,.75)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetX = 7;
      ctx.shadowOffsetY = 8;
    }

    if (metrics.stroke) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(2, metrics.size * 0.045);
    }

    metrics.lines.forEach((line, index) => {
      drawSpacedLine(
        line,
        metrics.x,
        metrics.y + index * metrics.lineHeight,
        metrics.spacing,
        metrics.align,
        true,
        metrics.stroke
      );
    });
    ctx.restore();
    drawTextSelection(prefix, metrics);
  }

  function pointInsideText(prefix, x, y) {
    const b = textBounds[prefix];
    if (!b) return false;
    const pad = 18;
    return x >= b.left - pad && x <= b.right + pad &&
           y >= b.top - pad && y <= b.bottom + pad;
  }

  function drawLogo() {
    if (!images.logo) return;
    const maxW = Number(state.logoSize);
    const ratio = images.logo.height / images.logo.width;
    const x = state.logoPosition === "center"
      ? (canvas.width - maxW) / 2
      : Number(state.logoX);
    ctx.drawImage(images.logo, x, Number(state.logoY), maxW, maxW * ratio);
  }

  function drawQR() {
    if (!images.qr || state.qr === "none") return;
    const s = Number(state.qrSize);
    ctx.drawImage(images.qr, Number(state.qrX), Number(state.qrY), s, s);
  }

  function drawWebsite() {

    ctx.save();
    ctx.font = `900 ${Number(state.websiteSize)}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = state.websiteAlign;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    ctx.fillText(state.website.toUpperCase(), Number(state.websiteX), Number(state.websiteY));
    ctx.restore();
  }

  function drawGuides() {
    if (!state.showGuides) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,255,.78)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.strokeRect(
      SAFE_AREA.left,
      SAFE_AREA.top,
      SAFE_AREA.right - SAFE_AREA.left,
      SAFE_AREA.bottom - SAFE_AREA.top
    );
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, SAFE_AREA.top);
    ctx.lineTo(canvas.width / 2, SAFE_AREA.bottom);
    ctx.moveTo(SAFE_AREA.left, (SAFE_AREA.top + SAFE_AREA.bottom) / 2);
    ctx.lineTo(SAFE_AREA.right, (SAFE_AREA.top + SAFE_AREA.bottom) / 2);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (images.background) {
      ctx.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
      drawCoverImage(images.background, Number(state.imageX), Number(state.imageY), Number(state.imageZoom), state.fitMode);
      ctx.filter = "none";
    }

    if (Number(state.darkOverlay) > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Number(state.darkOverlay) / 100})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (images.overlay) {
      const overlay = POSTER_OVERLAYS[state.overlay] || POSTER_OVERLAYS.none;
      ctx.save();
      ctx.globalAlpha = Number(state.overlayOpacity) / 100;
      const scale = Number(overlay.scale) || 1;
      const w = (Number(overlay.width) || images.overlay.width) * scale;
      const h = (Number(overlay.height) || images.overlay.height) * scale;
      const x = (canvas.width - w) / 2 + (Number(overlay.x) || 0);
      const y = (canvas.height - h) / 2 + (Number(overlay.y) || 0);
      ctx.drawImage(images.overlay, x, y, w, h);
      ctx.restore();
    }

    drawLogo();
    drawTextBlock("title");
    if (state.enableDescription) drawTextBlock("description");
    if (state.enableCredit) drawTextBlock("credit");
    drawQR();
    drawWebsite();
    drawGuides();
    ctx.restore();
  }

  const fieldMap = {
    posterSizeSelect: ["posterSize", "value"],
    brandPresetSelect: ["brandPreset", "value"],
    logoSelect: ["logo", "value"],
    logoPositionSelect: ["logoPosition", "value"],
    qrSelect: ["qr", "value"],
    enableDescription: ["enableDescription", "checked"],
    enableCredit: ["enableCredit", "checked"],
    showGuides: ["showGuides", "checked"],
    fitMode: ["fitMode", "value"],
    imageZoom: ["imageZoom", "number"],
    imageX: ["imageX", "number"],
    imageY: ["imageY", "number"],
    brightness: ["brightness", "number"],
    contrast: ["contrast", "number"],
    saturation: ["saturation", "number"],
    darkOverlay: ["darkOverlay", "number"],
    overlaySelect: ["overlay", "value"],
    overlayOpacity: ["overlayOpacity", "number"],
    titleText: ["titleText", "value"],
    titleFont: ["titleFont", "value"],
    titleSize: ["titleSize", "number"],
    titleLineHeight: ["titleLineHeight", "number"],
    titleSpacing: ["titleSpacing", "number"],
    titleWidth: ["titleWidth", "number"],
    titleX: ["titleX", "number"],
    titleY: ["titleY", "number"],
    titleAlign: ["titleAlign", "value"],
    titleColor: ["titleColor", "value"],
    titleUppercase: ["titleUppercase", "checked"],
    descriptionText: ["descriptionText", "value"],
    descriptionFont: ["descriptionFont", "value"],
    descriptionSize: ["descriptionSize", "number"],
    descriptionLineHeight: ["descriptionLineHeight", "number"],
    descriptionSpacing: ["descriptionSpacing", "number"],
    descriptionWidth: ["descriptionWidth", "number"],
    descriptionX: ["descriptionX", "number"],
    descriptionY: ["descriptionY", "number"],
    descriptionAlign: ["descriptionAlign", "value"],
    descriptionColor: ["descriptionColor", "value"],
    descriptionUppercase: ["descriptionUppercase", "checked"],
    creditText: ["creditText", "value"],
    creditWidth: ["creditWidth", "number"],
    creditX: ["creditX", "number"],
    creditY: ["creditY", "number"],
    exportFormat: ["exportFormat", "value"],
    jpgQuality: ["jpgQuality", "number"]
  };

  const outputMap = {
    imageZoom: ["zoomValue", v => `${v}%`],
    imageX: ["imageXValue", String],
    imageY: ["imageYValue", String],
    brightness: ["brightnessValue", v => `${v}%`],
    contrast: ["contrastValue", v => `${v}%`],
    saturation: ["saturationValue", v => `${v}%`],
    darkOverlay: ["darkOverlayValue", v => `${v}%`],
    overlayOpacity: ["overlayOpacityValue", v => `${v}%`],
    titleSize: ["titleSizeValue", String],
    titleLineHeight: ["titleLineHeightValue", v => (v / 100).toFixed(2)],
    titleSpacing: ["titleSpacingValue", String],
    titleWidth: ["titleWidthValue", String],
    descriptionSize: ["descriptionSizeValue", String],
    descriptionLineHeight: ["descriptionLineHeightValue", v => (v / 100).toFixed(2)],
    descriptionSpacing: ["descriptionSpacingValue", String],
    descriptionWidth: ["descriptionWidthValue", String],
    creditWidth: ["creditWidthValue", String],
    jpgQuality: ["jpgQualityValue", v => `${v}%`]
  };

  function bindFields() {
    Object.entries(fieldMap).forEach(([id, [key, mode]]) => {
      const el = $(id);
      if (!el) return;
      const eventName = (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color") ? "change" : "input";
      el.addEventListener(eventName, async () => {
        state[key] = mode === "checked" ? el.checked : mode === "number" ? Number(el.value) : el.value;

        if (id === "posterSizeSelect") {
          applyPosterSize(state.posterSize, true);
        }
        if (id === "enableDescription" || id === "enableCredit") updateOptionalPanels();
        if (id === "brandPresetSelect") {
          if (state.brandPreset === "battlespacex") {
            state.logo = "battlespacex";
            state.qr = "battlespacex";
            state.website = "www.battlespacex.com";
          } else if (state.brandPreset === "stratops") {
            state.logo = "stratops";
            state.qr = "stratops";
            state.website = "www.stratops.battlespacex.com";
          }
          syncControls();
          brandAssetsReadyPromise = loadBrandAssets();
          await brandAssetsReadyPromise;
        }
        if (id === "logoSelect") {
          state.brandPreset = "";
          $("brandPresetSelect").value = "";
          brandAssetsReadyPromise = loadBrandAssets();
          await brandAssetsReadyPromise;
        }
        if (id === "qrSelect") {
          state.brandPreset = "";
          $("brandPresetSelect").value = "";
          brandAssetsReadyPromise = loadBrandAssets();
          await brandAssetsReadyPromise;
        }
        if (id === "overlaySelect") {
          overlayReadyPromise = loadOverlayAsset();
          await overlayReadyPromise;
        }
        if (id === "exportFormat") updateExportVisibility();
        if (["imageZoom", "fitMode", "imageX", "imageY"].includes(id)) {
          clampBackgroundPosition();
        }
        if (id.startsWith("title")) clampTextBlock("title");
        if (id.startsWith("description")) clampTextBlock("description");
        if (id.startsWith("credit")) clampTextBlock("credit");

        updateOutputs();
        requestRender();
      });
    });
  }

  $("websiteSelect").addEventListener("change", () => {
    state.brandPreset = "";
    $("brandPresetSelect").value = "";
    const value = $("websiteSelect").value;
    $("customWebsiteWrap").classList.toggle("hidden", value !== "custom");
    if (value !== "custom") {
      state.website = value;
      $("customWebsiteInput").value = value;
      requestRender();
    }
  });

  $("customWebsiteInput").addEventListener("input", () => {
    state.brandPreset = "";
    $("brandPresetSelect").value = "";
    state.website = $("customWebsiteInput").value;
    requestRender();
  });

  function autoFitBackground() {
    if (!images.background) return;

    // Cover the full poster using the image's natural aspect ratio.
    // One dimension fits exactly while the other overflows and remains movable.
    state.fitMode = "cover";
    state.imageZoom = 100;
    state.imageX = 0;
    state.imageY = 0;

    $("fitMode").value = "cover";
    $("imageZoom").value = 100;
    $("imageX").value = 0;
    $("imageY").value = 0;

    updateImageAxisControls();
    updateOutputs();
    requestRender();
  }

  $("autoFitBackgroundBtn").addEventListener("click", autoFitBackground);

  $("backgroundInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    state.backgroundDataUrl = dataUrl;
    images.background = await loadImage(dataUrl);
    autoFitBackground();
  });

  $("removeBackgroundBtn").addEventListener("click", () => {
    state.backgroundDataUrl = "";
    images.background = null;
    $("backgroundInput").value = "";
    updateImageAxisControls();
    requestRender();
  });

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateOptionalPanels() {
    $("descriptionPanel").classList.toggle("hidden", !state.enableDescription);
    $("creditPanel").classList.toggle("hidden", !state.enableCredit);
  }

  function updateExportVisibility() {
    $("jpgQualityWrap").classList.toggle("hidden", state.exportFormat !== "jpg");
  }

  function updateOutputs() {
    Object.entries(outputMap).forEach(([key, [id, formatter]]) => {
      const el = $(id);
      if (el) el.textContent = formatter(state[key]);
    });
  }

  function syncControls() {
    Object.entries(fieldMap).forEach(([id, [key, mode]]) => {
      const el = $(id);
      if (!el) return;
      if (mode === "checked") el.checked = Boolean(state[key]);
      else el.value = state[key];
    });

    const websiteOptions = [...$("websiteSelect").options].map(o => o.value);
    if (websiteOptions.includes(state.website)) {
      $("websiteSelect").value = state.website;
      $("customWebsiteWrap").classList.add("hidden");
    } else {
      $("websiteSelect").value = "custom";
      $("customWebsiteWrap").classList.remove("hidden");
      $("customWebsiteInput").value = state.website;
    }
    updateOptionalPanels();
    updateExportVisibility();
    updateOutputs();
  }

  function normalizeProjectState(loaded) {
    const normalized = JSON.parse(JSON.stringify(initialState));
    Object.keys(normalized).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(loaded, key)) {
        normalized[key] = loaded[key];
      }
    });

    normalized.posterSize = POSTER_SIZES[normalized.posterSize] ? normalized.posterSize : "feed";
    normalized.fitMode = ["cover", "contain"].includes(normalized.fitMode) ? normalized.fitMode : "cover";
    normalized.overlay = POSTER_OVERLAYS[normalized.overlay] ? normalized.overlay : "none";
    normalized.titleFont = normalizeFontValue("title", normalized.titleFont);
    normalized.descriptionFont = normalizeFontValue("description", normalized.descriptionFont);
    normalized.backgroundDataUrl = typeof normalized.backgroundDataUrl === "string"
      ? normalized.backgroundDataUrl
      : "";
    return normalized;
  }


  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
    const hitCredit = state.enableCredit && pointInsideText("credit", point.x, point.y);
    const hitDescription = state.enableDescription && pointInsideText("description", point.x, point.y);
    const hitTitle = pointInsideText("title", point.x, point.y);
    const hit = hitCredit ? "credit" : hitDescription ? "description" : hitTitle ? "title" : null;

    if (hit) {
      selectedText = hit;
      draggingText = true;
      draggingBackground = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging-text");
      dragStart = {
        x: point.x,
        y: point.y,
        textX: Number(state[hit + "X"]),
        textY: Number(state[hit + "Y"])
      };
      requestRender();
      return;
    }

    selectedText = null;
    requestRender();

    if (!images.background) return;
    const mode = updateImageAxisControls();
    if (!mode.allowX && !mode.allowY) return;

    draggingBackground = true;
    draggingText = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    dragStart = {
      x: point.x,
      y: point.y,
      imageX: Number(state.imageX),
      imageY: Number(state.imageY)
    };
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);

    if (draggingText && selectedText) {
      state[selectedText + "X"] = Math.round(dragStart.textX + point.x - dragStart.x);
      state[selectedText + "Y"] = Math.round(dragStart.textY + point.y - dragStart.y);
      clampTextBlock(selectedText);
      requestRender();
      return;
    }

    if (!draggingBackground) return;
    const bounds = getBackgroundPositionBounds();
    const nextX = bounds.allowX
      ? Math.round(dragStart.imageX + point.x - dragStart.x)
      : 0;
    const nextY = bounds.allowY
      ? Math.round(dragStart.imageY + point.y - dragStart.y)
      : 0;
    clampBackgroundPosition(nextX, nextY);
    requestRender();
  });

  function stopDragging(event) {
    draggingBackground = false;
    draggingText = false;
    canvas.classList.remove("dragging", "dragging-text");
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  }
  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);

  $("resetBtn").addEventListener("click", async () => {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, JSON.parse(JSON.stringify(initialState)));
    images.background = null;
    images.overlay = null;
    $("backgroundInput").value = "";
    syncControls();
    applyPosterSize(state.posterSize, false);
    brandAssetsReadyPromise = loadBrandAssets();
    overlayReadyPromise = loadOverlayAsset();
    await Promise.all([brandAssetsReadyPromise, overlayReadyPromise]);
    requestRender();
  });

  $("saveProjectBtn").addEventListener("click", async () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    await saveBlob(blob, makeFilename("json"), {
      description: "Poster project JSON",
      accept: { "application/json": [".json"] }
    });
  });

  $("loadProjectInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const loaded = JSON.parse(await file.text());
      const normalized = normalizeProjectState(loaded);
      Object.keys(state).forEach(key => delete state[key]);
      Object.assign(state, normalized);
      syncControls();
      applyPosterSize(state.posterSize, false);
      images.background = state.backgroundDataUrl ? await loadImage(state.backgroundDataUrl) : null;
      clampBackgroundPosition(normalized.imageX, normalized.imageY);
      brandAssetsReadyPromise = loadBrandAssets();
      overlayReadyPromise = loadOverlayAsset();
      await Promise.all([brandAssetsReadyPromise, overlayReadyPromise]);
      requestRender();
    } catch (error) {
      alert("Could not load this project file.");
      console.error(error);
    }
  });

  $("exportBtn").addEventListener("click", async () => {
    await Promise.all([fontsReadyPromise, brandAssetsReadyPromise, overlayReadyPromise]);
    isExporting = true;
    render();
    const isJpg = state.exportFormat === "jpg";
    const mime = isJpg ? "image/jpeg" : "image/png";
    const quality = isJpg ? Number(state.jpgQuality) / 100 : 1;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
    if (!blob) {
      alert("The poster could not be exported.");
      return;
    }
    await saveBlob(blob, makeFilename(state.exportFormat), {
      description: isJpg ? "JPEG image" : "PNG image",
      accept: isJpg ? { "image/jpeg": [".jpg", ".jpeg"] } : { "image/png": [".png"] }
    });
    isExporting = false;
    requestRender();
  });

  function makeFilename(extension) {
    const base = (state.titleText || state.logo || "poster")
      .split("\n")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "poster";
    return `${state.logo === "none" ? "poster" : state.logo}-${state.posterSize}-${base}.${extension}`;
  }

  async function saveBlob(blob, suggestedName, type) {
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [type]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Save picker failed; using browser download instead.", error);
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  initializeFontOptions();
  initializeOverlayOptions();
  bindFields();
  syncControls();
  updateOptionalPanels();
  applyPosterSize(state.posterSize, false);
  fontsReadyPromise = loadConfiguredFonts();
  brandAssetsReadyPromise = loadBrandAssets();
  overlayReadyPromise = loadOverlayAsset();
  updateImageAxisControls();
  render();
})();
