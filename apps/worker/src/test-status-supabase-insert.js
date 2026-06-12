import { runStatusFeedSync } from "./status-feed-runner.js";

const result = await runStatusFeedSync();

console.log("");
console.log("Supabase write complete");
console.log("Successful:", result.ok);
console.log("Fetched raw items:", result.fetched_item_count);
console.log("Filtered status items:", result.filtered_item_count);
console.log("Marked irrelevant:", result.marked_irrelevant_count);
console.log("Inserted / updated:", result.inserted_count);

if (result.error || result.cleanup?.error || result.write?.error) {
  console.log("Error:", result.error || result.cleanup?.error || result.write?.error);
}

console.table(
  (result.write?.items || []).slice(0, 10).map((item) => ({
    source: item.source_name,
    category: item.category,
    severity: item.severity,
    score: item.confidence_score,
    title: String(item.title || "").slice(0, 80)
  }))
);
