// Development entry-array ordering puts this before index.js's static imports.
// This measures dependency execution, not browser download or full script parsing.
if (!performance.getEntriesByName("stratops-entry-evaluation-start", "mark").length) {
    performance.mark("stratops-entry-evaluation-start");
}
