"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const drives = new Map();
const environments = new Map();

function classifyFilesystem(directory) {
    if (process.platform === "win32") {
        const value = directory.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
        if (/^\\\\/.test(value)) return "network";
        const drive = path.win32.parse(value).root.slice(0, 2).toUpperCase();
        if (!/^[A-Z]:$/.test(drive)) return "unknown";
        const systemDrive = path.win32.parse(process.env.SystemRoot || process.execPath).root.slice(0, 2).toUpperCase();
        if (drive === systemDrive) return "local";
        if (!drives.has(drive)) {
            // Read the OS mapping table, not the remote filesystem. No WMI, shell,
            // PowerShell startup, recursive scan, elevation, or server ping.
            const command = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "net.exe") : "net.exe";
            const result = spawnSync(command, ["use", drive], {
                encoding: "utf8", timeout: 1000, windowsHide: true, maxBuffer: 128 * 1024,
            });
            drives.set(drive, result.error ? "unknown" : result.status === 0 ? "network" : "local");
        }
        return drives.get(drive);
    }
    // Linux NFS/SMB filesystem IDs. The launcher also works on ordinary local
    // POSIX filesystems; FUSE conservatively uses the network profile.
    if (process.platform === "linux" && typeof fs.statfsSync === "function") {
        try {
            let existing = directory;
            while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
            const type = Number(fs.statfsSync(existing).type) >>> 0;
            if ([0x6969, 0xff534d42, 0xfe534d42, 0x65735546].includes(type)) return "network";
        } catch {
            return "unknown";
        }
    }
    return "local";
}

function localCacheDirectory(projectRoot) {
    const override = process.env.STRATOPS_WEBPACK_CACHE_DIR;
    const identity = crypto.createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 12);
    const bases = process.platform === "win32"
        ? [process.env.LOCALAPPDATA, path.join(os.homedir(), "AppData", "Local"), os.tmpdir()]
        : [process.env.XDG_CACHE_HOME, process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches")
            : path.join(os.homedir(), ".cache"), os.tmpdir()];
    const candidates = override ? [override] : bases.filter(Boolean).map((base) => path.join(base, "StratOps", "webpack-cache", identity));
    for (const candidate of candidates) {
        if (!path.isAbsolute(candidate)) continue;
        const relative = path.relative(projectRoot, candidate);
        if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) continue;
        if (/(?:^|[\\/])(?:Dropbox|OneDrive)(?:[\\/]|$)/i.test(candidate)) continue;
        try {
            if (classifyFilesystem(candidate) !== "local") continue;
            // Resolve the nearest existing ancestor to catch redirected/junctioned
            // profile/cache directories without enumerating their contents.
            let ancestor = candidate;
            while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
            const resolvedAncestor = fs.realpathSync.native(ancestor);
            const resolvedCandidate = path.resolve(resolvedAncestor, path.relative(ancestor, candidate));
            if (classifyFilesystem(resolvedAncestor) !== "local" ||
                /(?:^|[\\/])(?:Dropbox|OneDrive)(?:[\\/]|$)/i.test(resolvedCandidate)) continue;
            const resolvedRelative = path.relative(projectRoot, resolvedCandidate);
            if (!resolvedRelative || (!resolvedRelative.startsWith(".." + path.sep) && resolvedRelative !== ".." && !path.isAbsolute(resolvedRelative))) continue;
            fs.mkdirSync(candidate, { recursive: true });
            fs.accessSync(candidate, fs.constants.W_OK);
            return candidate;
        } catch { /* Try the next local user cache/temp location. */ }
    }
    throw new Error("No writable local StratOps cache directory. STRATOPS_WEBPACK_CACHE_DIR, if set, must be an absolute local path outside the checkout and Dropbox/OneDrive.");
}

function getDevelopmentEnvironment(projectRoot) {
    const root = path.resolve(projectRoot);
    if (environments.has(root)) return environments.get(root);
    const detected = classifyFilesystem(root);
    const override = process.env.STRATOPS_DEV_FILESYSTEM;
    const filesystem = ["local", "network"].includes(override) ? override : detected;
    const network = filesystem !== "local"; // Unknown mapping: conservative source polling.
    const requestedInterval = Number(process.env.STRATOPS_DEV_POLL_MS);
    const pollMs = Number.isFinite(requestedInterval) && requestedInterval >= 1000 && requestedInterval <= 30000
        ? Math.round(requestedInterval) : 2000;
    const environment = { filesystem, detected, network, pollMs,
        cacheDirectory: localCacheDirectory(root),
        watchOptions: { poll: network ? pollMs : false, aggregateTimeout: 300 },
        staticWatchOptions: { usePolling: network, interval: pollMs, binaryInterval: pollMs,
            followSymlinks: false, ignoreInitial: true },
    };
    environments.set(root, environment);
    return environment;
}

function configureDevelopmentEnvironment(projectRoot) {
    // Scope changes to this Node process. Old terminal settings must not force
    // every watcher to poll, especially when returning to Laptop A's local disk.
    for (const name of ["WATCHPACK_POLLING", "CHOKIDAR_USEPOLLING", "CHOKIDAR_INTERVAL", "CHOKIDAR_BINARY_INTERVAL"])
        delete process.env[name];
    return getDevelopmentEnvironment(projectRoot);
}

module.exports = { classifyFilesystem, getDevelopmentEnvironment, configureDevelopmentEnvironment };
