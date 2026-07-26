import test from "node:test";
import assert from "node:assert/strict";
import { areAwsCredentialsUsable, resolveAwsCredentials } from "../src/copernicus-storage.js";

test("resolves static AWS credentials without metadata lookup", async () => {
  const config = {
    aws: {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      sessionToken: "session-token",
    },
  };

  const credentials = await resolveAwsCredentials(config);
  assert.equal(credentials.accessKeyId, "AKIA_TEST");
  assert.equal(credentials.secretAccessKey, "secret");
  assert.equal(credentials.sessionToken, "session-token");
  assert.equal(credentials.source, "static_env");
  assert.equal(areAwsCredentialsUsable(credentials), true);
});
