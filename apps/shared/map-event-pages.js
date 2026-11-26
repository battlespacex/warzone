// Page size is a transport bound, never a bound on retained map intelligence.
export async function collectMapEventPages(firstPage, fetchPage) {
  const byId = new Map();
  let page = firstPage;
  let previousOffset = -1;
  for (;;) {
    for (const row of page.events || []) byId.set(row.id, row);
    if (!page.meta?.has_more) return [...byId.values()];
    const offset = Number(page.meta.next_offset);
    if (!Number.isInteger(offset) || offset <= previousOffset) throw new Error("Invalid map event pagination");
    previousOffset = offset;
    page = await fetchPage(offset);
  }
}
