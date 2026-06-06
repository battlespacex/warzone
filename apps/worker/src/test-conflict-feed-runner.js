// Fetch-only local smoke test for the StratOps conflict RSS pipeline.
// Does not write to Supabase.

import { runConflictFeedFetch } from "./conflict-feed-runner.js";

const result = await runConflictFeedFetch({
  includeReliefWeb: false
});

console.log("");
console.log("Conflict feed smoke test complete");
console.log("RSS sources:", result.rss.source_count);
console.log("RSS failed sources:", result.rss.failed_count);
console.log("Fetched items:", result.fetched_item_count);
console.log("Filtered items:", result.filtered_item_count);

console.table(
  result.items.slice(0, 10).map(item => ({
    source: item.source_name,
    category: item.category,
    score: item.confidence_score,
    title: item.title.slice(0, 80)
  }))
);
