import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(process.env.TELEGRAM_API_ID || 0);
const apiHash = process.env.TELEGRAM_API_HASH || "";
const phone = process.env.TELEGRAM_PHONE || "";
const existingSession = process.env.TELEGRAM_SESSION || "";

if (!apiId || !apiHash || !phone) {
    console.error("Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_PHONE in .env.local");
    process.exit(1);
}

const stringSession = new StringSession(existingSession);
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

(async () => {
    await client.start({
        phoneNumber: async () => phone,
        password: async () => await input.text("Telegram 2FA password (if any): "),
        phoneCode: async () => await input.text("Enter the Telegram code you received: "),
        onError: (err) => console.error("Telegram auth error:", err),
    });

    console.log("\nNEW TELEGRAM SESSION:\n");
    console.log(client.session.save());
    console.log("\nCopy this into TELEGRAM_SESSION in .env.local\n");

    await client.disconnect();
    process.exit(0);
})();