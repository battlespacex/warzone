import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
    path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.local"
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is missing in selected env file");
}

if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing in selected env file");
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);