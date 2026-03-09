// apps/worker/src/telegram-auth.js
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in apps/worker/.env");
}

const stringSession = new StringSession("");

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
});

(async () => {
    await client.start({
        phoneNumber: async () => process.env.TELEGRAM_PHONE || await input.text("Telegram phone: "),
        password: async () => await input.text("2FA password (if enabled): "),
        phoneCode: async () => await input.text("Code you received: "),
        onError: (err) => console.log(err)
    });

    console.log("\nTELEGRAM_SESSION=");
    console.log(client.session.save());
    console.log("\nCopy that value into apps/worker/.env as TELEGRAM_SESSION");
    process.exit(0);
})();