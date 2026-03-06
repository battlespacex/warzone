import pg from "pg";
export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false }
});
export async function query(text, params = []) {
    const res = await pool.query(text, params);
    return res;
}