import test from "node:test";
import assert from "node:assert/strict";
import { __stratopsRouteTestUtils } from "../src/routes.stratops.js";

function requestWithAuthorization(value = "") {
  return {
    get(name) {
      return String(name).toLowerCase() === "authorization" ? value : "";
    },
  };
}

test("internal report capture authorization requires an exact bearer token", () => {
  const expected = "capture-secret-123";
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(`Bearer ${expected}`), expected), true);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization("Bearer wrong"), expected), false);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(""), expected), false);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(`Bearer ${expected}`), ""), false);
});
