import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import express from "express";
import { MeshoptDecoder } from "meshoptimizer";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = fs.readFileSync(path.join(root, "dev/assets/js/warzone-live-naval.js"), "utf8");
const models = [...new Set([...source.matchAll(/model: "([^"\n]+\.glb)"/g)].map((match) => match[1]))];
const assetRoot = process.env.STRATOPS_NAVAL_TEST_BUILD
    ? path.resolve(root, process.env.STRATOPS_NAVAL_TEST_BUILD) : path.join(root, "dev");
const bytes = (name) => fs.readFileSync(path.join(assetRoot, "assets/images/models/sea", name));

test("all referenced naval GLBs decode with Cesium's Meshopt decoder and retain valid geometry/materials", async () => {
    await MeshoptDecoder.ready;
    assert.ok(models.includes("Vessel-Frigate.glb"));
    for (const file of models) {
        const data = bytes(file);
        assert.equal(data.readUInt32LE(0), 0x46546c67, file);
        assert.equal(data.readUInt32LE(4), 2, file);
        assert.equal(data.readUInt32LE(8), data.length, file);
        assert.equal(data.readUInt32LE(16), 0x4e4f534a, file);
        const length = data.readUInt32LE(12);
        const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
        const binOffset = 20 + length;
        assert.equal(data.readUInt32LE(binOffset + 4), 0x004e4942, file);
        assert.equal(binOffset + 8 + data.readUInt32LE(binOffset), data.length, file);
        assert.equal(json.asset.version, "2.0", file);
        assert.ok(json.scenes[json.scene || 0].nodes.length > 0, file);
        const binary = data.subarray(binOffset + 8);
        const buffers = json.buffers.map((buffer, index) => {
            assert.equal(buffer.uri, undefined, file);
            if (index === 0) { assert.ok(buffer.byteLength <= binary.length, file); return binary.subarray(0, buffer.byteLength); }
            assert.equal(buffer.extensions?.EXT_meshopt_compression?.fallback, true, file);
            return new Uint8Array(buffer.byteLength); // Legal virtual decode buffer, not another GLB binary chunk.
        });
        for (const view of json.bufferViews) {
            assert.ok((view.byteOffset || 0) + view.byteLength <= json.buffers[view.buffer].byteLength, file);
            const compression = view.extensions?.EXT_meshopt_compression;
            if (compression) {
                const start = compression.byteOffset || 0;
                assert.ok(start + compression.byteLength <= buffers[compression.buffer].length, file);
                const decoded = new Uint8Array(compression.count * compression.byteStride);
                MeshoptDecoder.decodeGltfBuffer(decoded, compression.count, compression.byteStride,
                    buffers[compression.buffer].subarray(start, start + compression.byteLength), compression.mode, compression.filter);
                assert.ok(decoded.length <= view.byteLength, file);
                buffers[view.buffer].set(decoded, view.byteOffset || 0);
            }
        }
        for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
            const positions = json.accessors[primitive.attributes.POSITION];
            assert.ok(positions.count >= 3 && positions.type === "VEC3", file);
            assert.ok(positions.min.every(Number.isFinite) && positions.max.every(Number.isFinite), file);
            assert.ok(positions.max.some((value, i) => value > positions.min[i]), file);
            if (primitive.material !== undefined) assert.ok(json.materials[primitive.material], file);
            if (primitive.indices !== undefined) {
                const indices = json.accessors[primitive.indices], view = json.bufferViews[indices.bufferView];
                const binaryView = new DataView(buffers[view.buffer].buffer, buffers[view.buffer].byteOffset);
                assert.ok(indices.count >= 3, file);
                const size = indices.componentType === 5123 ? 2 : 4;
                for (let i = 0; i < indices.count; i++) {
                    const offset = (view.byteOffset || 0) + (indices.byteOffset || 0) + i * size;
                    const index = size === 2 ? binaryView.getUint16(offset, true) : binaryView.getUint32(offset, true);
                    assert.ok(index < positions.count, `${file} index ${index}`);
                }
            }
        }
        if (process.env.STRATOPS_NAVAL_TEST_BUILD) {
            assert.deepEqual(data, fs.readFileSync(path.join(root, "dev/assets/images/models/sea", file)), file);
        }
    }
});

test("development/build public naval model URLs return the exact GLB bytes and binary MIME", async (t) => {
    const app = express(); app.use(express.static(assetRoot));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const file of models) {
        const response = await fetch(`${origin}/assets/images/models/sea/${file}`);
        assert.equal(response.status, 200, file);
        assert.match(response.headers.get("content-type"), /model\/gltf-binary|application\/octet-stream/, file);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes(file), file);
    }
    t.diagnostic(`${models.length} GLBs verified under ${assetRoot}; HTTP delivery does not prove GPU rendering`);
});
