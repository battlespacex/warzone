// apps/worker/src/test-twz-feed.js

import { fetchSingleRssSource } from "./conflict-rss-fetcher.js";

const twzSource = {
  id: "twz-feed",
  name: "The War Zone",
  type: "rss",
  category: "defense-tech",
  url: "https://www.twz.com/feed"
};

const result = await fetchSingleRssSource(twzSource);

console.log("");
console.log("TWZ feed test complete");
console.log("Successful:", result.ok);
console.log("Filtered items:", result.count);

if (result.error) {
  console.log("Error:", result.error);
}

console.table(
  result.items.slice(0, 15).map(item => ({
    source: item.source_name,
    category: item.category,
    score: item.confidence_score,
    title: item.title.slice(0, 100)
  }))
);