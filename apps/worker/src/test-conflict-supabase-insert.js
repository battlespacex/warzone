// apps/worker/src/test-conflict-supabase-insert.js

import { runConflictFeedFetch } from "./conflict-feed-runner.js";
import { upsertConflictFeedItems } from "./conflict-supabase-writer.js";

const result = await runConflictFeedFetch({
  includeReliefWeb: false
});

console.log("");
console.log("Fetched filtered conflict items:", result.total_items);

const writeResult = await upsertConflictFeedItems(result.items);

console.log("");
console.log("Supabase write complete");
console.log("Successful:", writeResult.ok);
console.log("Inserted / updated:", writeResult.inserted_count);

if (writeResult.error) {
  console.log("Error:", writeResult.error);
}

console.table(
  (writeResult.items || []).slice(0, 10).map(item => ({
    source: item.source_name,
    category: item.category,
    score: item.confidence_score,
    title: item.title.slice(0, 80)
  }))
);