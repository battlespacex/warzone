import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { inspectPlaneAlertMilitaryCsv } from "../apps/worker/src/tracking/aircraft/providers/plane-alert-db.js";

export function importMilitaryAircraft(bytes, { version, importedAt = new Date().toISOString() } = {}) {
    if (!/^[a-f0-9]{40}$/.test(version || "")) throw new Error("Require the exact upstream commit SHA (--version)");
    const source_url = `https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/${version}/plane-alert-mil.csv`;
    const provenance = { schema_version: 1, version, source_url, imported_at: importedAt,
        license: "ODbL-1.0", copyright: "SDR-Enthusiasts, Ramon F. Kolb (kx1t), and contributors",
        license_url: "https://github.com/sdr-enthusiasts/plane-alert-db/blob/" + version + "/LICENSE",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        git_blob_sha: createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex") };
    const result = inspectPlaneAlertMilitaryCsv(bytes.toString("utf8"), provenance);
    if (!result.records.size) throw new Error("No valid military registry entries");
    return { ...provenance, validation: result.validation };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2), values = {};
        while (args.length) { const key = args.shift(); if (!["--input", "--out-dir", "--version", "--expected-blob"].includes(key) || !args.length) throw new Error("Usage: --input <csv> --out-dir <new-directory> --version <commit-sha> --expected-blob <git-blob-sha>"); values[key] = args.shift(); }
        if (!values["--input"] || !values["--out-dir"] || !/^[a-f0-9]{40}$/.test(values["--expected-blob"] || "")) throw new Error("Require input, new output directory and expected Git blob SHA");
        const bytes = fs.readFileSync(values["--input"]), manifest = importMilitaryAircraft(bytes, { version: values["--version"] });
        if (manifest.git_blob_sha !== values["--expected-blob"]) throw new Error("Upstream blob checksum mismatch");
        fs.mkdirSync(path.dirname(path.resolve(values["--out-dir"])), { recursive: true });
        fs.mkdirSync(values["--out-dir"]); // Refuse replacing a reviewed registry.
        fs.writeFileSync(path.join(values["--out-dir"], "plane-alert-mil.csv"), bytes, { flag: "wx" });
        fs.writeFileSync(path.join(values["--out-dir"], "plane-alert-mil.csv.manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
        console.log(JSON.stringify(manifest));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
