import { runStatusFeedFetch } from "./status-feed-runner.js";

const result = await runStatusFeedFetch();

console.log("");
console.log("Fetched filtered status items:", result.total_items);
console.log("Fetched raw item count:", result.fetched_item_count);
console.log("Failed source count:", result.failed_source_count);

console.table(
  (result.items || []).slice(0, 12).map((item) => ({
    source: item.source_name,
    category: item.category,
    severity: item.severity,
    score: item.confidence_score,
    country: item.country || "",
    title: String(item.title || "").slice(0, 90)
  }))
);
