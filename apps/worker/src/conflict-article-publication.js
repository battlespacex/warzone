// Extract publication evidence, never page modification or relative "hours ago" times.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parseAbsolutePublicationDate(value = "") {
  const text = String(value || "").trim();
  // Require an explicit zone for timestamps. Date-only values are not exact times.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(text)) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function extractMiddleEastEyePublication(html = "") {
  const match = String(html).match(/<span\b[^>]*class=["'][^"']*\bdate-created\b[^"']*["'][^>]*>([^<]+)<\/span>/i);
  const text = match?.[1]?.replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim() || "";
  const parts = text.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? (GMT|UTC)$/);
  if (!parts) return null;
  const [, day, monthName, year, hour, minute, second = "00"] = parts;
  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== month || date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) return null;
  return { value: date.toISOString(), source: "mee.date-created", source_text: text, kind: "publication" };
}

// Read a single existing field, including nested divs, without pulling in navigation text.
export function extractDivContentByClass(html = "", className = "") {
  const tags = /<div\b[^>]*>|<\/div\s*>/gi;
  let start = null;
  let depth = 0;
  for (const match of String(html).matchAll(tags)) {
    if (start === null) {
      const classes = match[0].match(/\bclass=["']([^"']*)["']/i)?.[1]?.split(/\s+/) || [];
      if (classes.includes(className)) { start = match.index + match[0].length; depth = 1; }
    } else {
      depth += /^<\/div/i.test(match[0]) ? -1 : 1;
      if (!depth) return String(html).slice(start, match.index);
    }
  }
  return "";
}
