import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
const start = source.indexOf("function getEventLodEntities(");
assert.ok(start >= 0);
const end = source.indexOf("\n}", start) + 2;

test("event LOD reads only indexed event entities despite 10,000 unrelated tracks", () => {
    const ids = new Set(Array.from({ length: 100 }, (_, i) => `event-${i}`));
    const entities = new Map(Array.from({ length: 10_000 }, (_, i) => [`track-${i}`, { id: `track-${i}` }]));
    for (const id of ids) entities.set(id, { id });
    let lookups = 0;
    const viewer = { entities: {
        getById(id) { lookups++; return entities.get(id); },
        get values() { throw new Error("full-scene scan"); },
    } };
    const context = vm.createContext({ __eventEntityIds: ids });
    vm.runInContext(source.slice(start, end), context);
    const result = context.getEventLodEntities(viewer);
    assert.equal(result.length, 100);
    assert.equal(lookups, 100);
    assert.ok(result.every((entity) => ids.has(entity.id)));
    entities.delete("event-0");
    assert.equal(context.getEventLodEntities(viewer).length, 99);
    assert.match(source.slice(source.indexOf("function applyEventLod("), source.indexOf("function attachEventLodController(")), /const entities = getEventLodEntities\(viewer\)/);
});
