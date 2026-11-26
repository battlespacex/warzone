import { safeDate } from "./intelligence-normalizer.js";

export function compactConflictPayload(row = {}) {
  const raw = { ...row.raw };
  // Remove only byte-identical duplicates of retained columns. Never trim unique article evidence.
  for (const key of ["title", "summary", "published_at", "source_name", "source_id", "source_type", "source_category"]) {
    if (raw[key] != null && raw[key] === row[key]) delete raw[key];
  }
  return { ...row, raw };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function sameConflictPayload(previous, incoming) {
  const read = (row) => Object.fromEntries(Object.keys(incoming).filter((key) => key !== "fetched_at")
    .map((key) => [key, key === "published_at" ? safeDate(row[key]) : row[key] ?? null]));
  return JSON.stringify(stable(read(compactConflictPayload(previous)))) === JSON.stringify(stable(read(incoming)));
}
