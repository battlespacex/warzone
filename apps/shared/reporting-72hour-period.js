const PERIOD_MS = 72 * 60 * 60 * 1000;
const DEFAULT_ANCHOR = "2026-01-01T00:00:00.000Z";

function parseAnchor(value = DEFAULT_ANCHOR) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value || !value.endsWith("T00:00:00.000Z")) {
    throw new Error("REPORTING_72H_ANCHOR_UTC must be an exact UTC midnight ISO timestamp");
  }
  return timestamp;
}

function get72HourPeriod(referenceDate, anchor = DEFAULT_ANCHOR) {
  const now = new Date(referenceDate).getTime();
  if (!Number.isFinite(now)) throw new Error("Invalid reporting reference time");
  const anchorMs = parseAnchor(anchor);
  const index = Math.floor((now - anchorMs) / PERIOD_MS);
  const startIso = new Date(anchorMs + index * PERIOD_MS).toISOString();
  const endIso = new Date(anchorMs + (index + 1) * PERIOD_MS).toISOString();
  return { index, startIso, endIso, dateKey: startIso.slice(0, 10) };
}

function getClosed72HourPeriods({ now = new Date(), anchor = DEFAULT_ANCHOR, catchupStart, limit = 2, strictLimit = false } = {}) {
  const anchorMs = parseAnchor(anchor);
  const boundary = catchupStart ? Date.parse(catchupStart) : anchorMs;
  if (!Number.isFinite(boundary)) throw new Error("Invalid 72-hour catch-up boundary");
  const lastClosed = Math.floor((new Date(now).getTime() - anchorMs) / PERIOD_MS) - 1;
  const firstEligible = Math.max(0, Math.ceil((boundary - anchorMs) / PERIOD_MS));
  if (strictLimit && lastClosed - firstEligible + 1 > limit) {
    throw new Error(`72-hour catch-up exceeds the ${limit}-window scan bound; advance the configured boundary explicitly`);
  }
  const periods = [];
  for (let index = firstEligible; index <= lastClosed && periods.length < limit; index += 1) {
    const startIso = new Date(anchorMs + index * PERIOD_MS).toISOString();
    periods.push({ index, startIso, endIso: new Date(anchorMs + (index + 1) * PERIOD_MS).toISOString(), dateKey: startIso.slice(0, 10) });
  }
  return periods;
}

export { DEFAULT_ANCHOR, PERIOD_MS, get72HourPeriod, getClosed72HourPeriods, parseAnchor };
