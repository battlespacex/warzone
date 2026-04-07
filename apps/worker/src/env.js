import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerRoot = path.resolve(__dirname, "..");

let envLoaded = false;

export function loadWorkerEnv() {
    if (envLoaded) return;
    envLoaded = true;

    const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
    dotenv.config({
        path: path.join(workerRoot, envFile)
    });
}
