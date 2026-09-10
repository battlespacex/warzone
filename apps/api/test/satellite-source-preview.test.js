import test from "node:test";
import assert from "node:assert/strict";
import { isSatelliteSourcePreviewUrl, resolveSatelliteSourcePreview } from "../../shared/satellite-source-preview.js";

const url = "https://catalogue.dataspace.copernicus.eu/odata/v1/Assets(2fb65e32-21ba-423b-ab39-959fe37e4c81)/$value";
test("satellite previews reject own buckets, credentials, tokens and spoofed hosts", () => {
  assert.equal(isSatelliteSourcePreviewUrl(url), true);
  for (const value of ["https://stratops.battlespacex.com/image.jpg", "https://bucket.s3.amazonaws.com/image.jpg", url + "?token=secret", url.replace(".eu/", ".eu.evil.test/"), url.replace("https://", "https://user:password@")]) {
    assert.equal(isSatelliteSourcePreviewUrl(value), false);
  }
});
test("legacy bucket rows resolve to source assets once without sending authentication", async () => {
  const row = { source_item_id: "S2_TEST_PREVIEW.SAFE", image_url: "https://bucket.s3.amazonaws.com/crop.png" };
  let calls = 0;
  const fetchImpl = async (target, options) => {
    calls++;
    assert.equal(options.headers, undefined);
    assert.equal(target.searchParams.get("$filter"), "Name eq 'S2_TEST_PREVIEW.SAFE'");
    return { ok: true, json: async () => ({ value: [{ Name: row.source_item_id, Assets: [{ Type: "QUICKLOOK", DownloadLink: url }] }] }) };
  };
  assert.deepEqual(await Promise.all([resolveSatelliteSourcePreview(row, { fetchImpl }), resolveSatelliteSourcePreview(row, { fetchImpl })]), [url, url]);
  assert.equal(calls, 1);
});
test("missing source quicklooks never fall back to a bucket", async () => {
  assert.equal(await resolveSatelliteSourcePreview({ source_item_id: "NO_PREVIEW.SAFE", image_url: "https://bucket.s3.amazonaws.com/crop.png" }, {
    fetchImpl: async () => ({ ok: false }),
  }), null);
});
