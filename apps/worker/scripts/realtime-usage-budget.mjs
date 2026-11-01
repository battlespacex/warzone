// Read-only budget check. Supply the actual organization usage from Supabase; no API calls.
import { pathToFileURL } from "node:url";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS = Object.freeze({ review: 100000, warning: 130000, critical: 160000, monthly: 4000000 });

export function evaluateRealtimeUsage({ messages, cycleStart, cycleEnd, asOf, thresholds = DEFAULT_THRESHOLDS }) {
    const start = Date.parse(cycleStart);
    const end = Date.parse(cycleEnd);
    const at = Date.parse(asOf);
    const count = Number(messages);
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(start) || !Number.isFinite(end) ||
        !Number.isFinite(at) || start >= end || at <= start || at > end) {
        throw new Error("Supply a nonnegative integer message count and valid cycleStart < asOf <= cycleEnd dates");
    }
    const cycleDays = (end - start) / DAY_MS;
    const elapsedDays = (at - start) / DAY_MS;
    const dailyAverage = count / elapsedDays;
    const projectedCycleMessages = Math.ceil(dailyAverage * cycleDays);
    const level = dailyAverage >= thresholds.critical ? "critical" :
        dailyAverage >= thresholds.warning ? "warning" :
            dailyAverage >= thresholds.review ? "review" : "normal";
    return {
        source: "manually supplied Supabase organization Realtime Messages usage",
        messagesToDate: count,
        cycleDays,
        elapsedDays,
        dailyAverage: Math.round(dailyAverage),
        projectedCycleMessages,
        level,
        budgetRisk: projectedCycleMessages >= thresholds.monthly,
        thresholds,
        // Pro plan and Realtime only. Other projects, compute, tax and credits are excluded.
        estimatedRealtimeOverageUsd: Math.ceil(Math.max(0, projectedCycleMessages - 5000000) / 1000000) * 2.5,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
            const [key, value] = arg.replace(/^--/, "").split("=", 2);
            return [key, value];
        }));
        const thresholds = {
            review: Number(args.review ?? DEFAULT_THRESHOLDS.review),
            warning: Number(args.warning ?? DEFAULT_THRESHOLDS.warning),
            critical: Number(args.critical ?? DEFAULT_THRESHOLDS.critical),
            monthly: Number(args.monthly ?? DEFAULT_THRESHOLDS.monthly),
        };
        if (Object.values(thresholds).some((value) => !Number.isFinite(value) || value < 0)) {
            throw new Error("Thresholds must be nonnegative numbers");
        }
        console.log(JSON.stringify(evaluateRealtimeUsage({
            messages: args.messages,
            cycleStart: args.cycleStart,
            cycleEnd: args.cycleEnd,
            asOf: args.asOf,
            thresholds,
        }), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
