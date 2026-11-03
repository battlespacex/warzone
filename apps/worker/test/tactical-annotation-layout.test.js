import test from "node:test";
import assert from "node:assert/strict";
import { layoutTacticalAnnotations } from "../../../dev/assets/js/warzone-tactical-annotations.js";

const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test("missile callouts keep priority, avoid overlap, and remain inside the viewport", () => {
  const items = [
    { id: "origin", x: 300, y: 240, width: 150, height: 48, priority: 2 },
    { id: "impact", x: 305, y: 245, width: 170, height: 70, priority: 1 },
    { id: "offscreen", x: 3, y: 3, width: 590, height: 470, priority: 0 },
  ];
  const placed = layoutTacticalAnnotations(items, 600, 480);
  assert.ok(placed.get("origin"));
  assert.ok(placed.get("impact"));
  assert.equal(intersects(placed.get("origin"), placed.get("impact")), false);
  assert.equal(placed.get("offscreen"), null);
  const next = layoutTacticalAnnotations(items.map(item => ({ ...item, slot: placed.get(item.id)?.slot })), 600, 480);
  assert.equal(next.get("origin").slot, placed.get("origin").slot);
  assert.equal(next.get("impact").slot, placed.get("impact").slot);
});

